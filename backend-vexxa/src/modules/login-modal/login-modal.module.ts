import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FileUploadModule } from '../file-upload/file-upload.module.js';
import { LoginModalService } from './application/login-modal.service.js';
import {
  AdminLoginModalController,
  LoginModalController,
} from './infrastructure/login-modal.controller.js';

@Module({
  imports: [PrismaModule, FileUploadModule],
  controllers: [LoginModalController, AdminLoginModalController],
  providers: [LoginModalService],
  exports: [LoginModalService],
})
export class LoginModalModule {}
