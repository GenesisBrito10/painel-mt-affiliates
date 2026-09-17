import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/index.js';
import { isSyncPaused } from '../../sync/application/sync-pause.util.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import { HIPERBET_SLUG } from '../domain/hiperbet.types.js';
import {
  HiperbetMetricsSheetService,
  type MetricsRow,
} from './hiperbet-metrics-sheet.service.js';
import {
  isMaterialChange,
  buildChangeLogData,
  type AffiliateDataValues,
} from '../../../common/persistence/affiliate-data-change.helper.js';

const LOCK_KEY = 'hiperbet:metrics-sync:lock';
const LOCK_TTL_SECONDS = 60 * 10;
const SOURCE = 'hiperbet-sheet';
const UTM_CAMPAIGN = 'sheet';

@Injectable()
export class HiperbetMetricsSyncService {
  private readonly logger = new Logger(HiperbetMetricsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheet: HiperbetMetricsSheetService,
    private readonly settings: SettingsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('*/15 * * * *', {
    timeZone: 'America/Sao_Paulo',
    name: 'hiperbet-metrics-sheet-sync',
  })
  async sync(): Promise<void> {
    if (await isSyncPaused(this.settings)) {
      this.logger.log(
        'Sync paused (sync_paused=true) — skipping hiperbet metrics sync',
      );
      return;
    }
    const house = await this.prisma.bettingHouse.findUnique({
      where: { slug: HIPERBET_SLUG },
      select: { active: true, syncMode: true },
    });
    if (house && (!house.active || house.syncMode === 'MANUAL')) {
      this.logger.log(
        `Sync skipped for hiperbet (active=${house.active}, syncMode=${house.syncMode})`,
      );
      return;
    }
    const lockToken = `metrics-sync:${process.pid}:${Date.now()}`;
    const acquired = await this.acquireLock(lockToken);
    if (!acquired) {
      this.logger.debug('Sync skipped: lock held by another instance');
      return;
    }

    try {
      let rows: MetricsRow[];
      try {
        rows = await this.sheet.readHistorico();
      } catch (err) {
        this.logger.error(`Sheet read failed: ${(err as Error).message}`);
        return;
      }

      if (rows.length === 0) {
        this.logger.log('No metric rows in sheet');
        return;
      }

      const aggregated = aggregateByCampaignAndDay(rows);
      this.logger.log(
        `Syncing ${aggregated.length} metric record(s) (raw rows=${rows.length})`,
      );

      let inserted = 0;
      let updated = 0;
      let errors = 0;
      for (const row of aggregated) {
        try {
          const key = {
            campaignId: row.campaignId,
            bettingHouse: HIPERBET_SLUG,
            campaignName: row.campaignId,
            utmCampaign: UTM_CAMPAIGN,
            date: row.date,
          };
          const prevRow = await this.prisma.affiliateData.findUnique({
            where: { uq_affiliate_data: key },
            select: {
              clicks: true,
              registrations: true,
              ftds: true,
              qftd: true,
              deposit: true,
              netPl: true,
              withdrawalTotal: true,
              volume: true,
              revShare: true,
              cpaQualified: true,
              cpaValue: true,
              totalCommission: true,
            },
          });

          const result = await this.prisma.affiliateData.upsert({
            where: { uq_affiliate_data: key },
            update: {
              affiliateId: '',
              clicks: row.clicks,
              registrations: row.registrations,
              ftds: row.ftds,
              qftd: row.ftds,
              deposit: row.deposit,
              revShare: 0,
              cpaQualified: row.cpaValue,
              cpaValue: row.cpaValue,
              totalCommission: row.cpaValue,
              source: SOURCE,
              lastSyncAt: new Date(),
            },
            create: {
              affiliateId: '',
              campaignId: row.campaignId,
              bettingHouse: HIPERBET_SLUG,
              campaignName: row.campaignId,
              utmCampaign: UTM_CAMPAIGN,
              date: row.date,
              clicks: row.clicks,
              registrations: row.registrations,
              ftds: row.ftds,
              qftd: row.ftds,
              deposit: row.deposit,
              revShare: 0,
              cpaQualified: row.cpaValue,
              cpaValue: row.cpaValue,
              totalCommission: row.cpaValue,
              source: SOURCE,
              lastSyncAt: new Date(),
            },
          });
          if (result.createdAt.getTime() === result.updatedAt.getTime()) {
            inserted++;
          } else {
            updated++;
          }

          const next: AffiliateDataValues = {
            clicks: row.clicks,
            registrations: row.registrations,
            ftds: row.ftds,
            qftd: row.ftds,
            deposit: row.deposit,
            netPl: null,
            withdrawalTotal: null,
            volume: null,
            revShare: 0,
            cpaQualified: row.cpaValue,
            cpaValue: row.cpaValue,
            totalCommission: row.cpaValue,
          };
          if (isMaterialChange(prevRow, next)) {
            try {
              await this.prisma.affiliateDataChangeLog.create({
                data: buildChangeLogData({
                  key,
                  affiliateDataId: result.id,
                  prev: prevRow,
                  next,
                  source: SOURCE,
                }),
              });
            } catch (err) {
              this.logger.warn(
                `change-log write failed for ${key.bettingHouse}/${key.campaignId}/${key.date.toISOString()}: ${(err as Error).message}`,
              );
            }
          }
        } catch (err) {
          errors++;
          this.logger.warn(
            `Upsert failed for campaignId=${row.campaignId} date=${row.date.toISOString()}: ${(err as Error).message}`,
          );
        }
      }

      try {
        await this.prisma.bettingHouse.update({
          where: { slug: HIPERBET_SLUG },
          data: { lastSyncAt: new Date() },
        });
      } catch (err) {
        this.logger.debug(
          `lastSyncAt update failed: ${(err as Error).message}`,
        );
      }

      this.logger.log(
        `Sync complete: inserted=${inserted}, updated=${updated}, errors=${errors}`,
      );
    } finally {
      await this.releaseLock(lockToken).catch((err) => {
        this.logger.warn(`Lock release failed: ${(err as Error).message}`);
      });
    }
  }

  private async acquireLock(token: string): Promise<boolean> {
    try {
      const res = await this.redis.set(
        LOCK_KEY,
        token,
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
      );
      return res === 'OK';
    } catch (err) {
      this.logger.error(
        `Redis SET NX failed (metrics lock): ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async releaseLock(token: string): Promise<void> {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, LOCK_KEY, token);
  }
}

export function aggregateByCampaignAndDay(rows: MetricsRow[]): MetricsRow[] {
  const map = new Map<string, MetricsRow>();
  for (const r of rows) {
    const key = `${r.campaignId}|${r.date.toISOString()}`;
    const existing = map.get(key);
    if (existing) {
      existing.clicks += r.clicks;
      existing.registrations += r.registrations;
      existing.ftds += r.ftds;
      existing.cpaValue += r.cpaValue;
      existing.deposit += r.deposit;
    } else {
      map.set(key, { ...r });
    }
  }
  return Array.from(map.values());
}
