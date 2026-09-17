/** Default fee rate applied when 'withdrawal_fee_rate' is not configured in Settings */
export const DEFAULT_WITHDRAWAL_FEE_RATE = 0.06; // 6%

/** Settings keys consumed by the withdrawal flow */
export const WITHDRAWAL_SETTINGS_KEYS = [
  'withdrawal_block_active',
  'withdrawal_block_start_date',
  'withdrawal_block_end_date',
  'min_avg_deposit_per_cpa',
  'min_withdrawal_amount',
  'withdrawal_fee_rate',
] as const;

export type WithdrawalRefundState = 'NONE' | 'PARTIAL' | 'FULL';

export interface WithdrawalListItem {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  /** Net amount after fee */
  amount: number;
  /** Gross amount before fee */
  originalAmount: number;
  withdrawalFee: number;
  bettingHouse: string;
  pixKeyType: string;
  pixKey: string;
  accountHolder: string;
  status: string; // PENDING | APPROVED | PROCESSING | COMPLETED | REJECTED | FAILED
  requestNote: string;
  adminNote: string;
  /** Gateway/internal failure reason (filled on FAILED — e.g. "Chave Pix não encontrada") */
  gatewayFailureReason: string | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  approvedByEmail: string | null;
  createdAt: Date;
  hasReceipt: boolean;
  refundedAmount: number | null;
  refundState: WithdrawalRefundState;
  /**
   * True when this is an API/external withdrawal (User.isExternal). These are
   * created and resolved by a third-party partner via the affiliate-API and are
   * hidden from the global admin list — surfaced only in the affiliate detail
   * tab (with a badge). Optional: defaults undefined for internal rows.
   */
  isExternal?: boolean;
  /** For external rows: the partner (referrer) who handled it via the API. */
  externalApprovedByName?: string | null;
  externalApprovedByEmail?: string | null;
}

/**
 * Refund is orthogonal to status — a COMPLETED withdrawal may carry
 * NONE/PARTIAL/FULL refund. 1-cent tolerance covers Decimal rounding
 * when classifying FULL.
 */
export function deriveRefundState(
  originalAmount: number,
  refundedAmount: number | null,
): WithdrawalRefundState {
  if (refundedAmount === null || refundedAmount <= 0) return 'NONE';
  if (refundedAmount + 0.01 >= originalAmount) return 'FULL';
  return 'PARTIAL';
}

export interface WithdrawalCreateResult {
  id: string;
  amount: number;
  originalAmount: number;
  withdrawalFee: number;
  bettingHouse: string;
  status: string;
  requestNote: string;
  createdAt: Date;
}
