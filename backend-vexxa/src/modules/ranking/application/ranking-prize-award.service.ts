import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RankingAdminService } from './ranking-admin.service.js';

/**
 * Cron horário que premia incrementalmente os prêmios "Meta de CPA" (TARGET):
 * quem atinge a meta vira vencedor na hora (resgatável), sem esperar a data fim
 * nem o finalize manual. Delega a {@link RankingAdminService.awardAllActiveTargetPrizes}.
 */
@Injectable()
export class RankingPrizeAwardService {
  private readonly logger = new Logger(RankingPrizeAwardService.name);
  private running = false;

  constructor(private readonly admin: RankingAdminService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'ranking-target-prize-award' })
  async run(): Promise<void> {
    if (this.running) {
      this.logger.warn('Premiação TARGET já em andamento — pulando tick.');
      return;
    }
    this.running = true;
    try {
      await this.admin.awardAllActiveTargetPrizes();
    } catch (err) {
      this.logger.error(
        `Target prize award cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
