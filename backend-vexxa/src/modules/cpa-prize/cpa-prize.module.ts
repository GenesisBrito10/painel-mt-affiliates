import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationModule } from '../notification/index.js';
import { CpaPrizeController } from './infrastructure/cpa-prize.controller.js';
import { CpaPrizeAdminController } from './infrastructure/cpa-prize-admin.controller.js';
import { CpaPrizeService } from './application/cpa-prize.service.js';
import { CpaPrizeAdminService } from './application/cpa-prize-admin.service.js';
import { CpaPrizeEngineService } from './application/cpa-prize-engine.service.js';
import { CpaPrizeScheduler } from './application/cpa-prize.scheduler.js';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [CpaPrizeController, CpaPrizeAdminController],
  providers: [
    CpaPrizeService,
    CpaPrizeAdminService,
    CpaPrizeEngineService,
    CpaPrizeScheduler,
  ],
  exports: [CpaPrizeEngineService],
})
export class CpaPrizeModule {}
