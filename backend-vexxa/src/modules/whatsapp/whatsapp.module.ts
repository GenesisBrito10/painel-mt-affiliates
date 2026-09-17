import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationModule } from '../notification/index.js';
import { WHATSAPP_QUEUE } from './domain/types/whatsapp.types.js';
import { EvolutionClient } from './infrastructure/clients/evolution.client.js';
import { WhatsappSettingsService } from './application/whatsapp-settings.service.js';
import { WhatsappTargetGroupService } from './application/whatsapp-target-group.service.js';
import { WhatsappConnectionService } from './application/whatsapp-connection.service.js';
import { WhatsappProofService } from './application/whatsapp-proof.service.js';
import { WhatsappReceiptUrlService } from './application/whatsapp-receipt-url.service.js';
import { WhatsappSendHistoryService } from './application/whatsapp-send-history.service.js';
import { WhatsappProofSweepService } from './application/whatsapp-proof-sweep.service.js';
import { WhatsappProofProducer } from './infrastructure/queues/whatsapp-proof.producer.js';
import { WhatsappProofProcessor } from './infrastructure/queues/whatsapp-proof.processor.js';
import { WhatsappController } from './infrastructure/whatsapp.controller.js';
import { WhatsappWebhookController } from './infrastructure/whatsapp-webhook.controller.js';
import { WhatsappReceiptController } from './infrastructure/whatsapp-receipt.controller.js';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    NotificationModule,
    BullModule.registerQueue({ name: WHATSAPP_QUEUE }),
  ],
  controllers: [
    WhatsappController,
    WhatsappWebhookController,
    WhatsappReceiptController,
  ],
  providers: [
    EvolutionClient,
    WhatsappSettingsService,
    WhatsappTargetGroupService,
    WhatsappConnectionService,
    WhatsappProofService,
    WhatsappReceiptUrlService,
    WhatsappSendHistoryService,
    WhatsappProofProducer,
    WhatsappProofProcessor,
    WhatsappProofSweepService,
  ],
  exports: [
    WhatsappProofProducer,
    EvolutionClient,
    WhatsappSettingsService,
    WhatsappTargetGroupService,
  ],
})
export class WhatsappModule implements OnModuleInit {
  constructor(private readonly producer: WhatsappProofProducer) {}

  async onModuleInit(): Promise<void> {
    await this.producer.scheduleStatusPoll();
  }
}
