import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinkWebhookService } from './application/link-webhook.service.js';
import { LinkWebhookSettingsService } from './application/link-webhook-settings.service.js';
import { LinkWebhookHttpService } from './application/link-webhook-http.service.js';
import { LinkWebhookController } from './infrastructure/link-webhook.controller.js';
import { LinkWebhookAdminController } from './infrastructure/link-webhook-admin.controller.js';
import { ApiAccessGuard } from '../auth/index.js';
import { LinkWebhookProducer } from './infrastructure/queues/link-webhook.producer.js';
import { LinkWebhookProcessor } from './infrastructure/queues/link-webhook.processor.js';
import { LINK_WEBHOOK_QUEUE } from './domain/types/link-webhook.types.js';

// CryptoService is provided by the @Global SharedModule.
@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: LINK_WEBHOOK_QUEUE }),
  ],
  controllers: [LinkWebhookController, LinkWebhookAdminController],
  providers: [
    LinkWebhookService,
    LinkWebhookSettingsService,
    LinkWebhookHttpService,
    LinkWebhookProducer,
    LinkWebhookProcessor,
    ApiAccessGuard,
  ],
  exports: [LinkWebhookService],
})
export class LinkWebhookModule {}
