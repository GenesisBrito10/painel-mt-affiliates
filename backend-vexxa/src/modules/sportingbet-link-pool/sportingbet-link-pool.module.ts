import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { SportingbetAssignmentService } from './application/sportingbet-assignment.service.js';
import { SportingbetSchedulerService } from './application/sportingbet-scheduler.service.js';
import { SportingbetSheetService } from './application/sportingbet-sheet.service.js';
import { SportingbetAdminController } from './infrastructure/sportingbet-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [SportingbetAdminController],
  providers: [
    SportingbetSheetService,
    SportingbetAssignmentService,
    SportingbetSchedulerService,
  ],
  exports: [SportingbetAssignmentService, SportingbetSheetService],
})
export class SportingbetLinkPoolModule {}
