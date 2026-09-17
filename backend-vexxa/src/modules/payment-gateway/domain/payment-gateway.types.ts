export type PixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';

export type HeartPayPixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export interface CreateTransferInput {
  withdrawalId: string;
  amountCents: number;
  pixKey: string;
  pixKeyType: PixKeyType;
  description?: string;
}

export type HeartPayPayoutStatus =
  | 'pending'
  | 'pending_approval'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'PENDING'
  | 'PENDING_APPROVAL'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

export interface HeartPayCreatePayoutResponse {
  reference_code: string;
  amount: number;
  net_amount: number;
  fee: number;
  status: HeartPayPayoutStatus;
  source?: string;
  message?: string;
}

export interface TransferRawResponse {
  id: string;
  status: HeartPayPayoutStatus;
  amount: number;
  net_amount: number;
  fee: number;
  source?: string;
  message?: string;
}

export type CreateTransferResult =
  | {
      ok: true;
      response: TransferRawResponse;
      requestPayload: Record<string, unknown>;
    }
  | {
      ok: false;
      reason: string;
      retryable: boolean;
      statusCode?: number;
      response?: unknown;
      requestPayload: Record<string, unknown>;
    };

export interface HeartPayPayoutEventData {
  id?: number;
  correlationID?: string;
  referenceCode?: string;
  value?: number;
  amount?: number;
  netAmount?: number;
  feeAmount?: number;
  status?: string;
  pixKey?: string;
  pixKeyType?: HeartPayPixKeyType;
  recipientName?: string | null;
  recipientDocument?: string | null;
  recipientBank?: string | null;
  recipientBankIspb?: string | null;
  recipientBranch?: string | null;
  recipientAccount?: string | null;
  provider?: string;
  providerTransactionId?: string | null;
  providerPaymentId?: string | null;
  userId?: string | null;
  endToEndId?: string | null;
  errorMessage?: string;
  completedAt?: string;
  createdAt?: string;
  source?: string;
  refundedAmount?: number;
  refundEndToEndId?: string;
}

export type HeartPayWebhookEventName =
  | 'PayOutCompleted'
  | 'PayOutFailed'
  | 'PayOutRefunded';

export interface HeartPayWebhookPayload {
  event: HeartPayWebhookEventName | string;
  timestamp?: string;
  test?: boolean;
  data?: {
    data?: HeartPayPayoutEventData;
    event?: string;
  };
}

export interface HeartPayReceipt {
  format: string;
  base64: string;
  correlationID?: string;
  endToEndId?: string;
}

export type GetReceiptResult =
  | { ok: true; receipt: HeartPayReceipt }
  | { ok: false; reason: string; statusCode?: number };

export interface HeartPayBalance {
  availableBalance: number;
  manualBalanceAdjustment?: number;
  totalReceived?: number;
  totalFees?: number;
  totalPayouts?: number;
  totalPendingPayouts?: number;
  totalBlocked?: number;
  withdrawalsBlocked: boolean;
  withdrawalsBlockedReason?: string | null;
}

export type GetBalanceResult =
  | { ok: true; balance: HeartPayBalance }
  | { ok: false; reason: string; statusCode?: number };

export type GetPayoutStatusResult =
  | {
      ok: true;
      data: {
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
    }
  | { ok: false; reason: string; statusCode?: number };
