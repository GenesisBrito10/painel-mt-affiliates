import { Module } from '@nestjs/common';
import { UserService } from './application/user.service.js';
import { AffiliateExportService } from './application/affiliate-export.service.js';
import { UserController } from './infrastructure/user.controller.js';
import { UserPrismaRepository } from './infrastructure/persistence/user.prisma-repository.js';
import { USER_REPOSITORY } from './domain/repositories/user.repository.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationModule } from '../notification/notification.module.js';
import { DashboardModule } from '../dashboard/index.js';
import { NetworkModule } from '../network/index.js';

@Module({
  imports: [PrismaModule, NotificationModule, DashboardModule, NetworkModule],
  controllers: [UserController],
  providers: [
    UserService,
    AffiliateExportService,
    { provide: USER_REPOSITORY, useClass: UserPrismaRepository },
  ],
  exports: [UserService],
})
export class UserModule {}
