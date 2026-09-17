import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CpaPrizeEngineService } from './cpa-prize-engine.service.js';

/**
 * Runs the CPA prize engine shortly after the 2-hourly AffiliateData sync.
 * Recomputes accumulated CPA vs already-awarded prizes and generates the
 * positive delta. Idempotent and guarded by a per-version advisory lock, so
 * overlapping runs are harmless.
 */
@Injectable()
export class CpaPrizeScheduler {
  private readonly logger = new Logger(CpaPrizeScheduler.name);

  constructor(private readonly engine: CpaPrizeEngineService) {}

  @Cron('15 */2 * * *', { name: 'cpa-prize-evaluate' })
  async run(): Promise<void> {
    this.logger.log('Running CPA prize evaluation (post-sync)...');
    try {
      const results = await this.engine.evaluateAllActiveRules();
      const totalAwards = results.reduce((a, r) => a + r.awardsGenerated, 0);
      this.logger.log(
        `CPA prize evaluation done: ${results.length} rules, ${totalAwards} awards generated.`,
      );
    } catch (err) {
      this.logger.error(
        `CPA prize evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
