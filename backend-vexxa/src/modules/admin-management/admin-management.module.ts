import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminManagementService } from './application/admin-management.service.js';
import { AdminManagementController } from './infrastructure/admin-management.controller.js';

@Module({
  imports: [PrismaModule],
  controllers: [AdminManagementController],
  providers: [AdminManagementService],
  exports: [AdminManagementService],
})
export class AdminManagementModule {}
