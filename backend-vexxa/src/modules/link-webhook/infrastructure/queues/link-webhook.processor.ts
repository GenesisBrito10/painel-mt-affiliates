import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LinkWebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { LinkWebhookSettingsService } from '../../application/link-webhook-settings.service.js';
import {
  LinkWebhookHttpService,
  WebhookHttpError,
} from '../../application/link-webhook-http.service.js';
import {
  LINK_WEBHOOK_QUEUE,
  LINK_WEBHOOK_MAX_ATTEMPTS,
} from '../../domain/types/link-webhook.types.js';
import type { DeliverJobData } from './link-webhook.producer.js';

@Processor(LINK_WEBHOOK_QUEUE)
export class LinkWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(LinkWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LinkWebhookSettingsService,
    private readonly http: LinkWebhookHttpService,
  ) {
    super();
  }

  async process(job: Job<DeliverJobData>): Promise<void> {
    const { deliveryId } = job.data;
    const attemptNo = job.attemptsMade + 1; // attemptsMade = already-failed count
    const isFinalAttempt = attemptNo >= LINK_WEBHOOK_MAX_ATTEMPTS;

    const delivery = await this.prisma.linkWebhookDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        ownerUserId: true,
        status: true,
        payload: true,
      },
    });

    if (!delivery) {
      this.logger.warn(`Delivery ${deliveryId} not found — dropping job`);
      return;
    }
    if (delivery.status === LinkWebhookDeliveryStatus.SUCCESS) {
      return; // already delivered (idempotent)
    }

    // Re-resolve the live target config (url + decrypted secret) by owner.
    const target = await this.settings.getSettingsRow(delivery.ownerUserId);
    if (!target.enabled || !target.webhookUrl.trim()) {
      await this.markFailed(
        deliveryId,
        attemptNo,
        'Webhook desabilitado ou sem URL',
      );
      return; // don't retry a removed target
    }

    try {
      const result = await this.http.post(
        target.webhookUrl,
        target.webhookSecret,
        delivery.payload as Record<string, unknown>,
        deliveryId,
      );
      await this.prisma.linkWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: LinkWebhookDeliveryStatus.SUCCESS,
          httpStatus: result.httpStatus,
          responseBody: result.responseBody.slice(0, 4000),
          errorMessage: null,
          attempts: attemptNo,
          deliveredAt: new Date(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook failed';
      const httpStatus =
        err instanceof WebhookHttpError ? err.httpStatus : null;

      await this.prisma.linkWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: isFinalAttempt
            ? LinkWebhookDeliveryStatus.FAILED
            : LinkWebhookDeliveryStatus.PENDING,
          httpStatus,
          errorMessage: message.slice(0, 2000),
          attempts: attemptNo,
        },
      });

      this.logger.warn(
        `Webhook delivery ${deliveryId} attempt ${attemptNo}/${LINK_WEBHOOK_MAX_ATTEMPTS} failed: ${message}`,
      );
      // Rethrow so BullMQ retries with backoff (until attempts exhausted).
      throw err;
    }
  }

  private async markFailed(
    deliveryId: string,
    attempts: number,
    message: string,
  ): Promise<void> {
    await this.prisma.linkWebhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: LinkWebhookDeliveryStatus.FAILED,
        errorMessage: message.slice(0, 2000),
        attempts,
      },
    });
  }
}
