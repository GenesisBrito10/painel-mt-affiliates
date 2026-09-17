import { Module } from '@nestjs/common';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/index.js';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SportingbetDiarioAssignmentService } from './application/sportingbet-diario-assignment.service.js';
import { SportingbetDiarioSchedulerService } from './application/sportingbet-diario-scheduler.service.js';
import { SportingbetDiarioSheetService } from './application/sportingbet-diario-sheet.service.js';
import { SportingbetDiarioAdminController } from './infrastructure/sportingbet-diario-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [SportingbetDiarioAdminController],
  providers: [
    SportingbetDiarioSheetService,
    SportingbetDiarioAssignmentService,
    SportingbetDiarioSchedulerService,
  ],
  exports: [SportingbetDiarioAssignmentService, SportingbetDiarioSheetService],
})
export class SportingbetDiarioLinkPoolModule {}
