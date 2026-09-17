import { Module } from '@nestjs/common';
import { MailModule } from '../mail/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SuperbetLinkPoolModule } from '../superbet-link-pool/index.js';
import { SuperbetInactivityService } from './superbet-inactivity.service.js';

@Module({
  imports: [PrismaModule, MailModule, SuperbetLinkPoolModule],
  providers: [SuperbetInactivityService],
  exports: [SuperbetInactivityService],
})
export class SuperbetInactivityModule {}
