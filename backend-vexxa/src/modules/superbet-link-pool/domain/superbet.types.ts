export const SUPERBET_SLUG = 'superbet';
export const SUPERBET_LOCK_KEY = 'superbet:assign:lock';
export const SUPERBET_LOCK_TTL_SECONDS = 30;
export const SUPERBET_BACKOFF_DELAYS_MS = [200, 400, 800, 1600, 3200];

// Lock no nível do scheduler para impedir batches concorrentes (cluster/PM2).
export const SUPERBET_SCHEDULER_LOCK_KEY = 'superbet:scheduler:lock';
export const SUPERBET_SCHEDULER_LOCK_TTL_SECONDS = 120;

export const SUPERBET_DEFAULT_CPA = 100;
export const SUPERBET_DEFAULT_REVSHARE = 0;
export const SUPERBET_MARKED_STATUS = 'marcado';

export interface SheetRow {
  rowIndex: number;
  link: string;
  status: string;
  email: string;
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
      affiliateId: string;
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

export interface ParsedSuperbetUrl {
  siteid: string;
  c: string;
}

// Superbet URL: ?siteid=32666&c=LMM277 (only siteid and c are read).
// campaignId convention = `${siteid}-${c}`.
export function extractSuperbetCampaignId(
  url: string,
): ParsedSuperbetUrl | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const siteid = parsed.searchParams.get('siteid');
    const c = parsed.searchParams.get('c');
    if (!siteid || !c) return null;
    return { siteid, c };
  } catch {
    return null;
  }
}
