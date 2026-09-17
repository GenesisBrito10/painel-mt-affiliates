// Esportiva Diário compartilha a MESMA conta/planilha do Esportiva (outra aba,
// "DIARIO"). Reusa parser/prefixo, o LOCK DE ATRIBUIÇÃO (serializa o sheet
// comum) e os tipos do módulo esportiva. Próprios: slug, scheduler lock e —
// importante — o CPA é MANUAL (admin/convidante seta depois; createRequest não
// resolve CPA, request fica PENDING sem resolvedCpa até ser setado).
export {
  ESPORTIVA_MARKED_STATUS,
  ESPORTIVA_LOCK_KEY,
  ESPORTIVA_LOCK_TTL_SECONDS,
  ESPORTIVA_BACKOFF_DELAYS_MS,
  ESPORTIVA_FAMILY_SLUGS,
  ESPORTIVA_CAMPAIGN_PREFIX,
  buildEsportivaCampaignId,
} from '../../esportiva-link-pool/domain/esportiva.types.js';
export type {
  SheetRow,
  AssignReason,
  AssignResult,
  PoolStatus,
} from '../../esportiva-link-pool/domain/esportiva.types.js';

export const ESPORTIVA_DIARIO_SLUG = 'esportiva-diario';

export const ESPORTIVA_DIARIO_SCHEDULER_LOCK_KEY =
  'esportiva-diario:scheduler:lock';
export const ESPORTIVA_DIARIO_SCHEDULER_LOCK_TTL_SECONDS = 120;
