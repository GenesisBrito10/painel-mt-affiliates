import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LinkSource, SyncLogStatus, SyncMode } from '@prisma/client';
import type Redis from 'ioredis';
import {
  buildChangeLogData,
  isMaterialChange,
  type AffiliateDataValues,
} from '../../../common/persistence/affiliate-data-change.helper.js';
import { LinkWebhookService } from '../../link-webhook/index.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import { SettingsService } from '../../settings/index.js';
import { isSyncPaused } from '../../sync/application/sync-pause.util.js';
import { BETANO_DIARIO_SLUG } from '../domain/betano-diario.types.js';
import { BetanoDiarioMetricsSheetService } from './betano-diario-metrics-sheet.service.js';

const LOCK_KEY = 'betano-diario:metrics-sync:lock';
const LOCK_TTL_SECONDS = 10 * 60;
const SOURCE = 'betano-diario-sheet';
const UTM_CAMPAIGN = 'sheet';

@Injectable()
export class BetanoDiarioMetricsSyncService {
  private readonly logger = new Logger(BetanoDiarioMetricsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheet: BetanoDiarioMetricsSheetService,
    private readonly settings: SettingsService,
    private readonly webhook: LinkWebhookService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('*/15 * * * *', {
    timeZone: 'America/Sao_Paulo',
    name: 'betano-diario-metrics-sheet-sync',
  })
  async sync(triggeredBy = 'cron'): Promise<void> {
    if (await isSyncPaused(this.settings)) {
      this.logger.log('Sync paused — skipping Betano Diario sheet metrics');
      return;
    }
    const house = await this.prisma.bettingHouse.findUnique({
      where: { slug: BETANO_DIARIO_SLUG },
      select: { active: true, syncMode: true },
    });
    if (!house || !house.active || house.syncMode === SyncMode.MANUAL) {
      this.logger.log('Betano Diario metrics sync is inactive or manual');
      return;
    }

    const lockToken = `metrics:${process.pid}:${Date.now()}`;
    const acquired = await this.redis.set(
      LOCK_KEY,
      lockToken,
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      this.logger.debug('Betano Diario metrics sync lock is busy');
      return;
    }

    let syncLogId: string | null = null;
    try {
      const extracted = await this.sheet.readMetrics();
      const dates = extracted.tabs
        .map((tab) => {
          const [day, month, year] = tab.split('/');
          return `${year}-${month}-${day}`;
        })
        .sort();
      if (dates.length === 0) return;

      const syncLog = await this.prisma.syncLog.create({
        data: {
          bettingHouse: BETANO_DIARIO_SLUG,
          startTime: new Date(),
          triggeredBy,
          periodStart: new Date(`${dates[0]}T00:00:00.000Z`),
          periodEnd: new Date(`${dates[dates.length - 1]}T00:00:00.000Z`),
        },
        select: { id: true },
      });
      syncLogId = syncLog.id;

      const campaignIds = [
        ...new Set(extracted.rows.map((row) => row.campaignId)),
      ];
      const links = await this.prisma.affiliateLink.findMany({
        where: {
          bettingHouse: BETANO_DIARIO_SLUG,
          campaignId: { in: campaignIds },
          deletedAt: null,
          source: { in: [LinkSource.POOL, LinkSource.MANUAL] },
          cpa: { not: null },
        },
        select: { campaignId: true, cpa: true },
      });
      const rateByCampaign = new Map(
        links.map((link) => [link.campaignId, link.cpa!.toNumber()]),
      );

      let inserted = 0;
      let updated = 0;
      let errors = extracted.issues.length;
      let totalRecords = 0;
      const writtenDates = new Set<string>();

      for (const issue of extracted.issues) {
        this.logger.warn(
          `Skipped ${issue.tab}:${issue.rowIndex}; ${issue.message}`,
        );
      }

      for (const row of extracted.rows) {
        const cpaRate = rateByCampaign.get(row.campaignId);
        if (cpaRate === undefined) {
          errors++;
          this.logger.warn(
            `Skipped ${row.tab}:${row.rowIndex}; no active Betano Diario link for ${row.campaignId}`,
          );
          continue;
        }
        const cpaValue = row.cpaQualified * cpaRate;
        const key = {
          campaignId: row.campaignId,
          bettingHouse: BETANO_DIARIO_SLUG,
          date: row.date,
          campaignName: row.campaignId,
          utmCampaign: UTM_CAMPAIGN,
        };
        const next: AffiliateDataValues = {
          clicks: row.clicks,
          registrations: row.registrations,
          ftds: row.ftds,
          qftd: row.cpaQualified,
          deposit: row.deposit,
          netPl: null,
          withdrawalTotal: null,
          volume: null,
          revShare: 0,
          cpaQualified: row.cpaQualified,
          cpaValue,
          totalCommission: cpaValue,
        };
        try {
          const previous = await this.prisma.affiliateData.findUnique({
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
          const data = {
            affiliateId: row.affiliateId,
            ...key,
            ...next,
            source: SOURCE,
            lastSyncAt: new Date(),
          };
          const saved = await this.prisma.affiliateData.upsert({
            where: { uq_affiliate_data: key },
            update: data,
            create: data,
          });
          const materialChange = isMaterialChange(previous, next);
          if (!previous) inserted++;
          else if (materialChange) updated++;
          totalRecords++;
          if (!previous || materialChange) {
            writtenDates.add(row.date.toISOString().slice(0, 10));
          }

          if (materialChange) {
            await this.prisma.affiliateDataChangeLog.create({
              data: buildChangeLogData({
                key,
                affiliateDataId: saved.id,
                prev: previous,
                next,
                source: SOURCE,
                syncLogId,
              }),
            });
          }
        } catch (error) {
          errors++;
          this.logger.warn(
            `Failed ${row.tab}:${row.rowIndex}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      await this.prisma.syncLog.update({
        where: { id: syncLogId },
        data: {
          endTime: new Date(),
          status: SyncLogStatus.SUCCESS,
          totalRecords,
          inserted,
          updated,
          errors,
        },
      });
      await this.prisma.bettingHouse.update({
        where: { slug: BETANO_DIARIO_SLUG },
        data: { lastSyncAt: new Date() },
      });
      const changedRecords = inserted + updated;
      if (changedRecords > 0) {
        await this.webhook.emitAffiliateDataSynced({
          houseSlug: BETANO_DIARIO_SLUG,
          dates: [...writtenDates].sort(),
          rowsUpserted: changedRecords,
          totals: { inserted, updated, records: totalRecords, errors },
          triggeredBy,
        });
      }
    } catch (error) {
      if (syncLogId) {
        await this.prisma.syncLog.update({
          where: { id: syncLogId },
          data: {
            endTime: new Date(),
            status: SyncLogStatus.ERROR,
            errors: 1,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
        });
      }
      throw error;
    } finally {
      const releaseScript = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end
        return 0
      `;
      await this.redis.eval(releaseScript, 1, LOCK_KEY, lockToken);
    }
  }
}
