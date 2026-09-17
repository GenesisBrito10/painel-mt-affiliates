import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { PinbetDiarioAssignmentService } from './application/pinbet-diario-assignment.service.js';
import { PinbetDiarioSchedulerService } from './application/pinbet-diario-scheduler.service.js';
import { PinbetDiarioSheetService } from './application/pinbet-diario-sheet.service.js';
import { PinbetDiarioAdminController } from './infrastructure/pinbet-diario-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [PinbetDiarioAdminController],
  providers: [
    PinbetDiarioSheetService,
    PinbetDiarioAssignmentService,
    PinbetDiarioSchedulerService,
  ],
  exports: [PinbetDiarioAssignmentService],
})
export class PinbetDiarioLinkPoolModule {}
