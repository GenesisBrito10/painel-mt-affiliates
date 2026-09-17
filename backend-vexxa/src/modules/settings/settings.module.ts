import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SETTINGS_REPOSITORY } from './domain/ports/settings.repository.js';
import { SettingsService } from './application/settings.service.js';
import { SettingsController } from './infrastructure/settings.controller.js';
import { AdminOpsController } from './infrastructure/admin-ops.controller.js';
import {
  ThemeController,
  AdminThemeController,
} from './infrastructure/theme.controller.js';
import {
  MaintenanceController,
  AdminMaintenanceController,
} from './infrastructure/maintenance.controller.js';
import { SettingsPrismaRepository } from './infrastructure/persistence/settings.prisma-repository.js';
import { LinkWebhookModule } from '../link-webhook/index.js';

@Module({
  imports: [PrismaModule, LinkWebhookModule],
  controllers: [
    SettingsController,
    AdminOpsController,
    ThemeController,
    AdminThemeController,
    MaintenanceController,
    AdminMaintenanceController,
  ],
  providers: [
    SettingsService,
    { provide: SETTINGS_REPOSITORY, useClass: SettingsPrismaRepository },
  ],
  exports: [SettingsService],
})
export class SettingsModule {}
