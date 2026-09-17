import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type {
  ISyncRepository,
  UpsertAffiliateDataInput,
  CreateSyncLogInput,
  SyncLogStats,
} from '../../domain/ports/sync.repository.port.js';
import {
  isMaterialChange,
  buildChangeLogData,
  type AffiliateDataValues,
} from '../../../../common/persistence/affiliate-data-change.helper.js';

const sourceFor = (row: UpsertAffiliateDataInput): string =>
  row.netPl === null ? 'betboard-api' : 'smartico-api';

export function extractBetboardCampaignIds(
  linkRequestPayloads: unknown[],
): Set<string> {
  const campaignIds = new Set<string>();
  for (const payload of linkRequestPayloads) {
    if (!Array.isArray(payload)) continue;
    for (const item of payload) {
      if (!item || typeof item !== 'object') continue;
      const urlValue = (item as { url?: unknown }).url;
      if (typeof urlValue !== 'string') continue;
      try {
        const url = new URL(urlValue);
        const siteId = url.searchParams.get('siteid')?.trim();
        const trackingCode = url.searchParams.get('c')?.trim();
        if (siteId && trackingCode) {
          campaignIds.add(`${siteId}-${trackingCode}`);
        }
      } catch {
        // Invalid historical link payloads are ignored.
      }
    }
  }
  return campaignIds;
}

@Injectable()
export class SyncPrismaRepository implements ISyncRepository {
  private readonly logger = new Logger(SyncPrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsertBatch(
    rows: UpsertAffiliateDataInput[],
    syncLogId: string | null = null,
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      // Snapshot prior state so we can emit a change-log when material fields move.
      // Single extra SELECT per row is acceptable — sync batches are O(hundreds).
      const prevRow = await this.prisma.affiliateData.findUnique({
        where: {
          uq_affiliate_data: {
            campaignId: row.campaignId,
            bettingHouse: row.bettingHouse,
            date: row.date,
            campaignName: row.campaignName,
            utmCampaign: row.utmCampaign,
          },
        },
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
        where: {
          uq_affiliate_data: {
            campaignId: row.campaignId,
            bettingHouse: row.bettingHouse,
            date: row.date,
            campaignName: row.campaignName,
            utmCampaign: row.utmCampaign,
          },
        },
        update: {
          affiliateId: row.affiliateId,
          clicks: row.clicks,
          registrations: row.registrations,
          ftds: row.ftds,
          qftd: row.qftd,
          deposit: row.deposit,
          netPl: row.netPl,
          withdrawalTotal: row.withdrawalTotal,
          volume: row.volume,
          revShare: row.revShare,
          cpaQualified: row.cpaQualified,
          cpaValue: row.cpaValue,
          totalCommission: row.totalCommission,
          source: sourceFor(row),
          lastSyncAt: new Date(),
        },
        create: {
          affiliateId: row.affiliateId,
          campaignId: row.campaignId,
          bettingHouse: row.bettingHouse,
          campaignName: row.campaignName,
          utmCampaign: row.utmCampaign,
          date: row.date,
          clicks: row.clicks,
          registrations: row.registrations,
          ftds: row.ftds,
          qftd: row.qftd,
          deposit: row.deposit,
          netPl: row.netPl,
          withdrawalTotal: row.withdrawalTotal,
          volume: row.volume,
          revShare: row.revShare,
          cpaQualified: row.cpaQualified,
          cpaValue: row.cpaValue,
          totalCommission: row.totalCommission,
          source: sourceFor(row),
          lastSyncAt: new Date(),
        },
      });

      // Prisma upsert doesn't expose inserted/updated; we approximate via DB query
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        inserted++;
      } else {
        updated++;
      }

      const next: AffiliateDataValues = {
        clicks: row.clicks,
        registrations: row.registrations,
        ftds: row.ftds,
        qftd: row.qftd,
        deposit: row.deposit,
        netPl: row.netPl,
        withdrawalTotal: row.withdrawalTotal,
        volume: row.volume,
        revShare: row.revShare,
        cpaQualified: row.cpaQualified,
        cpaValue: row.cpaValue,
        totalCommission: row.totalCommission,
      };
      if (isMaterialChange(prevRow, next)) {
        try {
          await this.prisma.affiliateDataChangeLog.create({
            data: buildChangeLogData({
              key: row,
              affiliateDataId: result.id,
              prev: prevRow,
              next,
              source: sourceFor(row),
              syncLogId,
            }),
          });
        } catch (err) {
          // History write must never break the sync. Log and continue.
          this.logger.warn(
            `change-log write failed for ${row.bettingHouse}/${row.campaignId}/${row.date.toISOString()}: ${(err as Error).message}`,
          );
        }
      }
    }

    return { inserted, updated };
  }

  async createSyncLog(data: CreateSyncLogInput): Promise<string> {
    const log = await this.prisma.syncLog.create({
      data: {
        bettingHouse: data.bettingHouse,
        startTime: new Date(),
        status: 'RUNNING',
        triggeredBy: data.triggeredBy,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        totalRecords: 0,
        inserted: 0,
        updated: 0,
        errors: 0,
      },
    });
    return log.id;
  }

  async completeSyncLog(
    id: string,
    endTime: Date,
    stats: SyncLogStats,
  ): Promise<void> {
    await this.prisma.syncLog.update({
      where: { id },
      data: {
        status: 'SUCCESS',
        endTime,
        totalRecords: stats.totalRecords,
        inserted: stats.inserted,
        updated: stats.updated,
        errors: stats.errors,
      },
    });
  }

  async failSyncLog(
    id: string,
    endTime: Date,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.syncLog.update({
      where: { id },
      data: { status: 'ERROR', endTime, errorMessage },
    });
  }

  async findMissingDays(bettingHouse: string, since: Date): Promise<string[]> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);

    if (since > yesterday) return [];

    // All days in range [since, yesterday]
    const allDays: string[] = [];
    const current = new Date(since);
    current.setHours(0, 0, 0, 0);
    while (current <= yesterday) {
      allDays.push(current.toISOString().split('T')[0]!);
      current.setDate(current.getDate() + 1);
    }

    // Days that already have data
    const existing = await this.prisma.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT TO_CHAR(date::date, 'YYYY-MM-DD') AS day
      FROM affiliate_data
      WHERE "bettingHouse" = ${bettingHouse}
        AND date >= ${since}
        AND date <= ${yesterday}
    `;

    const existingSet = new Set(existing.map((r) => r.day));
    return allDays.filter((d) => !existingSet.has(d));
  }

  async findOperationalMetricsBackfillStart(
    bettingHouse: string,
    since?: string,
  ): Promise<string | null> {
    const result = await this.prisma.affiliateData.aggregate({
      where: {
        bettingHouse,
        ...(since ? { date: { gte: new Date(`${since}T00:00:00.000Z`) } } : {}),
        OR: [{ netPl: null }, { withdrawalTotal: null }, { volume: null }],
      },
      _min: { date: true },
    });
    return result._min.date?.toISOString().slice(0, 10) ?? null;
  }

  async updateHouseLastSync(slug: string): Promise<void> {
    await this.prisma.bettingHouse.update({
      where: { slug },
      data: { lastSyncAt: new Date() },
    });
  }

  async getHouseCutoverDate(slug: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: `ledger_cutover_date_${slug}` },
      select: { value: true },
    });
    const v = row?.value?.trim();
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }

  async enrichAffiliateLinks(
    providerAccountId: string,
    bettingHouse: string,
    campaignIds: string[],
  ): Promise<number> {
    if (campaignIds.length === 0) return 0;
    const result = await this.prisma.affiliateLink.updateMany({
      where: {
        bettingHouse,
        campaignId: { in: campaignIds },
        OR: [
          { providerAccountId: null },
          { providerAccountId: { not: providerAccountId } },
        ],
      },
      data: { providerAccountId },
    });
    return result.count;
  }

  async getLinkRates(
    bettingHouse: string,
  ): Promise<Map<string, { cpa: number; revshare: number }>> {
    const links = await this.prisma.affiliateLink.findMany({
      where: { bettingHouse, deletedAt: null, campaignId: { not: '' } },
      select: { campaignId: true, cpa: true, revshare: true },
    });
    const map = new Map<string, { cpa: number; revshare: number }>();
    for (const l of links) {
      map.set(l.campaignId, {
        cpa: l.cpa?.toNumber() ?? 0,
        revshare: l.revshare?.toNumber() ?? 0,
      });
    }
    return map;
  }

  async getActiveDealCampaignIds(
    bettingHouse: string,
  ): Promise<Set<string> | null> {
    const activeDealCount = await this.prisma.deal.count({
      where: { bettingHouseSlug: bettingHouse, active: true },
    });
    if (activeDealCount === 0) return null;

    const requests = await this.prisma.linkRequest.findMany({
      where: {
        bettingHouseSlug: bettingHouse,
        status: 'FULFILLED',
        deal: { is: { active: true } },
      },
      select: { links: true },
    });
    return extractBetboardCampaignIds(requests.map((row) => row.links));
  }

  async purgeStaleUtm(
    bettingHouse: string,
    keepUtm: string,
    campaignIds: string[],
  ): Promise<number> {
    if (campaignIds.length === 0) return 0;
    const result = await this.prisma.affiliateData.deleteMany({
      where: {
        bettingHouse,
        campaignId: { in: campaignIds },
        utmCampaign: { not: keepUtm },
      },
    });
    return result.count;
  }

  async getSyncHealth(): Promise<{
    byHouse: Array<{
      house: string;
      active: boolean;
      lastSyncAt: Date | null;
      lagHours: number | null;
      recentDays: Array<{ date: string; rows: number }>;
      missingRecentDays: string[];
      ok: boolean;
    }>;
  }> {
    const now = Date.now();
    const houses = await this.prisma.bettingHouse.findMany({
      select: { slug: true, active: true, lastSyncAt: true },
      orderBy: { slug: 'asc' },
    });

    const dayStrings: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      dayStrings.push(d.toISOString().split('T')[0]!);
    }

    const counts = await this.prisma.$queryRaw<
      { house: string; day: string; rows: bigint }[]
    >`
      SELECT "bettingHouse" AS house,
             TO_CHAR(date::date, 'YYYY-MM-DD') AS day,
             COUNT(*)::bigint AS rows
      FROM affiliate_data
      WHERE date::date IN (${dayStrings[0]}::date, ${dayStrings[1]}::date, ${dayStrings[2]}::date)
      GROUP BY "bettingHouse", day
    `;

    const lookup = new Map<string, Map<string, number>>();
    for (const row of counts) {
      const inner = lookup.get(row.house) ?? new Map<string, number>();
      inner.set(row.day, Number(row.rows));
      lookup.set(row.house, inner);
    }

    const byHouse = houses.map((h) => {
      const dayMap = lookup.get(h.slug) ?? new Map<string, number>();
      const recentDays = dayStrings.map((d) => ({
        date: d,
        rows: dayMap.get(d) ?? 0,
      }));
      const today = dayStrings[0]!;
      const missingRecentDays = recentDays
        .filter((rd) => rd.date !== today && rd.rows === 0)
        .map((rd) => rd.date);
      const lagHours =
        h.lastSyncAt !== null
          ? Math.round(((now - h.lastSyncAt.getTime()) / 3_600_000) * 10) / 10
          : null;
      const ok =
        h.active === false
          ? true
          : missingRecentDays.length === 0 && lagHours !== null && lagHours < 4;
      return {
        house: h.slug,
        active: h.active,
        lastSyncAt: h.lastSyncAt,
        lagHours,
        recentDays,
        missingRecentDays,
        ok,
      };
    });

    return { byHouse };
  }
}
