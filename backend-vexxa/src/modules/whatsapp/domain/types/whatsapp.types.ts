// ─── WhatsApp (Evolution GO) Domain Constants & Types ─────────────────────────
// Shared across client, producer, processor and services.

// ─── BullMQ Queue ─────────────────────────────────────────────────────────────

export const WHATSAPP_QUEUE = 'whatsapp-proof';

export const SEND_PROOF_JOB = 'send-proof';
export const STATUS_POLL_JOB = 'status-poll';

// Fixed repeat key — idempotent across multiple backend instances.
export const STATUS_POLL_REPEAT_JOB_ID = 'repeatable:whatsapp-status-poll';
export const STATUS_POLL_INTERVAL_MS = 60_000;

// jobId builders (evita duplicidade/conflito no BullMQ).
// NOTE: BullMQ rejeita ":" em custom jobId ("Custom Id cannot contain :").
// Usar "__" como separador.
// groupId no jobId → 1 job por (saque, grupo) sem colisão (envio multi-grupo).
// Normaliza o JID p/ jobId válido (BullMQ rejeita ":"; "@"/"." por segurança).
export const proofJobId = (withdrawalId: string, groupId: string): string =>
  `whatsapp-proof__${withdrawalId}__${groupId.replace(/[:@.]/g, '-')}`;
export const testJobId = (logId: string): string =>
  `whatsapp-test__${logId}__${Date.now()}`;
export const retryJobId = (logId: string): string =>
  `whatsapp-retry__${logId}__${Date.now()}`;
export const waitRescheduleJobId = (logId: string): string =>
  `whatsapp-wait__${logId}__${Date.now()}`;

// ─── Template variables ───────────────────────────────────────────────────────

export const TEMPLATE_VARIABLES = [
  'userName',
  'userEmail',
  'amount',
  'date',
  'time',
  'withdrawalId',
  'status',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const MAX_TEMPLATE_LENGTH = 4096;

export const DEFAULT_TEMPLATE = [
  '--------- Vallex Company ---------',
  'Usuário: {{userName}}',
  'Valor: {{amount}}',
  '--------------------------------',
].join('\n');

// ─── Evolution connection states ──────────────────────────────────────────────
// Evolution GO reports raw whatsmeow states; we normalize to these.

export type WhatsappConnectionStatus =
  | 'open'
  | 'close'
  | 'connecting'
  | 'error';

// ─── Evolution API shapes (gin.H — partially typed, defensive parsing) ────────

export interface EvolutionGroup {
  id: string; // e.g. "1234567890-1234567890@g.us"
  name: string; // group subject
  pictureUrl?: string; // foto do grupo, quando a Evolution retorna
}

export interface EvolutionQr {
  qrcode?: string; // base64 or data URI
  pairingCode?: string;
  connected?: boolean;
}

export interface EvolutionSendResult {
  ok: boolean;
  messageId?: string;
  raw?: unknown;
}

// ─── Fallback audit reasons (gravados em evolutionResponse) ───────────────────

export type FallbackReason =
  | 'signed_url_invalid'
  | 'receipt_not_found'
  | 'unsupported_media';

// ─── Detecção de imagem por magic bytes ───────────────────────────────────────
// O comprovante é salvo como base64 PURO; `gatewayReceiptFormat` guarda só o
// subtipo ("png"/"jpeg") e pode vir vazio/errado. Para decidir se é uma imagem
// aceita pela Evolution (jpeg/png/webp) olhamos os bytes do cabeçalho — isso
// independe da string de formato. Retorna o MIME completo ou null (não-imagem).
export function detectImageMime(base64: string): string | null {
  // 24 chars de base64 (múltiplo de 4) → 18 bytes, suficiente p/ o header WebP.
  const head = Buffer.from(base64.slice(0, 24), 'base64');
  if (head.length < 12) return null;
  if (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return 'image/png';
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46 &&
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}
