export const LINK_WEBHOOK_EVENTS = {
  APPROVED: 'link_request.approved',
  REJECTED: 'link_request.rejected',
  CREATED: 'link_request.created',
  AFFILIATE_DATA_SYNCED: 'affiliate_data.synced',
  DEAL_UPDATED: 'deal.updated',
  HOUSE_UPDATED: 'house.updated',
  WITHDRAWAL_CREATED: 'withdrawal.created',
  WITHDRAWAL_STATUS_CHANGED: 'withdrawal.status_changed',
} as const;

export type LinkWebhookEvent =
  (typeof LINK_WEBHOOK_EVENTS)[keyof typeof LINK_WEBHOOK_EVENTS];

export const ALL_LINK_WEBHOOK_EVENTS: LinkWebhookEvent[] =
  Object.values(LINK_WEBHOOK_EVENTS);

// Human-readable catalog (also surfaced by the API for the frontend docs/UI).
export const LINK_WEBHOOK_EVENT_CATALOG: Record<LinkWebhookEvent, string> = {
  [LINK_WEBHOOK_EVENTS.CREATED]: 'Disparado quando um pedido de link é criado',
  [LINK_WEBHOOK_EVENTS.APPROVED]:
    'Disparado quando um pedido de link é aprovado/atribuído',
  [LINK_WEBHOOK_EVENTS.REJECTED]:
    'Disparado quando um pedido de link é rejeitado/bloqueado',
  [LINK_WEBHOOK_EVENTS.AFFILIATE_DATA_SYNCED]:
    'Disparado após cada ciclo de sincronização (cron) gravar dados de uma casa',
  [LINK_WEBHOOK_EVENTS.DEAL_UPDATED]:
    'Disparado quando um deal (CPA/revshare) é alterado',
  [LINK_WEBHOOK_EVENTS.HOUSE_UPDATED]:
    'Disparado quando uma casa de aposta é alterada',
  [LINK_WEBHOOK_EVENTS.WITHDRAWAL_CREATED]:
    'Disparado quando um saque é solicitado (inclui saques via API)',
  [LINK_WEBHOOK_EVENTS.WITHDRAWAL_STATUS_CHANGED]:
    'Disparado quando o status de um saque muda (processing/completed/rejected/failed)',
};

export const LINK_WEBHOOK_ORIGINS = {
  ADMIN_APPROVE: 'ADMIN_APPROVE',
  ADMIN_REJECT: 'ADMIN_REJECT',
  LEADER_APPROVE: 'LEADER_APPROVE',
  LEADER_REJECT: 'LEADER_REJECT',
  AUTO_ASSIGN: 'AUTO_ASSIGN',
  RULE_BLOCKED: 'RULE_BLOCKED',
  DEPENDENCY_BLOCKED: 'DEPENDENCY_BLOCKED',
  BACKFILL_REJECT: 'BACKFILL_REJECT',
  CREATED: 'CREATED',
  SYNC: 'SYNC',
  DEAL: 'DEAL',
  HOUSE: 'HOUSE',
  WITHDRAWAL: 'WITHDRAWAL',
  REDELIVERY: 'REDELIVERY',
  TEST: 'TEST',
} as const;

export const LINK_WEBHOOK_HTTP_TIMEOUT_MS = 15_000;

// Redelivery / retry tuning for the BullMQ queue.
export const LINK_WEBHOOK_QUEUE = 'link-webhook-delivery';
export const LINK_WEBHOOK_MAX_ATTEMPTS = 6;
export const LINK_WEBHOOK_BACKOFF_MS = 30_000;

// Replay-protection tolerance recommended to consumers (informational).
export const LINK_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
