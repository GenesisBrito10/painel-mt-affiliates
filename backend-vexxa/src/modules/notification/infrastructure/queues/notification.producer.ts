import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  NOTIFICATION_QUEUE,
  SNAPSHOT_CHECK_JOB,
  CLEANUP_JOB,
} from '../../domain/types/notification.types.js';

@Injectable()
export class NotificationProducer {
  private readonly logger = new Logger(NotificationProducer.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly queue: Queue,
  ) {}

  /**
   * Register repeatable jobs on application startup.
   * BullMQ deduplicates by repeat key — safe to call on every boot.
   */
  async scheduleRepeatingJobs(): Promise<void> {
    // Snapshot metric diff — every 4 hours (BRT)
    await this.queue.add(
      SNAPSHOT_CHECK_JOB,
      {},
      {
        repeat: {
          pattern: '0 */4 * * *',
          tz: 'America/Sao_Paulo',
        },
        jobId: 'repeatable:snapshot-check',
      },
    );

    // Old notification cleanup — daily at 03:00 BRT
    await this.queue.add(
      CLEANUP_JOB,
      {},
      {
        repeat: {
          pattern: '0 3 * * *',
          tz: 'America/Sao_Paulo',
        },
        jobId: 'repeatable:notification-cleanup',
      },
    );

    this.logger.log('Repeatable notification jobs registered');
  }
}
