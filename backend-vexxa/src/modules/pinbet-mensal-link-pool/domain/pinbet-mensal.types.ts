// Pinbet Mensal — compartilha o provedor Smartico (casa-fonte `pinbet`) com o
// Pinbet Diário. Reusa o parser de afp1, o schema da planilha e a família de
// slugs; só o slug, os locks, o bucket e a regra de CPA (padrão 70) são próprios.
//
// ⚠️ INATIVO: ainda não há planilha (PINBET_MENSAL_SHEET_ID). A casa/deal ficam
// active:false e requestEnabled:false no seed — o código já está pronto para
// quando a planilha existir (basta configurar o env + ativar no banco).
export {
  PINBET_MARKED_STATUS,
  PINBET_FAMILY_SLUGS,
  PINBET_MENSAL_SLUG,
  extractPinbetAfp,
  resolvePinbetCampaignId,
} from '../../pinbet-diario-link-pool/domain/pinbet-diario.types.js';
export type {
  SheetRow,
  AssignReason,
  AssignResult,
  PoolStatus,
} from '../../pinbet-diario-link-pool/domain/pinbet-diario.types.js';

export const PINBET_MENSAL_LOCK_KEY = 'pinbet-mensal:assign:lock';
export const PINBET_MENSAL_LOCK_TTL_SECONDS = 30;
export const PINBET_MENSAL_BACKOFF_DELAYS_MS = [200, 400, 800, 1600, 3200];

export const PINBET_MENSAL_SCHEDULER_LOCK_KEY = 'pinbet-mensal:scheduler:lock';
export const PINBET_MENSAL_SCHEDULER_LOCK_TTL_SECONDS = 120;

export const PINBET_MENSAL_DEFAULT_CPA = 70;
export const PINBET_MENSAL_DEFAULT_REVSHARE = 0;
