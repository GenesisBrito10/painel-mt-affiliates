import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DashboardController } from './infrastructure/dashboard.controller.js';
import { DashboardService } from './application/dashboard.service.js';
import { DashboardBalanceService } from './application/dashboard-balance.service.js';
import { DashboardAccessService } from './application/dashboard-access.service.js';
import { DashboardPrismaRepository, DASHBOARD_REPOSITORY } from './infrastructure/persistence/dashboard.prisma-repository.js';

import { EarningsController } from './infrastructure/earnings.controller.js';
import { EarningsOverviewService } from './application/earnings-overview.service.js';
import { EarningsNetworkService } from './application/earnings-network.service.js';
import { EarningsLedgerService } from './application/earnings-ledger.service.js';
import { EarningsPrismaRepository } from './infrastructure/persistence/earnings.prisma-repository.js';
import { EARNINGS_REPOSITORY } from './domain/ports/earnings.repository.js';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [DashboardController, EarningsController],
  providers: [
    DashboardService,
    DashboardBalanceService,
    DashboardAccessService,
    EarningsOverviewService,
    EarningsNetworkService,
    EarningsLedgerService,
    {
      provide: DASHBOARD_REPOSITORY,
      useClass: DashboardPrismaRepository,
    },
    {
      provide: EARNINGS_REPOSITORY,
      useClass: EarningsPrismaRepository,
    },
  ],
  exports: [DashboardService, DashboardBalanceService, DashboardAccessService, EarningsOverviewService],
})
export class DashboardModule {}
