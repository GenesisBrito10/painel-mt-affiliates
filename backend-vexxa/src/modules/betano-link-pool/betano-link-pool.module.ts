import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { BetanoAssignmentService } from './application/betano-assignment.service.js';
import { BetanoSchedulerService } from './application/betano-scheduler.service.js';
import { BetanoSheetService } from './application/betano-sheet.service.js';
import { BetanoAdminController } from './infrastructure/betano-admin.controller.js';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [BetanoAdminController],
  providers: [
    BetanoSheetService,
    BetanoAssignmentService,
    BetanoSchedulerService,
  ],
  exports: [BetanoAssignmentService],
})
export class BetanoLinkPoolModule {}
