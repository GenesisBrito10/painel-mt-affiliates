import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationService } from '../../application/notification.service.js';
import { WebPushService } from '../push/web-push.service.js';
import {
  NOTIFICATION_QUEUE,
  SNAPSHOT_CHECK_JOB,
  CLEANUP_JOB,
  PUSH_BATCH_JOB,
  NOTIFICATION_RETENTION_DAYS,
} from '../../domain/types/notification.types.js';

interface PushBatchJobData {
  userIds: string[];
  payload: { title: string; body: string; url?: string };
}

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly webPushService: WebPushService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SNAPSHOT_CHECK_JOB:
        return this.handleSnapshotCheck();
      case CLEANUP_JOB:
        return this.handleCleanup();
      case PUSH_BATCH_JOB:
        return this.handlePushBatch(job.data as PushBatchJobData);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  // ─── Snapshot metric diff ─────────────────────────────────────────────────

  private async handleSnapshotCheck(): Promise<void> {
    this.logger.log('Running notification snapshot check');

    const affiliateIds =
      await this.notificationService.findActiveAffiliateIds();

    if (affiliateIds.length === 0) {
      this.logger.debug('No active affiliates to check');
      return;
    }

    let notificationsCreated = 0;

    for (const userId of affiliateIds) {
      try {
        notificationsCreated += await this.checkAffiliateMetrics(userId);
      } catch (err: unknown) {
        this.logger.error(
          `Snapshot check failed for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Snapshot check complete — ${notificationsCreated} notification(s) created`,
    );
  }

  private async checkAffiliateMetrics(userId: string): Promise<number> {
    // This is called per-affiliate. The snapshot check compares last known
    // values vs current AffiliateData aggregation. The actual aggregation query
    // lives in the Prisma repository (findCurrentMetrics) injected here
    // for separation of concerns. For simplicity, the processor delegates
    // back to the service which exposes snapshot upsert.
    // Full metric comparison is implementation detail in the repository.

    // Per-house metric diffing not yet implemented.
    // 'all' is not a valid betting_houses slug — skip upsert to avoid FK violation.
    return 0;
  }

  // ─── Cleanup old notifications ────────────────────────────────────────────

  private async handleCleanup(): Promise<void> {
    this.logger.log(
      `Running notification cleanup (older than ${NOTIFICATION_RETENTION_DAYS} days)`,
    );

    const deleted = await this.notificationService.deleteOlderThan(
      NOTIFICATION_RETENTION_DAYS,
    );

    this.logger.log(
      `Notification cleanup complete — ${deleted} notification(s) removed`,
    );
  }

  // ─── Push batch dispatch ──────────────────────────────────────────────────

  private async handlePushBatch(data: PushBatchJobData): Promise<void> {
    const { userIds, payload } = data;

    if (!userIds || userIds.length === 0) return;

    this.logger.debug(`Dispatching push to ${userIds.length} user(s)`);

    const subscriptions =
      await this.notificationService.getPushSubscriptionsForUsers(userIds);

    if (subscriptions.length === 0) {
      this.logger.debug('No push subscriptions found for target users');
      return;
    }

    let sent = 0;
    let removed = 0;

    for (const sub of subscriptions) {
      const success = await this.webPushService.send(
        {
          id: sub.id,
          endpoint: sub.endpoint,
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
        payload,
      );

      if (!success) {
        // Subscription expired — remove it
        await this.notificationService
          .deletePushSubscriptionById(sub.id)
          .catch(() => undefined);
        removed++;
      } else {
        sent++;
      }
    }

    this.logger.log(
      `Push batch complete — ${sent} sent, ${removed} expired subscriptions removed`,
    );
  }
}
