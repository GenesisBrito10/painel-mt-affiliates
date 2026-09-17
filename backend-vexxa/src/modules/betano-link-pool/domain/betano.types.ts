export const BETANO_SLUG = 'betano';
export const BETANO_LOCK_KEY = 'betano:assign:lock';
export const BETANO_LOCK_TTL_SECONDS = 30;
export const BETANO_BACKOFF_DELAYS_MS = [200, 400, 800, 1600, 3200];

// Lock no nível do scheduler para impedir batches concorrentes (cluster/PM2).
export const BETANO_SCHEDULER_LOCK_KEY = 'betano:scheduler:lock';
export const BETANO_SCHEDULER_LOCK_TTL_SECONDS = 120;

export const BETANO_DEFAULT_CPA = 100;
export const BETANO_DEFAULT_REVSHARE = 0;
export const BETANO_MARKED_STATUS = 'marcado';

// Casas que COMPARTILHAM o mesmo pool físico de links (mesma conta/planilha
// Betano). A atribuição checa conflito de campaignId em TODAS elas pra nunca
// dar o mesmo link físico a duas casas. 'betano-diario' tira do mesmo sheet.
export const BETANO_FAMILY_SLUGS = ['betano', 'betano-diario'];

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

export interface ParsedBetanoUrl {
  siteid: string;
  c: string;
}

// Betano usa siteid + c (Superbet usa siteid + c). Mesma forma de montar
// o campaignId: `${siteid}-${c}`.
export function extractBetanoCampaignId(url: string): ParsedBetanoUrl | null {
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
