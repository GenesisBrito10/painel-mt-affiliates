import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateTransferInput,
  CreateTransferResult,
  GetBalanceResult,
  GetPayoutStatusResult,
  GetReceiptResult,
  TransferRawResponse,
} from '../domain/payment-gateway.types.js';
import {
  mapVorexyEnTransaction,
  type VorexyBalanceResponse,
  type VorexyWithdrawCreateResponse,
  type VorexyWithdrawStatusResponse,
} from '../domain/vorexy.types.js';

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 500, 2000];

/**
 * Cliente HTTP do gateway Vorexy (substitui HeartPayHttpClient). Expõe a MESMA
 * interface (createPayout / getPayoutStatus / getReceipt / getBalance) e os
 * mesmos tipos de retorno, para plugar sem mudar o PaymentGatewayService.
 *
 * Diferenças importantes vs HeartPay (ver memória vorexy-gateway-contract):
 * - Auth via headers X-Client-Id + X-API-Key (não Bearer).
 * - `amount` enviado em CENTAVOS; respostas `value`/`accBalance` em REAIS.
 * - Idempotência do saque via header `Idempotency-Key` = withdrawalId interno.
 * - pixKeyType é literal (CPF/CNPJ/EMAIL/PHONE/EVP) — sem mapeamento (EVP fica EVP).
 * - Vorexy NÃO fornece comprovante: getReceipt é no-op (gerado localmente).
 */
@Injectable()
export class VorexyHttpClient {
  private readonly logger = new Logger(VorexyHttpClient.name);

  constructor(private readonly config: ConfigService) {}

  private getBaseUrl(): string {
    return this.config.getOrThrow<string>('VOREXY_BASE_URL').replace(/\/$/, '');
  }

  private getCompanyId(): string {
    return this.config.getOrThrow<string>('VOREXY_COMPANY_ID');
  }

  private getTimeoutMs(): number {
    return this.config.get<number>('VOREXY_HTTP_TIMEOUT_MS', 15000);
  }

  private authHeaders(): Record<string, string> {
    return {
      'X-Client-Id': this.config.getOrThrow<string>('VOREXY_CLIENT_ID'),
      'X-API-Key': this.config.getOrThrow<string>('VOREXY_API_KEY'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async createPayout(
    input: CreateTransferInput,
  ): Promise<CreateTransferResult> {
    const requestPayload: Record<string, unknown> = {
      amount: input.amountCents,
      currency: 'BRL',
      pixKey: input.pixKey,
      pixKeyType: input.pixKeyType, // CPF|CNPJ|EMAIL|PHONE|EVP — literal
      ...(input.description ? { description: input.description } : {}),
      metadata: { withdrawalId: input.withdrawalId },
    };

    const url = `${this.getBaseUrl()}/api/Withdraw/request`;
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
          headers: {
            ...this.authHeaders(),
            // Idempotência: reentregas/retries colidem na mesma chave e a
            // Vorexy não cria saque duplicado.
            'Idempotency-Key': input.withdrawalId,
          },
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

        if (res.ok) {
          const data = body as VorexyWithdrawCreateResponse | null;
          if (!data || typeof data !== 'object' || data.id === undefined) {
            lastErr = {
              reason: 'Vorexy response missing withdraw id',
              retryable: false,
              statusCode: res.status,
              response: body,
            };
            break;
          }

          const status = mapVorexyEnTransaction(data.enTransaction);
          const normalized: TransferRawResponse = {
            id: String(data.id),
            status,
            amount: input.amountCents,
            net_amount: input.amountCents,
            fee: 0,
          };

          // `enTransaction: Failure` síncrono = recusa do provider (ex: abaixo
          // do mínimo, chave inválida). Trata como falha terminal não-retryável
          // para o fluxo marcar FAILED e restaurar o saldo.
          if (status === 'failed') {
            lastErr = {
              reason:
                this.extractErrorReason(body) ?? 'Saque recusado pela Vorexy',
              retryable: false,
              statusCode: res.status,
              response: body,
            };
            break;
          }

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
            ? `Vorexy timeout after ${timeoutMs}ms`
            : `Network error: ${message}`,
          retryable: true,
        };
      }
    }

    this.logger.warn(
      `Vorexy payout failed for withdrawal=${input.withdrawalId}: ${lastErr?.reason ?? 'unknown error'}`,
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
    const url = `${this.getBaseUrl()}/api/Withdraw/${encodeURIComponent(identifier)}`;
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

      const data = body as VorexyWithdrawStatusResponse | null;
      if (!data || data.id === undefined) {
        return { ok: false, reason: 'Vorexy response missing withdraw data' };
      }

      const amountCents =
        typeof data.amount === 'number'
          ? data.amount
          : Math.round((data.value ?? 0) * 100);

      return {
        ok: true,
        data: {
          reference_code: String(data.id),
          amount: amountCents,
          net_amount: amountCents,
          fee: 0,
          status: mapVorexyEnTransaction(data.enTransaction),
          ...(data.pixKey ? { pix_key: data.pixKey } : {}),
          ...(data.createdAt ? { created_at: data.createdAt } : {}),
          completed_at: data.updateDate ?? null,
          ...(data.provider ? { provider: data.provider } : {}),
          error_message: data.providerErrorDescription ?? null,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `Erro ao consultar saque: ${message}` };
    }
  }

  /**
   * Vorexy NÃO expõe endpoint de comprovante (a doc mente). O comprovante é
   * gerado localmente (ReceiptGeneratorService). Mantido para compat. de
   * interface — sempre falha de forma controlada.
   */
  getReceipt(_correlationID: string): Promise<GetReceiptResult> {
    return Promise.resolve({
      ok: false,
      reason: 'Vorexy não fornece comprovante; gerado localmente.',
    });
  }

  async getBalance(): Promise<GetBalanceResult> {
    const url = `${this.getBaseUrl()}/api/Balance/balance/${encodeURIComponent(
      this.getCompanyId(),
    )}?currency=BRL`;
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

      const data = body as VorexyBalanceResponse | null;
      if (!data || typeof data.accBalance !== 'number') {
        return {
          ok: false,
          reason: 'Vorexy balance response missing accBalance',
        };
      }

      // accBalance vem em REAIS → converte para CENTAVOS (interface interna).
      const availableBalance = Math.round(data.accBalance * 100);
      const blocked = data.enBalanceStatus !== 'Released';
      return {
        ok: true,
        balance: {
          availableBalance,
          withdrawalsBlocked: blocked,
          withdrawalsBlockedReason: blocked
            ? `Saldo Vorexy com status "${data.enBalanceStatus}".`
            : null,
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
    if (typeof b['detail'] === 'string') return b['detail'] as string;
    if (typeof b['title'] === 'string') return b['title'] as string;
    return null;
  }
}
