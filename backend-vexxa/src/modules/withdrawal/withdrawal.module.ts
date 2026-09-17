import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { NotificationModule } from '../notification/index.js';
import { PaymentGatewayModule } from '../payment-gateway/index.js';
import { WhatsappModule } from '../whatsapp/index.js';
import { FileUploadModule } from '../file-upload/file-upload.module.js';
import { LinkWebhookModule } from '../link-webhook/index.js';
import { WithdrawalController } from './infrastructure/withdrawal.controller.js';
import { VorexyWebhookController } from './infrastructure/vorexy-webhook.controller.js';
import { GatewayWebhookController } from './infrastructure/gateway-webhook.controller.js';
import { WithdrawalService } from './application/withdrawal.service.js';
import { WithdrawalReconcileService } from './application/withdrawal-reconcile.service.js';
import { ReceiptGeneratorService } from './application/receipt-generator.service.js';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    DashboardModule,
    NotificationModule,
    PaymentGatewayModule,
    WhatsappModule,
    FileUploadModule,
    LinkWebhookModule,
  ],
  controllers: [
    WithdrawalController,
    VorexyWebhookController,
    GatewayWebhookController,
  ],
  providers: [
    WithdrawalService,
    WithdrawalReconcileService,
    ReceiptGeneratorService,
  ],
  exports: [WithdrawalService],
})
export class WithdrawalModule {}
