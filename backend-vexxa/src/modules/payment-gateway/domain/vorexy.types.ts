import type { HeartPayPayoutStatus } from './payment-gateway.types.js';

/**
 * Vorexy substitui a HeartPay como gateway PIX (cash-out). A API e os webhooks
 * têm formato próprio; estes tipos descrevem o contrato REAL descoberto via
 * testes ao vivo (a doc oficial é incompleta — ver memória vorexy-gateway-contract).
 */

/** Status retornado pela API Vorexy (PascalCase) em `enTransaction`. */
export type VorexyEnTransaction =
  | 'Pending'
  | 'Processing'
  | 'Successful'
  | 'Failure';

/** Status enviado no corpo do webhook (lowercase) em `status`. */
export type VorexyWebhookStatus =
  | 'pending'
  | 'successful'
  | 'failure'
  | 'refunded';

/**
 * Mapeia o `enTransaction` da API para o enum interno (reaproveitado da
 * HeartPay) usado em todo o fluxo de saque/reconcile.
 */
export function mapVorexyEnTransaction(
  en: string | undefined,
): HeartPayPayoutStatus {
  switch (en) {
    case 'Successful':
      return 'completed';
    case 'Failure':
      return 'failed';
    case 'Processing':
      return 'processing';
    case 'Pending':
    default:
      return 'pending';
  }
}

/** Resposta 201 de `POST /api/Withdraw/request`. */
export interface VorexyWithdrawCreateResponse {
  id: number;
  companyId: number;
  idempotencyKey?: string;
  value: number; // REAIS
  pixKey: string;
  pixKeyType: string;
  creditorDocument?: string;
  description?: string;
  currency?: string;
  enTransaction: VorexyEnTransaction | string;
  createdAt?: string;
}

/** Resposta de `GET /api/Withdraw/{id}` (DTO de status, campos relevantes). */
export interface VorexyWithdrawStatusResponse extends VorexyWithdrawCreateResponse {
  amount?: number; // CENTAVOS
  provider?: string;
  providerStatus?: string;
  providerTid?: string | null;
  providerEndToEndId?: string | null;
  providerPaymentId?: string | null;
  providerAmount?: number | null;
  providerErrorDescription?: string | null;
  updateDate?: string;
}

/** Resposta de `GET /api/Balance/balance/{companyId}?currency=BRL`. */
export interface VorexyBalanceResponse {
  companyId: number;
  currency: string;
  enBalanceStatus: string; // 'Released' | 'Pending'
  accBalance: number; // REAIS
  accBalanceCredit?: number;
  accBalanceCreditAwaiting?: number;
}

/** Dados do pagador/recebedor no webhook cashout. */
export interface VorexyWebhookParty {
  name?: string | null;
  document?: string | null;
  ispb?: string | null;
  agency?: string | null;
  account?: string | null;
}

/**
 * Corpo do webhook CashOut (saques). SEM assinatura HMAC — segurança via
 * dedup (`x-webhook-event-id`) + validação do `withdrawId` no DB + segredo
 * opcional na URL. Pode chegar múltiplas vezes (idempotência obrigatória).
 */
export interface VorexyCashoutWebhookPayload {
  object: 'withdraw' | string;
  type: 'cashout' | string;
  status: VorexyWebhookStatus | string;
  companyId: number;
  withdrawId: number;
  value: number; // REAIS
  valueInCents: number; // CENTAVOS
  currency: string;
  provider?: string;
  providerStatus?: string | number;
  providerTid?: string | null;
  providerPaymentId?: string | null;
  endToEndId?: string | null;
  providerAmount?: number | null;
  providerConfirmedAt?: string | null;
  providerDebitedAt?: string | null;
  providerErrorCode?: string | null;
  providerErrorDescription?: string | null;
  providerPayload?: string | Record<string, unknown> | null;
  pixKey?: string;
  pixKeyType?: string;
  creditorDocument?: string;
  payer?: VorexyWebhookParty;
  receiver?: VorexyWebhookParty;
  createdAt?: string;
  updatedAt?: string;
  processedAt?: string;
  metadata?: string | Record<string, unknown> | null;
}
