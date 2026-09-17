import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { SuperbetAssignmentService } from './application/superbet-assignment.service.js';
import { SuperbetSchedulerService } from './application/superbet-scheduler.service.js';
import { SuperbetSheetService } from './application/superbet-sheet.service.js';
import { SuperbetAdminController } from './infrastructure/superbet-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [SuperbetAdminController],
  providers: [
    SuperbetSheetService,
    SuperbetAssignmentService,
    SuperbetSchedulerService,
  ],
  exports: [SuperbetAssignmentService, SuperbetSheetService],
})
export class SuperbetLinkPoolModule {}
