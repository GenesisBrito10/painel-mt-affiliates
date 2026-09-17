import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LinkRequestModule } from '../link-request/index.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WithdrawalModule } from '../withdrawal/index.js';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { ApiAccessGuard } from '../auth/index.js';
import { AffiliateApiService } from './application/affiliate-api.service.js';
import { AffiliateApiSandboxService } from './application/affiliate-api-sandbox.service.js';
import { AffiliateApiTokenGuard } from './application/affiliate-api-token.guard.js';
import {
  AffiliateApiController,
  AffiliateApiPublicController,
} from './infrastructure/affiliate-api.controller.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    LinkRequestModule,
    WithdrawalModule,
    DashboardModule,
  ],
  controllers: [AffiliateApiController, AffiliateApiPublicController],
  providers: [
    AffiliateApiService,
    AffiliateApiSandboxService,
    AffiliateApiTokenGuard,
    ApiAccessGuard,
  ],
})
export class AffiliateApiModule {}
