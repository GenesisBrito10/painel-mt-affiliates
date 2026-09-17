// ─── Settings Domain Constants & Types ────────────────────────────────────────

// ─── Cache ────────────────────────────────────────────────────────────────────

export const SETTINGS_CACHE_TTL_MS = 30_000;

// ─── Known System Setting Keys ────────────────────────────────────────────────
// Canonical list of keys consumed by the application logic.
// Keeps all key strings in one place — avoids magic strings scattered across modules.

export const SYSTEM_SETTINGS_KEYS = [
  'withdrawal_block_active',
  'withdrawal_block_start_date',
  'withdrawal_block_end_date',
  'min_avg_deposit_per_cpa',
  'min_avg_deposit_warning',
  'min_withdrawal_amount',
  'deal_eligibility_window_days',
] as const;

export type SystemSettingKey = (typeof SYSTEM_SETTINGS_KEYS)[number];

// ─── Protected Keys ───────────────────────────────────────────────────────────
// These keys are critical for system operation and cannot be deleted via API.

export const PROTECTED_SETTINGS_KEYS: ReadonlySet<string> = new Set<SystemSettingKey>([
  'withdrawal_block_active',
  'min_withdrawal_amount',
]);
