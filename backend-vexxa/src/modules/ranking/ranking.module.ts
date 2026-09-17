import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { NotificationModule } from '../notification/index.js';
import { RankingController } from './infrastructure/ranking.controller.js';
import { RankingAdminController } from './infrastructure/ranking-admin.controller.js';
import { RankingService } from './application/ranking.service.js';
import { RankingAdminService } from './application/ranking-admin.service.js';
import { RankingPrizeAwardService } from './application/ranking-prize-award.service.js';
import { RANKING_REPOSITORY } from './domain/ports/ranking.repository.js';
import { RankingPrismaRepository } from './infrastructure/persistence/ranking.prisma-repository.js';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [RankingController, RankingAdminController],
  providers: [
    RankingService,
    RankingAdminService,
    RankingPrizeAwardService,
    {
      provide: RANKING_REPOSITORY,
      useClass: RankingPrismaRepository,
    },
  ],
  exports: [RankingService],
})
export class RankingModule {}
