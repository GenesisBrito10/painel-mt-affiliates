import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationModule } from '../notification/index.js';
import { WhatsappModule } from '../whatsapp/index.js';
import { LinkPoolAlertService } from './application/link-pool-alert.service.js';

/**
 * Serviço compartilhado de alerta de "planilha de links cheia". Importado por
 * cada módulo de pool de casa para que os schedulers possam disparar o aviso.
 * Depende do WhatsappModule (Evolution + settings) e do NotificationModule
 * (push pros admins). REDIS_CLIENT é global (SharedModule).
 */
@Module({
  imports: [PrismaModule, NotificationModule, WhatsappModule],
  providers: [LinkPoolAlertService],
  exports: [LinkPoolAlertService],
})
export class LinkPoolAlertModule {}
