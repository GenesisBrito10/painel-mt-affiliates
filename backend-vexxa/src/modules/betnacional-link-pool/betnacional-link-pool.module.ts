import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/index.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { BetnacionalAssignmentService } from './application/betnacional-assignment.service.js';
import { BetnacionalSchedulerService } from './application/betnacional-scheduler.service.js';
import { BetnacionalSheetService } from './application/betnacional-sheet.service.js';
import { BetnacionalMetricsSheetService } from './application/betnacional-metrics-sheet.service.js';
import { BetnacionalMetricsSyncService } from './application/betnacional-metrics-sync.service.js';
import { BetnacionalAdminController } from './infrastructure/betnacional-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    SettingsModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [BetnacionalAdminController],
  providers: [
    BetnacionalSheetService,
    BetnacionalAssignmentService,
    BetnacionalSchedulerService,
    BetnacionalMetricsSheetService,
    BetnacionalMetricsSyncService,
  ],
  exports: [BetnacionalAssignmentService],
})
export class BetnacionalLinkPoolModule {}
