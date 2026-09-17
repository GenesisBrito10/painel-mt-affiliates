// Pinbet Diário — pool de links próprio (planilha "Diário"), provedor Smartico.
// O affiliate_data vem tagueado na casa-FONTE `pinbet` (ver HOUSE_DATA_SOURCE);
// aqui só o bucket de saldo, a regra de CPA (padrão 40) e o slug são próprios.
export const PINBET_DIARIO_SLUG = 'pinbet-diario';
export const PINBET_MENSAL_SLUG = 'pinbet-mensal';

export const PINBET_DIARIO_LOCK_KEY = 'pinbet-diario:assign:lock';
export const PINBET_DIARIO_LOCK_TTL_SECONDS = 30;
export const PINBET_DIARIO_BACKOFF_DELAYS_MS = [200, 400, 800, 1600, 3200];
export const PINBET_MARKED_STATUS = 'marcado';

export const PINBET_DIARIO_SCHEDULER_LOCK_KEY = 'pinbet-diario:scheduler:lock';
export const PINBET_DIARIO_SCHEDULER_LOCK_TTL_SECONDS = 120;

export const PINBET_DIARIO_DEFAULT_CPA = 40;
export const PINBET_DIARIO_DEFAULT_REVSHARE = 0;

// Casas que compartilham o mesmo campaignId physical space (afp1 é único por
// afiliado). A atribuição checa conflito em TODAS — impede o mesmo afp1 virar
// link em diário E mensal ao mesmo tempo.
export const PINBET_FAMILY_SLUGS = [PINBET_DIARIO_SLUG, PINBET_MENSAL_SLUG];

// Schema da planilha (header em row 1):
// A=IDENTIFICAÇÃO, B=CÓDIGO(afp1), C=LINKS, D=STATUS, E=E-MAIL.
export interface SheetRow {
  rowIndex: number;
  identificacao: string;
  code: string; // CÓDIGO = afp1
  link: string;
  status: string;
  email: string;
}

/** Dimensão do campaignId: afp1 (diário) ou afp2 (mensal). */
export type PinbetAfpParam = 'afp1' | 'afp2';

/**
 * Extrai o afpN (campaignId) do link, ex.:
 *   https://go.aff.pin.bet.br/cpf4kdz3?afp1=VALLEX0001 → "VALLEX0001".
 * `param` = 'afp1' (diário, default) ou 'afp2' (mensal). Fallback quando a
 * coluna CÓDIGO estiver vazia.
 */
export function extractPinbetAfp(
  url: string,
  param: PinbetAfpParam = 'afp1',
): string | null {
  try {
    const parsed = new URL(url);
    const v = parsed.searchParams.get(param);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * campaignId = coluna CÓDIGO (o valor já é o afpN da aba); fallback = afpN do
 * link. Diário usa afp1 (default); mensal passa 'afp2'.
 */
export function resolvePinbetCampaignId(
  row: SheetRow,
  param: PinbetAfpParam = 'afp1',
): string | null {
  if (row.code) return row.code;
  return extractPinbetAfp(row.link, param);
}

export type AssignReason =
  | 'lock_busy'
  | 'pool_empty'
  | 'all_conflicts'
  | 'sheet_read_failed'
  | 'redis_unavailable'
  | 'request_not_found'
  | 'already_fulfilled'
  | 'commission_not_set';

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
