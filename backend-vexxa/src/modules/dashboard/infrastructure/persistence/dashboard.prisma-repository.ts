import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  DASHBOARD_REPOSITORY,
  type IDashboardRepository,
  type CampaignHouseMetrics,
  type PinbetOperationalMetrics,
} from '../../domain/ports/dashboard.repository.js';
import type {
  AggregatedMetrics,
  DailyMetrics,
  CampaignMetrics,
  DashboardFilters,
  AuditExclusion,
  SyncDay,
  SyncDayStatus,
} from '../../domain/types/dashboard.types.js';
import { Prisma } from '@prisma/client';

// Helper — convert Prisma.Decimal | null to number safely
function toNum(val: Prisma.Decimal | null | undefined): number {
  if (!val) return 0;
  return val.toNumber();
}

// Helper — build WHERE clause for affiliate_data queries
function buildWhere(filters: DashboardFilters): Prisma.AffiliateDataWhereInput {
  const where: Prisma.AffiliateDataWhereInput = {
    date: { gte: filters.startDate, lte: filters.endDate },
  };

  if (filters.affiliateName) {
    if (
      filters.campaignIds === null ||
      filters.campaignIds.includes(filters.affiliateName)
    ) {
      where.campaignId = filters.affiliateName;
    } else {
      where.campaignId = '___FORBIDDEN___';
    }
  } else if (filters.campaignIds !== null) {
    where.campaignId = { in: filters.campaignIds };
  }
  if (filters.bettingHouse) {
    where.bettingHouse = filters.bettingHouse;
  }
  if (filters.campaignName) {
    where.campaignName = filters.campaignName;
  }
  if (filters.utmCampaign) {
    where.utmCampaign = filters.utmCampaign;
  }
  const and: Prisma.AffiliateDataWhereInput[] = [];
  if (filters.auditExclusion) {
    and.push({
      NOT: {
        date: {
          gte: filters.auditExclusion.startDate,
          lt: filters.auditExclusion.endDate,
        },
      },
    });
  }
  // Balance cutover POR CAMPANHA: esconde os dados de cada campanha anteriores à
  // sua data de cutover (espelha aggregatePerCampaignHouse). Alias-safe: filtra
  // por campaignId, então funciona mesmo com o dado no bucket da casa-fonte.
  if (filters.campaignCutover && filters.campaignCutover.size > 0) {
    and.push({
      NOT: {
        OR: [...filters.campaignCutover.entries()].map(
          ([campaignId, cutoff]) => ({ campaignId, date: { lt: cutoff } }),
        ),
      },
    });
  }
  if (and.length > 0) where.AND = and;

  return where;
}

// Fragmento SQL do balance cutover por campanha (usado no aggregateDaily raw).
function cutoverSql(
  campaignCutover: Map<string, Date> | undefined,
): Prisma.Sql {
  if (!campaignCutover || campaignCutover.size === 0) return Prisma.empty;
  const terms = [...campaignCutover.entries()].map(
    ([campaignId, cutoff]) =>
      Prisma.sql`("campaignId" = ${campaignId} AND date < ${cutoff})`,
  );
  return Prisma.sql`AND NOT (${Prisma.join(terms, ' OR ')})`;
}

@Injectable()
export class DashboardPrismaRepository implements IDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async aggregateSummary(
    filters: DashboardFilters,
  ): Promise<AggregatedMetrics> {
    const result = await this.prisma.affiliateData.aggregate({
      where: buildWhere(filters),
      _sum: {
        clicks: true,
        registrations: true,
        ftds: true,
        qftd: true,
        deposit: true,
        volume: true,
        revShare: true,
        cpaValue: true,
        cpaQualified: true,
        totalCommission: true,
      },
    });

    return {
      clicks: result._sum.clicks ?? 0,
      registrations: result._sum.registrations ?? 0,
      ftds: result._sum.ftds ?? 0,
      qftd: result._sum.qftd ?? 0,
      deposit: toNum(result._sum.deposit),
      volume: toNum(result._sum.volume),
      revShare: toNum(result._sum.revShare),
      cpaValue: toNum(result._sum.cpaValue),
      cpaQualified: result._sum.cpaQualified ?? 0,
      totalCommission: toNum(result._sum.totalCommission),
    };
  }

  async aggregateDaily(filters: DashboardFilters): Promise<DailyMetrics[]> {
    // Prisma groupBy does not support date-casting to day — use raw SQL
    // If campaignIds is an empty array the user has no accessible campaigns — return early
    if (filters.campaignIds !== null && filters.campaignIds.length === 0)
      return [];

    let campaignFilter = Prisma.empty;
    if (filters.affiliateName) {
      if (
        filters.campaignIds === null ||
        filters.campaignIds.includes(filters.affiliateName)
      ) {
        campaignFilter = Prisma.sql`AND "campaignId" = ${filters.affiliateName}`;
      } else {
        campaignFilter = Prisma.sql`AND "campaignId" = '___FORBIDDEN___'`;
      }
    } else if (filters.campaignIds !== null) {
      campaignFilter = Prisma.sql`AND "campaignId" = ANY(${Prisma.sql`ARRAY[${Prisma.join(filters.campaignIds.map((id) => Prisma.sql`${id}`))}]`})`;
    }

    const houseFilter = filters.bettingHouse
      ? Prisma.sql`AND "bettingHouse" = ${filters.bettingHouse}`
      : Prisma.empty;

    const campaignNameFilter = filters.campaignName
      ? Prisma.sql`AND "campaignName" = ${filters.campaignName}`
      : Prisma.empty;

    const utmFilter = filters.utmCampaign
      ? Prisma.sql`AND "utmCampaign" = ${filters.utmCampaign}`
      : Prisma.empty;

    const auditFilter = filters.auditExclusion
      ? Prisma.sql`AND NOT (date >= ${filters.auditExclusion.startDate} AND date < ${filters.auditExclusion.endDate})`
      : Prisma.empty;

    const cutoverFilter = cutoverSql(filters.campaignCutover);

    // Emit the day as TEXT (TO_CHAR) instead of a Postgres DATE — pg-types
    // parses DATE as local-midnight via `postgres-date`, which shifts the day
    // by one on hosts with a positive UTC offset.
    type RawRow = {
      day: string;
      clicks: bigint;
      registrations: bigint;
      ftds: bigint;
      qftd: bigint;
      deposit: string;
      volume: string;
      rev_share: string;
      cpa_value: string;
      cpa_qualified: bigint;
      total_commission: string;
    };

    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT
        TO_CHAR(date::date, 'YYYY-MM-DD') AS day,
        SUM(clicks)::bigint               AS clicks,
        SUM(registrations)::bigint        AS registrations,
        SUM(ftds)::bigint                 AS ftds,
        SUM(qftd)::bigint                 AS qftd,
        SUM(deposit)::text                AS deposit,
        SUM(volume)::text                 AS volume,
        SUM("revShare")::text             AS rev_share,
        SUM("cpaValue")::text             AS cpa_value,
        SUM("cpaQualified")::bigint       AS cpa_qualified,
        SUM("totalCommission")::text      AS total_commission
      FROM affiliate_data
      WHERE date >= ${filters.startDate}
        AND date <= ${filters.endDate}
        ${campaignFilter}
        ${houseFilter}
        ${campaignNameFilter}
        ${utmFilter}
        ${auditFilter}
        ${cutoverFilter}
      GROUP BY date::date
      ORDER BY date::date ASC
    `;

    return rows.map((r) => ({
      date: r.day,
      clicks: Number(r.clicks),
      registrations: Number(r.registrations),
      ftds: Number(r.ftds),
      qftd: Number(r.qftd),
      deposit: parseFloat(r.deposit),
      volume: parseFloat(r.volume),
      revShare: parseFloat(r.rev_share),
      cpaValue: parseFloat(r.cpa_value),
      cpaQualified: Number(r.cpa_qualified),
      totalCommission: parseFloat(r.total_commission),
    }));
  }

  async aggregateByCampaign(
    filters: DashboardFilters,
  ): Promise<CampaignMetrics[]> {
    const rows = await this.prisma.affiliateData.groupBy({
      by: ['campaignId', 'bettingHouse', 'campaignName'],
      where: buildWhere(filters),
      _sum: {
        clicks: true,
        registrations: true,
        ftds: true,
        qftd: true,
        deposit: true,
        volume: true,
        revShare: true,
        cpaValue: true,
        cpaQualified: true,
        totalCommission: true,
      },
      orderBy: { _sum: { totalCommission: 'desc' } },
    });

    return rows.map((r) => ({
      campaignId: r.campaignId,
      bettingHouse: r.bettingHouse,
      campaignName: r.campaignName,
      clicks: r._sum.clicks ?? 0,
      registrations: r._sum.registrations ?? 0,
      ftds: r._sum.ftds ?? 0,
      qftd: r._sum.qftd ?? 0,
      deposit: toNum(r._sum.deposit),
      volume: toNum(r._sum.volume),
      revShare: toNum(r._sum.revShare),
      cpaValue: toNum(r._sum.cpaValue),
      cpaQualified: r._sum.cpaQualified ?? 0,
      totalCommission: toNum(r._sum.totalCommission),
    }));
  }

  async aggregateDailyPerHouse(filters: DashboardFilters): Promise<
    {
      date: string;
      bettingHouse: string;
      clicks: number;
      registrations: number;
      ftds: number;
      qftd: number;
      deposit: number;
      volume: number;
      revShare: number;
      cpaValue: number;
      totalCommission: number;
    }[]
  > {
    if (filters.campaignIds !== null && filters.campaignIds.length === 0)
      return [];

    const where = buildWhere(filters);
    const rows = await this.prisma.affiliateData.groupBy({
      by: ['date', 'bettingHouse'],
      where,
      _sum: {
        clicks: true,
        registrations: true,
        ftds: true,
        qftd: true,
        deposit: true,
        volume: true,
        revShare: true,
        cpaValue: true,
        totalCommission: true,
      },
      orderBy: [{ date: 'desc' }, { bettingHouse: 'asc' }],
    });

    return rows.map((r) => ({
      // Use UTC accessors — Prisma @db.Date is stored as UTC-midnight;
      // toISOString() may shift the day on positive-UTC-offset hosts.
      date: `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, '0')}-${String(r.date.getUTCDate()).padStart(2, '0')}`,
      bettingHouse: r.bettingHouse,
      clicks: r._sum.clicks ?? 0,
      registrations: r._sum.registrations ?? 0,
      ftds: r._sum.ftds ?? 0,
      qftd: r._sum.qftd ?? 0,
      deposit: toNum(r._sum.deposit),
      volume: toNum(r._sum.volume),
      revShare: toNum(r._sum.revShare),
      cpaValue: toNum(r._sum.cpaValue),
      totalCommission: toNum(r._sum.totalCommission),
    }));
  }

  async aggregatePerCampaignHouse(
    campaignIds: string[],
    bettingHouse: string | undefined,
    startDate: Date,
    endDate: Date,
    auditExclusion?: AuditExclusion,
    campaignCutover?: Map<string, Date>,
  ): Promise<CampaignHouseMetrics[]> {
    if (campaignIds.length === 0) return [];

    const where: Prisma.AffiliateDataWhereInput = {
      campaignId: { in: campaignIds },
      date: { gte: startDate, lte: endDate },
    };
    if (bettingHouse) where.bettingHouse = bettingHouse;
    const and: Prisma.AffiliateDataWhereInput[] = [];
    if (auditExclusion) {
      and.push({
        NOT: {
          date: { gte: auditExclusion.startDate, lt: auditExclusion.endDate },
        },
      });
    }
    // Balance cutover POR CAMPANHA (alias-safe): exclui, por campanha, os dados
    // anteriores à data de cutover daquela campanha. Diferente do cutover de sync;
    // funciona mesmo quando o dado vive no bucket da casa-fonte (esportiva-diario
    // lê de esportivabet).
    if (campaignCutover && campaignCutover.size > 0) {
      and.push({
        NOT: {
          OR: [...campaignCutover.entries()].map(([campaignId, cutoff]) => ({
            campaignId,
            date: { lt: cutoff },
          })),
        },
      });
    }
    if (and.length > 0) where.AND = and;

    const rows = await this.prisma.affiliateData.groupBy({
      by: ['campaignId', 'bettingHouse'],
      where,
      _sum: {
        cpaQualified: true,
        revShare: true,
        deposit: true,
        netPl: true,
        withdrawalTotal: true,
        volume: true,
      },
      _count: {
        _all: true,
        netPl: true,
        withdrawalTotal: true,
        volume: true,
      },
    });

    return rows.map((r) => ({
      campaignId: r.campaignId,
      bettingHouse: r.bettingHouse,
      cpaQualified: r._sum.cpaQualified ?? 0,
      revShare: toNum(r._sum.revShare),
      deposit: toNum(r._sum.deposit),
      netPl: r._count._all === r._count.netPl ? toNum(r._sum.netPl) : null,
      withdrawalTotal: toNum(r._sum.withdrawalTotal),
      volume: toNum(r._sum.volume),
      pinbetMetricsComplete:
        r._count._all === r._count.netPl &&
        r._count._all === r._count.withdrawalTotal &&
        r._count._all === r._count.volume,
    }));
  }

  async aggregatePinbetMetrics(
    filters: DashboardFilters,
  ): Promise<PinbetOperationalMetrics[]> {
    if (
      filters.bettingHouse &&
      !['pinbet-diario', 'pinbet-mensal'].includes(filters.bettingHouse)
    ) {
      return [];
    }
    const where = buildWhere(filters);
    if (!filters.bettingHouse) {
      where.bettingHouse = { in: ['pinbet-diario', 'pinbet-mensal'] };
    }
    const rows = await this.prisma.affiliateData.groupBy({
      by: ['bettingHouse'],
      where,
      _sum: {
        netPl: true,
        deposit: true,
        withdrawalTotal: true,
        volume: true,
      },
      _count: {
        _all: true,
        netPl: true,
        withdrawalTotal: true,
        volume: true,
      },
    });
    return rows.map((row) => ({
      house: row.bettingHouse as 'pinbet-diario' | 'pinbet-mensal',
      netPl:
        row._count._all === row._count.netPl ? toNum(row._sum.netPl) : null,
      depositTotal: toNum(row._sum.deposit),
      withdrawalTotal: toNum(row._sum.withdrawalTotal),
      volume: toNum(row._sum.volume),
      metricsComplete:
        row._count._all === row._count.netPl &&
        row._count._all === row._count.withdrawalTotal &&
        row._count._all === row._count.volume,
    }));
  }

  async getDistinctAffiliates(
    campaignIds: string[] | null,
    bettingHouse?: string,
  ): Promise<string[]> {
    const where: Prisma.AffiliateDataWhereInput = {};
    if (campaignIds !== null) where.campaignId = { in: campaignIds };
    if (bettingHouse) where.bettingHouse = bettingHouse;

    const rows = await this.prisma.affiliateData.findMany({
      where,
      distinct: ['campaignId'],
      select: { campaignId: true },
      orderBy: { campaignId: 'asc' },
    });
    return rows.map((r) => r.campaignId);
  }

  async getDistinctCampaigns(
    campaignIds: string[] | null,
    bettingHouse?: string,
    affiliateName?: string,
  ): Promise<string[]> {
    const where: Prisma.AffiliateDataWhereInput = {};
    if (campaignIds !== null) where.campaignId = { in: campaignIds };
    if (bettingHouse) where.bettingHouse = bettingHouse;
    if (affiliateName) where.campaignId = affiliateName;

    const rows = await this.prisma.affiliateData.findMany({
      where,
      distinct: ['campaignName'],
      select: { campaignName: true },
      orderBy: { campaignName: 'asc' },
    });
    return rows.map((r) => r.campaignName);
  }

  async getDistinctPanels(
    campaignIds: string[] | null,
    bettingHouse?: string,
  ): Promise<string[]> {
    const where: Prisma.AffiliateDataWhereInput = {};
    if (campaignIds !== null) where.campaignId = { in: campaignIds };
    if (bettingHouse) where.bettingHouse = bettingHouse;

    const rows = await this.prisma.affiliateData.findMany({
      where,
      distinct: ['utmCampaign'],
      select: { utmCampaign: true },
      orderBy: { utmCampaign: 'asc' },
    });
    return rows.map((r) => r.utmCampaign).filter(Boolean);
  }

  async getSyncedDays(bettingHouseSlug: string): Promise<SyncDay[]> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const today = now.getDate();
    const daysInMonth = endOfMonth.getDate();

    type RawDay = { day: number };
    const raw = await this.prisma.$queryRaw<RawDay[]>`
      SELECT DISTINCT EXTRACT(DAY FROM date)::int AS day
      FROM affiliate_data
      WHERE "bettingHouse" = ${bettingHouseSlug}
        AND date >= ${startOfMonth}
        AND date <= ${endOfMonth}
    `;

    const syncedSet = new Set(raw.map((r) => r.day));
    const result: SyncDay[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      let status: SyncDayStatus = 'future';
      if (d === today) {
        status = 'today';
      } else if (d < today) {
        status = syncedSet.has(d) ? 'synced' : 'pending';
      }
      result.push({ day: d, status, hasSynced: syncedSet.has(d) });
    }

    return result;
  }

  async aggregateRanking(
    campaignIds: string[],
    startDate: Date,
    endDate: Date,
    bettingHouse?: string,
    limit = 20,
  ): Promise<{ campaignId: string; metrics: AggregatedMetrics }[]> {
    if (campaignIds.length === 0) return [];

    const where: Prisma.AffiliateDataWhereInput = {
      campaignId: { in: campaignIds },
      date: { gte: startDate, lte: endDate },
    };
    if (bettingHouse) where.bettingHouse = bettingHouse;

    const rows = await this.prisma.affiliateData.groupBy({
      by: ['campaignId'],
      where,
      _sum: {
        clicks: true,
        registrations: true,
        ftds: true,
        qftd: true,
        deposit: true,
        volume: true,
        revShare: true,
        cpaValue: true,
        cpaQualified: true,
        totalCommission: true,
      },
      orderBy: { _sum: { cpaQualified: 'desc' } },
      take: limit,
    });

    return rows.map((r) => ({
      campaignId: r.campaignId,
      metrics: {
        clicks: r._sum.clicks ?? 0,
        registrations: r._sum.registrations ?? 0,
        ftds: r._sum.ftds ?? 0,
        qftd: r._sum.qftd ?? 0,
        deposit: toNum(r._sum.deposit),
        volume: toNum(r._sum.volume),
        revShare: toNum(r._sum.revShare),
        cpaValue: toNum(r._sum.cpaValue),
        cpaQualified: r._sum.cpaQualified ?? 0,
        totalCommission: toNum(r._sum.totalCommission),
      },
    }));
  }
}

// Re-export token for module wiring
export { DASHBOARD_REPOSITORY };
