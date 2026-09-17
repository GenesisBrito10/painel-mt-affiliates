import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { EsportivaAssignmentService } from './application/esportiva-assignment.service.js';
import { EsportivaSchedulerService } from './application/esportiva-scheduler.service.js';
import { EsportivaSheetService } from './application/esportiva-sheet.service.js';
import { EsportivaAdminController } from './infrastructure/esportiva-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [EsportivaAdminController],
  providers: [
    EsportivaSheetService,
    EsportivaAssignmentService,
    EsportivaSchedulerService,
  ],
  exports: [EsportivaAssignmentService, EsportivaSheetService],
})
export class EsportivaLinkPoolModule {}
