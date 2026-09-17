import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { EsportivaDiarioAssignmentService } from './application/esportiva-diario-assignment.service.js';
import { EsportivaDiarioSchedulerService } from './application/esportiva-diario-scheduler.service.js';
import { EsportivaDiarioSheetService } from './application/esportiva-diario-sheet.service.js';
import { EsportivaDiarioAdminController } from './infrastructure/esportiva-diario-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [EsportivaDiarioAdminController],
  providers: [
    EsportivaDiarioSheetService,
    EsportivaDiarioAssignmentService,
    EsportivaDiarioSchedulerService,
  ],
  exports: [EsportivaDiarioAssignmentService],
})
export class EsportivaDiarioLinkPoolModule {}
