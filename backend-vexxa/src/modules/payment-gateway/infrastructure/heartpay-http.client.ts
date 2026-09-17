import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateTransferInput,
  CreateTransferResult,
  GetBalanceResult,
  GetPayoutStatusResult,
  GetReceiptResult,
  HeartPayBalance,
  HeartPayCreatePayoutResponse,
  HeartPayPixKeyType,
  HeartPayReceipt,
  PixKeyType,
  TransferRawResponse,
} from '../domain/payment-gateway.types.js';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 500, 2000];

const PIX_KEY_TYPE_MAP: Record<PixKeyType, HeartPayPixKeyType> = {
  CPF: 'cpf',
  CNPJ: 'cnpj',
  EMAIL: 'email',
  PHONE: 'phone',
  EVP: 'random',
};

type PayoutStatusData = {
  reference_code: string;
  amount: number;
  net_amount: number;
  fee: number;
  status: string;
  pix_key?: string;
  pix_key_type?: HeartPayPixKeyType;
  created_at?: string;
  completed_at?: string | null;
  provider?: string;
  error_message?: string | null;
  source?: string;
};

@Injectable()
export class HeartPayHttpClient {
  private readonly logger = new Logger(HeartPayHttpClient.name);

  constructor(private readonly config: ConfigService) {}

  private getBaseUrl(): string {
    return this.config
      .getOrThrow<string>('HEARTPAY_BASE_URL')
      .replace(/\/$/, '');
  }

  private getApiKey(): string {
    return this.config.getOrThrow<string>('HEARTPAY_API_KEY');
  }

  private getTimeoutMs(): number {
    return this.config.get<number>('HEARTPAY_HTTP_TIMEOUT_MS', 15000);
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.getApiKey()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async createPayout(
    input: CreateTransferInput,
  ): Promise<CreateTransferResult> {
    const pixKeyType = PIX_KEY_TYPE_MAP[input.pixKeyType];
    if (!pixKeyType) {
      return {
        ok: false,
        reason: `Tipo de chave PIX inválido: ${input.pixKeyType}`,
        retryable: false,
        requestPayload: {},
      };
    }

    const requestPayload: Record<string, unknown> = {
      value: input.amountCents,
      pixKey: input.pixKey,
      pixKeyType,
      correlationID: input.withdrawalId,
      ...(input.description ? { description: input.description } : {}),
    };

    const url = `${this.getBaseUrl()}/api/v1/client/payouts`;
    const timeoutMs = this.getTimeoutMs();

    let lastErr: {
      reason: string;
      retryable: boolean;
      statusCode?: number;
      response?: unknown;
    } | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const wait = BACKOFF_MS[attempt] ?? 0;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: this.authHeaders(),
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await res.text();
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = { raw: text };
        }

        // 409 duplicate correlationID — not retryable terminal error.
        if (res.status === 409) {
          lastErr = {
            reason:
              this.extractErrorReason(body) ??
              `Saque duplicado (correlationID=${input.withdrawalId})`,
            retryable: false,
            statusCode: 409,
            response: body,
          };
          break;
        }

        if (res.ok) {
          const wrapper = body as
            | { success?: boolean; data?: HeartPayCreatePayoutResponse }
            | HeartPayCreatePayoutResponse
            | null;
          const data =
            (wrapper as { data?: HeartPayCreatePayoutResponse })?.data ??
            (wrapper as HeartPayCreatePayoutResponse);

          if (
            !data ||
            typeof data !== 'object' ||
            typeof data.reference_code !== 'string'
          ) {
            lastErr = {
              reason: 'HeartPay response missing reference_code',
              retryable: false,
              statusCode: res.status,
              response: body,
            };
            break;
          }

          const normalized: TransferRawResponse = {
            id: data.reference_code,
            status: data.status,
            amount: data.amount,
            net_amount: data.net_amount,
            fee: data.fee,
            ...(data.source ? { source: data.source } : {}),
            ...(data.message ? { message: data.message } : {}),
          };

          return { ok: true, response: normalized, requestPayload };
        }

        const retryable = RETRYABLE_STATUS.has(res.status);
        lastErr = {
          reason: this.extractErrorReason(body) ?? `HTTP ${res.status}`,
          retryable,
          statusCode: res.status,
          response: body,
        };
        if (!retryable) break;
      } catch (err) {
        clearTimeout(timer);
        const message = err instanceof Error ? err.message : String(err);
        const aborted = err instanceof Error && err.name === 'AbortError';
        lastErr = {
          reason: aborted
            ? `HeartPay timeout after ${timeoutMs}ms`
            : `Network error: ${message}`,
          retryable: true,
        };
      }
    }

    this.logger.warn(
      `HeartPay payout failed for withdrawal=${input.withdrawalId}: ${lastErr?.reason ?? 'unknown error'}`,
    );

    return {
      ok: false,
      reason: lastErr?.reason ?? 'Unknown gateway error',
      retryable: lastErr?.retryable ?? false,
      ...(lastErr?.statusCode !== undefined
        ? { statusCode: lastErr.statusCode }
        : {}),
      ...(lastErr?.response !== undefined
        ? { response: lastErr.response }
        : {}),
      requestPayload,
    };
  }

  async getPayoutStatus(identifier: string): Promise<GetPayoutStatusResult> {
    const url = `${this.getBaseUrl()}/api/v1/client/payouts/${encodeURIComponent(identifier)}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.authHeaders(),
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }

      if (!res.ok) {
        return {
          ok: false,
          reason: this.extractErrorReason(body) ?? `HTTP ${res.status}`,
          statusCode: res.status,
        };
      }

      const wrapper = body as {
        success?: boolean;
        data?: PayoutStatusData;
      } | null;
      const data: PayoutStatusData | undefined =
        wrapper?.data ?? (body as PayoutStatusData);

      if (!data || typeof data.reference_code !== 'string') {
        return {
          ok: false,
          reason: 'HeartPay response missing payout data',
        };
      }
      return { ok: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `Erro ao consultar saque: ${message}` };
    }
  }

  async getReceipt(correlationID: string): Promise<GetReceiptResult> {
    const url = `${this.getBaseUrl()}/api/v1/client/payouts/${encodeURIComponent(correlationID)}/receipt`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.authHeaders(),
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }

      if (!res.ok) {
        return {
          ok: false,
          reason: this.extractErrorReason(body) ?? `HTTP ${res.status}`,
          statusCode: res.status,
        };
      }

      const wrapper = body as {
        success?: boolean;
        receipt?: HeartPayReceipt;
      } | null;
      const receipt = wrapper?.receipt;
      if (!receipt || typeof receipt.base64 !== 'string') {
        return {
          ok: false,
          reason: 'HeartPay response missing receipt payload',
        };
      }
      return { ok: true, receipt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `Erro ao obter comprovante: ${message}` };
    }
  }

  async getBalance(): Promise<GetBalanceResult> {
    const url = `${this.getBaseUrl()}/api/v1/client/balance`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.authHeaders(),
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }

      if (!res.ok) {
        return {
          ok: false,
          reason: this.extractErrorReason(body) ?? `HTTP ${res.status}`,
          statusCode: res.status,
        };
      }

      const wrapper = body as {
        success?: boolean;
        data?: Partial<HeartPayBalance>;
      } | null;
      const data = wrapper?.data ?? (body as Partial<HeartPayBalance>);
      if (!data || typeof data.availableBalance !== 'number') {
        return {
          ok: false,
          reason: 'HeartPay balance response missing availableBalance',
        };
      }
      return {
        ok: true,
        balance: {
          availableBalance: data.availableBalance,
          ...(typeof data.manualBalanceAdjustment === 'number'
            ? { manualBalanceAdjustment: data.manualBalanceAdjustment }
            : {}),
          ...(typeof data.totalReceived === 'number'
            ? { totalReceived: data.totalReceived }
            : {}),
          ...(typeof data.totalFees === 'number'
            ? { totalFees: data.totalFees }
            : {}),
          ...(typeof data.totalPayouts === 'number'
            ? { totalPayouts: data.totalPayouts }
            : {}),
          ...(typeof data.totalPendingPayouts === 'number'
            ? { totalPendingPayouts: data.totalPendingPayouts }
            : {}),
          ...(typeof data.totalBlocked === 'number'
            ? { totalBlocked: data.totalBlocked }
            : {}),
          withdrawalsBlocked: Boolean(data.withdrawalsBlocked),
          withdrawalsBlockedReason: data.withdrawalsBlockedReason ?? null,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `Erro ao consultar saldo: ${message}` };
    }
  }

  private extractErrorReason(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    if (typeof b['message'] === 'string') return b['message'] as string;
    if (typeof b['error'] === 'string') return b['error'] as string;
    return null;
  }
}
