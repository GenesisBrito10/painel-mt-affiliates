import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  LINK_WEBHOOK_QUEUE,
  LINK_WEBHOOK_MAX_ATTEMPTS,
  LINK_WEBHOOK_BACKOFF_MS,
} from '../../domain/types/link-webhook.types.js';

export const LINK_WEBHOOK_DELIVER_JOB = 'deliver';

export interface DeliverJobData {
  deliveryId: string;
}

@Injectable()
export class LinkWebhookProducer {
  private readonly logger = new Logger(LinkWebhookProducer.name);

  constructor(
    @InjectQueue(LINK_WEBHOOK_QUEUE)
    private readonly queue: Queue,
  ) {}

  /**
   * Enqueue a single delivery. Exponential backoff + bounded attempts; the
   * delivery row already exists (PENDING) so the worker is idempotent by id.
   */
  async enqueueDelivery(deliveryId: string): Promise<void> {
    await this.queue.add(
      LINK_WEBHOOK_DELIVER_JOB,
      { deliveryId } satisfies DeliverJobData,
      {
        // jobId must not contain ':' — BullMQ reserves it as its key separator
        // and throws "Custom Id cannot contain ':'" (regression in bullmq >=5).
        jobId: `delivery_${deliveryId}`,
        attempts: LINK_WEBHOOK_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: LINK_WEBHOOK_BACKOFF_MS },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
    this.logger.debug(`Enqueued webhook delivery ${deliveryId}`);
  }
}
