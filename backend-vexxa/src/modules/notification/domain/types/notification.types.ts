// ─── Notification Domain Constants ────────────────────────────────────────────
// Queue name and job type constants — shared across producer, processor, and service.

// ─── BullMQ Queue Constants ───────────────────────────────────────────────────

export const NOTIFICATION_QUEUE = 'notification';

export const SNAPSHOT_CHECK_JOB = 'snapshot-check';
export const CLEANUP_JOB = 'notification-cleanup';
export const PUSH_BATCH_JOB = 'push-batch';

// ─── Retention ────────────────────────────────────────────────────────────────

export const NOTIFICATION_RETENTION_DAYS = 90;
