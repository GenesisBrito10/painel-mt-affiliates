import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module.js';
import { FileUploadModule } from '../file-upload/file-upload.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SupportChatAttachmentsCleanupService } from './application/support-chat-attachments-cleanup.service.js';
import { SupportChatBusinessHoursService } from './application/support-chat-business-hours.service.js';
import { SupportChatEvents } from './application/support-chat-events.service.js';
import { SupportChatTimeoutService } from './application/support-chat-timeout.service.js';
import { SupportChatService } from './application/support-chat.service.js';
import {
  AdminSupportChatController,
  SupportAgentChatController,
  SupportChatController,
  SupportChatStatusController,
} from './infrastructure/http/support-chat.controller.js';
import { SupportChatGateway } from './infrastructure/websocket/support-chat.gateway.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    FileUploadModule,
    ThrottlerModule.forRoot([
      { name: 'support-attachments', ttl: 60_000, limit: 10 },
    ]),
  ],
  controllers: [
    SupportChatStatusController,
    SupportChatController,
    SupportAgentChatController,
    AdminSupportChatController,
  ],
  providers: [
    SupportChatEvents,
    SupportChatService,
    SupportChatGateway,
    SupportChatAttachmentsCleanupService,
    SupportChatBusinessHoursService,
    SupportChatTimeoutService,
  ],
  exports: [SupportChatService],
})
export class SupportChatModule {}
