// Betano Diário possui planilha, pool e bucket de métricas próprios. O lock de
// atribuição continua compartilhado com o Betano para preservar a exclusão
// mútua da família enquanto uma solicitação é resolvida.
export {
  BETANO_MARKED_STATUS,
  BETANO_LOCK_KEY,
  BETANO_LOCK_TTL_SECONDS,
  BETANO_BACKOFF_DELAYS_MS,
  BETANO_FAMILY_SLUGS,
  extractBetanoCampaignId,
} from '../../betano-link-pool/domain/betano.types.js';
export type {
  SheetRow,
  AssignReason,
  AssignResult,
  PoolStatus,
  ParsedBetanoUrl,
} from '../../betano-link-pool/domain/betano.types.js';

export const BETANO_DIARIO_SLUG = 'betano-diario';

// Lock do scheduler é PRÓPRIO (cada scheduler roda); a serialização do acesso
// ao sheet vem do BETANO_LOCK_KEY compartilhado na atribuição.
export const BETANO_DIARIO_SCHEDULER_LOCK_KEY = 'betano-diario:scheduler:lock';
export const BETANO_DIARIO_SCHEDULER_LOCK_TTL_SECONDS = 120;

export const BETANO_DIARIO_DEFAULT_CPA = 60;
export const BETANO_DIARIO_DEFAULT_REVSHARE = 0;
