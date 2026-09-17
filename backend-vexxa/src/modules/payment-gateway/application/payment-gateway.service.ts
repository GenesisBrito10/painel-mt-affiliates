import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreateTransferInput,
  CreateTransferResult,
  GetBalanceResult,
  GetPayoutStatusResult,
  GetReceiptResult,
} from '../domain/payment-gateway.types.js';
import { VorexyHttpClient } from '../infrastructure/vorexy-http.client.js';
import { HeartPayHttpClient } from '../infrastructure/heartpay-http.client.js';

export type DispatchTransferInput = CreateTransferInput;

export type GatewayProvider = 'heartpay' | 'vorexy';

/**
 * Interface comum dos clients de gateway. Vorexy e HeartPay a satisfazem
 * estruturalmente, então `this.client` pode apontar para qualquer um dos dois
 * conforme o seletor por env `PAYMENT_GATEWAY`.
 */
interface PaymentGatewayClient {
  createPayout(input: CreateTransferInput): Promise<CreateTransferResult>;
  getPayoutStatus(identifier: string): Promise<GetPayoutStatusResult>;
  getReceipt(correlationID: string): Promise<GetReceiptResult>;
  getBalance(): Promise<GetBalanceResult>;
}

@Injectable()
export class PaymentGatewayService {
  private readonly logger = new Logger(PaymentGatewayService.name);

  /** Gateway ativo, escolhido por env `PAYMENT_GATEWAY` (default 'vorexy'). */
  private readonly provider: GatewayProvider;
  private readonly client: PaymentGatewayClient;

  constructor(
    private readonly vorexy: VorexyHttpClient,
    private readonly heartpay: HeartPayHttpClient,
    private readonly config: ConfigService,
  ) {
    this.provider =
      this.config.get<string>('PAYMENT_GATEWAY', 'vorexy') === 'heartpay'
        ? 'heartpay'
        : 'vorexy';
    this.client = this.provider === 'heartpay' ? this.heartpay : this.vorexy;
    this.logger.log(`Gateway de pagamento ativo: ${this.provider}`);
  }

  /** Nome do gateway ativo — usado para taguear o saque (gatewayProvider). */
  getActiveProvider(): GatewayProvider {
    return this.provider;
  }

  /**
   * Segredo opcional do webhook Vorexy (validado na URL como query `?s=`).
   * Vorexy NÃO assina os webhooks (sem HMAC); o segredo na URL é a camada de
   * autenticação. Vazio = sem verificação (apenas dedup + lookup no DB).
   */
  getWebhookSecret(): string {
    return this.config.get<string>('VOREXY_WEBHOOK_SECRET', '');
  }

  /**
   * Token do webhook HeartPay — usado pelo header `x-webhook-token` e como
   * chave HMAC (`x-heartpay-signature`). Vazio = sem token configurado.
   */
  getWebhookToken(): string {
    return this.config.get<string>('HEARTPAY_WEBHOOK_TOKEN', '');
  }

  createTransfer(input: DispatchTransferInput): Promise<CreateTransferResult> {
    return this.client.createPayout(input);
  }

  getPayoutStatus(identifier: string): Promise<GetPayoutStatusResult> {
    return this.client.getPayoutStatus(identifier);
  }

  getReceipt(correlationID: string): Promise<GetReceiptResult> {
    return this.client.getReceipt(correlationID);
  }

  getBalance(): Promise<GetBalanceResult> {
    return this.client.getBalance();
  }

  /**
   * Checks whether the active gateway's company balance can cover
   * `requiredCents`. Returns { ok: true } when sufficient, or
   * { ok: false, reason } when insufficient or withdrawals are
   * administratively blocked on the gateway account. Fails open (logs +
   * returns ok:true) if the balance API itself fails — the gateway POST will
   * still surface the failure.
   */
  async checkSufficientBalance(
    requiredCents: number,
  ): Promise<{ ok: boolean; reason?: string }> {
    const result = await this.client.getBalance();
    if (!result.ok) {
      this.logger.warn(
        `Não foi possível verificar saldo do gateway (${this.provider}) antes do pagamento: ${result.reason}. Prosseguindo mesmo assim.`,
      );
      return { ok: true };
    }
    const { availableBalance, withdrawalsBlocked, withdrawalsBlockedReason } =
      result.balance;
    this.logger.log(
      `Saldo gateway (${this.provider}): disponível=${availableBalance}¢ necessário=${requiredCents}¢ blocked=${withdrawalsBlocked}`,
    );

    if (withdrawalsBlocked) {
      return {
        ok: false,
        reason:
          withdrawalsBlockedReason ??
          'Saques bloqueados na conta do gateway. Verifique no painel.',
      };
    }

    if (availableBalance < requiredCents) {
      const fmt = (c: number) =>
        new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        }).format(c / 100);
      return {
        ok: false,
        reason: `Saldo insuficiente no gateway de pagamento (${this.provider}). Disponível: ${fmt(availableBalance)} | Necessário: ${fmt(requiredCents)}.`,
      };
    }
    return { ok: true };
  }
}
