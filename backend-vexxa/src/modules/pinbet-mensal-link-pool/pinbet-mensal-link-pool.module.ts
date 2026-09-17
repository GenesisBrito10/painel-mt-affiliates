import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LinkPoolAlertModule } from '../link-pool-alert/index.js';
import { LinkWebhookModule } from '../link-webhook/link-webhook.module.js';
import { PinbetMensalAssignmentService } from './application/pinbet-mensal-assignment.service.js';
import { PinbetMensalSchedulerService } from './application/pinbet-mensal-scheduler.service.js';
import { PinbetMensalSheetService } from './application/pinbet-mensal-sheet.service.js';
import { PinbetMensalAdminController } from './infrastructure/pinbet-mensal-admin.controller.js';

// INATIVO até existir planilha do Mensal (PINBET_MENSAL_SHEET_ID) e a casa ser
// ativada no banco. O código está pronto; nada é atribuído enquanto inativo.
@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    LinkPoolAlertModule,
    LinkWebhookModule,
  ],
  controllers: [PinbetMensalAdminController],
  providers: [
    PinbetMensalSheetService,
    PinbetMensalAssignmentService,
    PinbetMensalSchedulerService,
  ],
  exports: [PinbetMensalAssignmentService],
})
export class PinbetMensalLinkPoolModule {}
