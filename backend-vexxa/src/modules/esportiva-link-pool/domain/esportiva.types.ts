export const ESPORTIVA_SLUG = 'esportivabet';
export const ESPORTIVA_LOCK_KEY = 'esportiva:assign:lock';
export const ESPORTIVA_LOCK_TTL_SECONDS = 30;
export const ESPORTIVA_BACKOFF_DELAYS_MS = [200, 400, 800, 1600, 3200];
export const ESPORTIVA_MARKED_STATUS = 'marcado';

export const ESPORTIVA_SCHEDULER_LOCK_KEY = 'esportiva:scheduler:lock';
export const ESPORTIVA_SCHEDULER_LOCK_TTL_SECONDS = 120;

// O campaignId salvo no sistema é prefixado: planilha "CAMPANHA 1" →
// "MJM COMPANY - CAMPANHA 1" (mesmo formato que o sync de AffiliateData produz,
// usado como chave de junção).
export const ESPORTIVA_CAMPAIGN_PREFIX = 'MJM COMPANY - ';

// Casas que COMPARTILHAM o mesmo pool físico (mesma conta/planilha esportiva).
// A atribuição checa conflito de campaignId em TODAS elas — 'esportiva-diario'
// usa o mesmo arquivo (outra aba). Evita dar o mesmo link a duas casas.
export const ESPORTIVA_FAMILY_SLUGS = ['esportivabet', 'esportiva-diario'];

export function buildEsportivaCampaignId(sheetId: string): string {
  return `${ESPORTIVA_CAMPAIGN_PREFIX}${sheetId.trim()}`;
}

// Schema da planilha: A=ID, B=LINK, C=EMAIL, D=STATUS (header em row 1).
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
