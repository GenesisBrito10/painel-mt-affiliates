import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncOrchestratorService } from '../../application/sync-orchestrator.service.js';
import { isSyncPaused } from '../../application/sync-pause.util.js';
import { SettingsService } from '../../../settings/index.js';
import { SyncAlreadyRunningException } from '../../domain/exceptions/sync.exceptions.js';
import {
  PROVIDER_ACCOUNT_REPOSITORY,
  type IProviderAccountRepository,
} from '../../../provider-account/domain/repositories/provider-account.repository.js';

@Injectable()
export class SyncSchedulerService {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(
    private readonly orchestrator: SyncOrchestratorService,
    private readonly settings: SettingsService,
    @Inject(PROVIDER_ACCOUNT_REPOSITORY)
    private readonly providerAccountRepo: IProviderAccountRepository,
  ) {}

  private async pausedGuard(job: string): Promise<boolean> {
    if (await isSyncPaused(this.settings)) {
      this.logger.log(`Sync paused (sync_paused=true) — skipping ${job}`);
      return true;
    }
    return false;
  }

  /**
   * Main sync — every 2 hours at :00 (BRT).
   * Iterates all active ProviderAccountHouses sequentially.
   */
  @Cron('0 */2 * * *', { timeZone: 'America/Sao_Paulo', name: 'sync-main' })
  async handleMainSync(): Promise<void> {
    if (await this.pausedGuard('sync-main')) return;
    await this.runAllHouses('cron');
  }

  /**
   * Daily gap-fill — 04:30 BRT.
   * Ensures previous days are filled if any cron run failed.
   */
  @Cron('30 4 * * *', { timeZone: 'America/Sao_Paulo', name: 'sync-gap-fill' })
  async handleGapFill(): Promise<void> {
    if (await this.pausedGuard('sync-gap-fill')) return;
    this.logger.log('Daily gap-fill triggered');
    await this.runAllHouses('daily-gap-fill');
  }

  /**
   * High-frequency recent sync — every 20min between 00:00 and 14:59 BRT.
   * Targets only [yesterday, today], so providers like Betboard that finalize
   * data hours after a day ends never leave the dashboard with stale rows.
   * Skips silently if another sync is already running for the same house.
   */
  @Cron('*/20 0-14 * * *', {
    timeZone: 'America/Sao_Paulo',
    name: 'sync-recent',
  })
  async handleRecentSync(): Promise<void> {
    if (await this.pausedGuard('sync-recent')) return;
    await this.runRecentForAllHouses('cron-recent');
  }

  /** Recent sync: 7 days for delayed Smartico data, 2 days for other providers. */
  async runRecentForAllHouses(triggeredBy: string): Promise<void> {
    const standardDates = this.orchestrator.getRecentDates();
    const accounts = await this.providerAccountRepo.findAll();
    const active = accounts.filter((a) => a.active);

    this.logger.debug(
      `Recent sync (${triggeredBy}) — ${active.length} account(s)`,
    );

    for (const account of active) {
      const dates =
        account.provider === 'smartico'
          ? this.orchestrator.getRecentDates(7)
          : standardDates;
      for (const house of account.houses) {
        if (!house.active) continue;
        if (!house.bettingHouse.active) continue;
        if (house.bettingHouse.syncMode === 'MANUAL') continue;
        try {
          await this.orchestrator.runSync({
            account,
            houseSlug: house.bettingHouseSlug,
            bookmarkerId: house.bookmarkerId,
            triggeredBy,
            dates,
          });
        } catch (err: unknown) {
          if (err instanceof SyncAlreadyRunningException) {
            this.logger.debug(
              `[${house.bettingHouseSlug}] recent sync skipped — already running`,
            );
            continue;
          }
          this.logger.error(
            `[${house.bettingHouseSlug}] recent sync error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  /** Shared logic: iterate all active accounts → all active houses */
  async runAllHouses(triggeredBy: string): Promise<void> {
    const accounts = await this.providerAccountRepo.findAll();
    const active = accounts.filter((a) => a.active);

    this.logger.log(
      `Sync triggered (${triggeredBy}) — ${active.length} active account(s)`,
    );

    for (const account of active) {
      for (const house of account.houses) {
        if (!house.active) {
          this.logger.debug(
            `[${house.bettingHouseSlug}] Provider association inactive, skipping`,
          );
          continue;
        }
        if (!house.bettingHouse.active) {
          this.logger.debug(
            `[${house.bettingHouseSlug}] House inactive, skipping`,
          );
          continue;
        }
        if (house.bettingHouse.syncMode === 'MANUAL') {
          this.logger.debug(
            `[${house.bettingHouseSlug}] syncMode=MANUAL, skipping auto-sync`,
          );
          continue;
        }
        try {
          await this.orchestrator.runSync({
            account,
            houseSlug: house.bettingHouseSlug,
            bookmarkerId: house.bookmarkerId,
            triggeredBy,
          });
        } catch (err: unknown) {
          this.logger.error(
            `[${house.bettingHouseSlug}] Sync error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  /** Admin trigger for a single house */
  /**
   * `dates` explícitas fazem o orchestrator honrar o intervalo mesmo em
   * provedores `current-day-only` — é o caminho do backfill manual.
   */
  async runHouse(
    houseSlug: string,
    triggeredBy: string,
    dates?: string[],
  ): Promise<void> {
    const accounts = await this.providerAccountRepo.findByHouseSlug(houseSlug);
    for (const account of accounts) {
      const house = account.houses.find(
        (h) => h.bettingHouseSlug === houseSlug,
      );
      if (!house?.active) continue;
      await this.orchestrator.runSync({
        account,
        houseSlug,
        bookmarkerId: house.bookmarkerId,
        triggeredBy,
        ...(dates ? { dates } : {}),
      });
    }
  }
}
