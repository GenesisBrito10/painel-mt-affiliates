import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NOTIFICATION_QUEUE } from './domain/types/notification.types.js';
import { NOTIFICATION_REPOSITORY } from './domain/ports/notification.repository.js';
import { NotificationService } from './application/notification.service.js';
import { NotificationController } from './infrastructure/notification.controller.js';
import { NotificationPrismaRepository } from './infrastructure/persistence/notification.prisma-repository.js';
import { NotificationProducer } from './infrastructure/queues/notification.producer.js';
import { NotificationProcessor } from './infrastructure/queues/notification.processor.js';
import { WebPushService } from './infrastructure/push/web-push.service.js';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationProducer,
    NotificationProcessor,
    WebPushService,
    { provide: NOTIFICATION_REPOSITORY, useClass: NotificationPrismaRepository },
  ],
  exports: [NotificationService],
})
export class NotificationModule implements OnModuleInit {
  constructor(private readonly producer: NotificationProducer) {}

  async onModuleInit(): Promise<void> {
    await this.producer.scheduleRepeatingJobs();
  }
}
