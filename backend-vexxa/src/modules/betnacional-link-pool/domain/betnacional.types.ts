export const BETNACIONAL_SLUG = 'betnacional';
export const BETNACIONAL_LOCK_KEY = 'betnacional:assign:lock';
export const BETNACIONAL_LOCK_TTL_SECONDS = 30;
export const BETNACIONAL_BACKOFF_DELAYS_MS = [200, 400, 800, 1600, 3200];
export const BETNACIONAL_MARKED_STATUS = 'marcado';

export const BETNACIONAL_SCHEDULER_LOCK_KEY = 'betnacional:scheduler:lock';
export const BETNACIONAL_SCHEDULER_LOCK_TTL_SECONDS = 120;

export const BETNACIONAL_DEFAULT_CPA = 90;
export const BETNACIONAL_DEFAULT_REVSHARE = 0;

// Schema da planilha: A=ID, B=Link, C=Email, D=Status (header em row 1).
export interface SheetRow {
  rowIndex: number;
  id: string;
  link: string;
  email: string;
  status: string;
}

export type AssignReason =
  | 'lock_busy'
  | 'pool_empty'
  | 'all_conflicts'
  | 'sheet_read_failed'
  | 'redis_unavailable'
  | 'commission_not_set'
  | 'request_not_found'
  | 'already_fulfilled';

export type AssignResult =
  | {
      assigned: true;
      campaignId: string;
      link: string;
      rowIndex: number;
      email: string;
    }
  | { assigned: false; reason: AssignReason };

export interface PoolStatus {
  total: number;
  available: number;
  used: number;
  inconsistencies: number;
}
