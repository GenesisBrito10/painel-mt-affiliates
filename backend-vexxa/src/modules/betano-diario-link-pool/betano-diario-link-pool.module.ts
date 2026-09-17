import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { SettingsModule } from '../settings/index.js';
import { BetanoDiarioAssignmentService } from './application/betano-diario-assignment.service.js';
import { BetanoDiarioMetricsSheetService } from './application/betano-diario-metrics-sheet.service.js';
import { BetanoDiarioMetricsSyncService } from './application/betano-diario-metrics-sync.service.js';
import { BetanoDiarioSchedulerService } from './application/betano-diario-scheduler.service.js';
import { BetanoDiarioSheetService } from './application/betano-diario-sheet.service.js';
import { BetanoDiarioAdminController } from './infrastructure/betano-diario-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
    SettingsModule,
  ],
  controllers: [BetanoDiarioAdminController],
  providers: [
    BetanoDiarioSheetService,
    BetanoDiarioMetricsSheetService,
    BetanoDiarioMetricsSyncService,
    BetanoDiarioAssignmentService,
    BetanoDiarioSchedulerService,
  ],
  exports: [BetanoDiarioAssignmentService],
})
export class BetanoDiarioLinkPoolModule {}
