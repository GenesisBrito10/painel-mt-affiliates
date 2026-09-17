import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/index.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { HiperbetAssignmentService } from './application/hiperbet-assignment.service.js';
import { HiperbetSchedulerService } from './application/hiperbet-scheduler.service.js';
import { HiperbetSheetService } from './application/hiperbet-sheet.service.js';
import { HiperbetMetricsSheetService } from './application/hiperbet-metrics-sheet.service.js';
import { HiperbetMetricsSyncService } from './application/hiperbet-metrics-sync.service.js';
import { HiperbetAdminController } from './infrastructure/hiperbet-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    SettingsModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [HiperbetAdminController],
  providers: [
    HiperbetSheetService,
    HiperbetAssignmentService,
    HiperbetSchedulerService,
    HiperbetMetricsSheetService,
    HiperbetMetricsSyncService,
  ],
  exports: [HiperbetAssignmentService],
})
export class HiperbetLinkPoolModule {}
