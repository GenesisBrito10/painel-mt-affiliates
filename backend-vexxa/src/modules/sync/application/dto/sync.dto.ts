import type { AccountWithHouses } from '../../../../modules/provider-account/domain/types/provider-account.types.js';

export interface TriggerSyncDto {
  account: AccountWithHouses;
  houseSlug: string;
  bookmarkerId: string;
  triggeredBy: 'cron' | 'admin' | 'startup' | string;
  /** Override dates to sync; defaults to current month */
  dates?: string[];
}

export interface SyncStats {
  total: number;
  inserted: number;
  updated: number;
  errors: number;
}

export interface SyncResultDto {
  success: boolean;
  houseSlug: string;
  triggeredBy: string;
  gapsFilled: number;
  stats: SyncStats;
}

export interface AdminTriggerSyncDto {
  /** If omitted, trigger all active houses */
  bettingHouseSlug?: string;
}
