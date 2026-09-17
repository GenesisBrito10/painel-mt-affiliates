import { Injectable, Inject, Logger } from '@nestjs/common';
import { SettingsService } from '../../settings/index.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DashboardAccessService } from './dashboard-access.service.js';
import {
  DASHBOARD_REPOSITORY,
  type IDashboardRepository,
} from '../domain/ports/dashboard.repository.js';
import type {
  DashboardFilters,
  AuditExclusion,
  AggregatedMetrics,
  DailyMetrics,
} from '../domain/types/dashboard.types.js';
import { ZERO_METRICS } from '../domain/types/dashboard.types.js';
import { dataSourceHouse } from '../domain/house-alias.js';
import type {
  DashboardQueryDto,
  DashboardFiltersResponseDto,
  CampaignRowDto,
  RankingRowDto,
  RankingQueryDto,
  SyncStatusResponseDto,
  WithdrawalScheduleDto,
} from './dto/dashboard.dto.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';

const SETTINGS_KEYS = [
  'withdrawal_block_active',
  'withdrawal_block_start_date',
  'withdrawal_block_end_date',
] as const;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @Inject(DASHBOARD_REPOSITORY)
    private readonly repo: IDashboardRepository,
    private readonly access: DashboardAccessService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Summary ─────────────────────────────────────────────────────────────

  async getSummary(
    user: JwtPayload,
    query: DashboardQueryDto,
  ): Promise<AggregatedMetrics> {
    const filters = await this.buildFilters(user, query);
    if (!filters) return ZERO_METRICS;
    return this.repo.aggregateSummary(filters);
  }

  async getPinbetMetrics(user: JwtPayload, query: DashboardQueryDto) {
    if (
      query.bettingHouse &&
      !['pinbet-diario', 'pinbet-mensal'].includes(query.bettingHouse)
    ) {
      return { houses: [] };
    }
    const filters = await this.buildFilters(user, query);
    if (!filters) return { houses: [] };
    const rows = await this.repo.aggregatePinbetMetrics(filters);
    return {
      houses: rows.map((row) => ({
        ...row,
        name: row.house === 'pinbet-diario' ? 'Pinbet Diário' : 'Pinbet Mensal',
        health: !row.metricsComplete
          ? 'SYNCING'
          : (row.netPl ?? 0) > 0
            ? 'HEALTHY'
            : 'ATTENTION',
      })),
    };
  }

  // ─── Daily ───────────────────────────────────────────────────────────────

  async getDaily(
    user: JwtPayload,
    query: DashboardQueryDto,
  ): Promise<{
    data: DailyMetrics[];
    myData: DailyMetrics[];
    networkData: DailyMetrics[];
  }> {
    const accessCtx = await this.access.resolveAccessContext(
      user.sub,
      user.role,
    );
    const auditExclusion = await this.loadAuditExclusion();
    const { startDate, endDate } = buildDateRange(
      query.startDate,
      query.endDate,
    );

    const allIds = this.access.resolveCampaignIdsForScope(accessCtx, 'all');
    const allResolved = await this.resolveHouseFilter(
      query.bettingHouse,
      allIds,
    );
    const campaignCutover = await this.buildCampaignCutover(
      allResolved.campaignIds,
    );
    const allFilters: DashboardFilters = {
      campaignIds: allResolved.campaignIds,
      bettingHouse: allResolved.bettingHouse,
      startDate,
      endDate,
      campaignName: query.campaignName,
      utmCampaign: query.utmCampaign,
      auditExclusion,
      campaignCutover,
    };

    const data = await this.repo.aggregateDaily(allFilters);

    if (accessCtx.isAdmin || query.scope === 'all') {
      return { data, myData: [], networkData: [] };
    }

    // Separate myData and networkData for non-admin with scope
    const myIds = this.access.resolveCampaignIdsForScope(accessCtx, 'mine');
    const myResolved = await this.resolveHouseFilter(query.bettingHouse, myIds);
    const myFilters: DashboardFilters = {
      ...allFilters,
      campaignIds: myResolved.campaignIds,
    };
    const myData = await this.repo.aggregateDaily(myFilters);

    const myDataMap = new Map(myData.map((r) => [r.date, r]));
    const networkData: DailyMetrics[] = data.map((row) => {
      const my = myDataMap.get(row.date);
      return {
        date: row.date,
        clicks: row.clicks - (my?.clicks ?? 0),
        registrations: row.registrations - (my?.registrations ?? 0),
        ftds: row.ftds - (my?.ftds ?? 0),
        qftd: row.qftd - (my?.qftd ?? 0),
        deposit: row.deposit - (my?.deposit ?? 0),
        volume: row.volume - (my?.volume ?? 0),
        revShare: row.revShare - (my?.revShare ?? 0),
        cpaValue: row.cpaValue - (my?.cpaValue ?? 0),
        cpaQualified: row.cpaQualified - (my?.cpaQualified ?? 0),
        totalCommission: row.totalCommission - (my?.totalCommission ?? 0),
      };
    });

    return { data, myData, networkData };
  }

  // ─── Filters ─────────────────────────────────────────────────────────────

  async getFilters(
    user: JwtPayload,
    query: Pick<DashboardQueryDto, 'bettingHouse' | 'affiliateName'>,
  ): Promise<DashboardFiltersResponseDto> {
    const accessCtx = await this.access.resolveAccessContext(
      user.sub,
      user.role,
    );
    const campaignIds = this.access.resolveCampaignIdsForScope(
      accessCtx,
      'all',
    );

    // Active houses filtered by user access
    const allHouses = await this.prisma.bettingHouse.findMany({
      where: { active: true },
      select: { id: true, name: true, slug: true, logoUrl: true },
      orderBy: { name: 'asc' },
    });

    let houses = allHouses;
    if (!accessCtx.isAdmin && campaignIds !== null) {
      // A house is visible when the user has an active affiliate_link OR a
      // FULFILLED link_request. Hiding houses with link_requests still
      // PENDING/REJECTED but an active link emptied the dropdown for users
      // with legitimate access.
      const [fulfilledRequests, allUserLinks] = await Promise.all([
        this.prisma.linkRequest.findMany({
          where: { userId: user.sub, status: 'FULFILLED' },
          select: { bettingHouseSlug: true },
          distinct: ['bettingHouseSlug'],
        }),
        this.prisma.affiliateLink.findMany({
          where: { userId: user.sub },
          select: { bettingHouse: true },
          distinct: ['bettingHouse'],
        }),
      ]);

      const allowedSlugs = new Set<string>([
        ...fulfilledRequests.map((r) => r.bettingHouseSlug),
        ...allUserLinks.map((l) => l.bettingHouse),
      ]);
      houses = allHouses.filter((h) => allowedSlugs.has(h.slug));
    }

    const [affiliates, campaigns, panels] = await Promise.all([
      this.repo.getDistinctAffiliates(campaignIds, query.bettingHouse),
      this.repo.getDistinctCampaigns(
        campaignIds,
        query.bettingHouse,
        query.affiliateName,
      ),
      this.repo.getDistinctPanels(campaignIds, query.bettingHouse),
    ]);

    return { bettingHouses: houses, affiliates, campaigns, panels };
  }

  // ─── Campaigns ───────────────────────────────────────────────────────────

  async getCampaigns(
    user: JwtPayload,
    query: DashboardQueryDto,
  ): Promise<CampaignRowDto[]> {
    const filters = await this.buildFilters(user, query);
    if (!filters) return [];
    return this.repo.aggregateByCampaign(filters);
  }

  async getDailyPerHouse(user: JwtPayload, query: DashboardQueryDto) {
    const filters = await this.buildFilters(user, query);
    if (!filters) return [];
    return this.repo.aggregateDailyPerHouse(filters);
  }

  // ─── Withdrawal Schedule ─────────────────────────────────────────────────

  async getWithdrawalSchedule(): Promise<WithdrawalScheduleDto[]> {
    const houses = await this.prisma.bettingHouse.findMany({
      where: { active: true },
      select: {
        name: true,
        slug: true,
        withdrawalDay: true,
        withdrawalDayEnd: true,
      },
      orderBy: { name: 'asc' },
    });
    return houses;
  }

  // ─── Sync Status ─────────────────────────────────────────────────────────

  async getSyncStatus(houseSlug: string): Promise<SyncStatusResponseDto> {
    const house = await this.prisma.bettingHouse.findUnique({
      where: { slug: houseSlug },
      select: { name: true, lastSyncAt: true },
    });

    const now = new Date();
    const days = await this.repo.getSyncedDays(houseSlug);

    return {
      house: house?.name ?? houseSlug,
      lastSyncAt: house?.lastSyncAt ?? null,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      today: now.getDate(),
      days,
    };
  }

  // ─── Ranking ─────────────────────────────────────────────────────────────

  async getRanking(query: RankingQueryDto): Promise<RankingRowDto[]> {
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '20')));
    const { startDate, endDate } = buildDateRange(
      query.startDate,
      query.endDate,
    );

    // Collect all users with affiliate links → campaignId → userName mapping
    const usersWithLinks = await this.prisma.affiliateLink.findMany({
      where: { campaignId: { not: '' } },
      select: {
        campaignId: true,
        user: { select: { name: true } },
      },
      distinct: ['campaignId'],
    });

    const campaignToUser = new Map<string, string>();
    for (const l of usersWithLinks) {
      campaignToUser.set(l.campaignId, l.user.name);
    }

    if (campaignToUser.size === 0) return [];

    const campaignIds = Array.from(campaignToUser.keys());
    const rows = await this.repo.aggregateRanking(
      campaignIds,
      startDate,
      endDate,
      query.bettingHouse,
      limit,
    );

    return rows.map((r, i) => ({
      rank: i + 1,
      campaignId: r.campaignId,
      userName: campaignToUser.get(r.campaignId) ?? r.campaignId,
      cpaQualified: r.metrics.cpaQualified,
      ftds: r.metrics.ftds,
      registrations: r.metrics.registrations,
      deposit: r.metrics.deposit,
      revShare: r.metrics.revShare,
      cpaValue: r.metrics.cpaValue,
      totalCommission: r.metrics.totalCommission,
    }));
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  async buildFilters(
    user: JwtPayload,
    query: DashboardQueryDto,
  ): Promise<DashboardFilters | null> {
    const accessCtx = await this.access.resolveAccessContext(
      user.sub,
      user.role,
    );
    const campaignIds = this.access.resolveCampaignIdsForScope(
      accessCtx,
      query.scope ?? 'all',
    );

    // Non-admin with no accessible campaigns → return null (empty response)
    if (
      !accessCtx.isAdmin &&
      campaignIds !== null &&
      campaignIds.length === 0
    ) {
      return null;
    }

    const { startDate, endDate } = buildDateRange(
      query.startDate,
      query.endDate,
    );
    const auditExclusion = await this.loadAuditExclusion();

    const { bettingHouse, campaignIds: houseCampaignIds } =
      await this.resolveHouseFilter(query.bettingHouse, campaignIds);

    const campaignCutover = await this.buildCampaignCutover(houseCampaignIds);

    return {
      campaignIds: houseCampaignIds,
      bettingHouse,
      startDate,
      endDate,
      campaignName: query.campaignName,
      utmCampaign: query.utmCampaign,
      affiliateName: query.affiliateName,
      auditExclusion,
      campaignCutover,
    };
  }

  /**
   * Casas com conta compartilhada (ex.: esportiva-diario ⇐ esportivabet) guardam o
   * affiliate_data sob a casa-FONTE. Ao filtrar por uma casa aliased, redireciona o
   * filtro para a fonte E restringe os campaignIds às campanhas cujo LINK é dessa
   * casa — senão a métrica lê o bucket vazio (zera) ou vaza da casa-fonte. Casas
   * não-aliased ficam inalteradas. Espelha o dataSourceHouse do saldo.
   */
  private async resolveHouseFilter(
    bettingHouse: string | undefined,
    campaignIds: string[] | null,
  ): Promise<{ bettingHouse?: string; campaignIds: string[] | null }> {
    if (!bettingHouse) return { bettingHouse, campaignIds };
    const source = dataSourceHouse(bettingHouse);
    if (source === bettingHouse) return { bettingHouse, campaignIds };

    const links = await this.prisma.affiliateLink.findMany({
      where: {
        bettingHouse,
        deletedAt: null,
        ...(campaignIds ? { campaignId: { in: campaignIds } } : {}),
      },
      select: { campaignId: true },
    });
    const scoped = [...new Set(links.map((l) => l.campaignId))];
    return { bettingHouse: source, campaignIds: scoped };
  }

  /**
   * Monta o balance cutover POR CAMPANHA para o dashboard (front + admin): lê os
   * settings `balance_cutover_date_<slug>` e, para as campanhas em escopo cujo
   * LINK é de uma casa com cutover, mapeia campanha → data. As queries escondem
   * os dados dessas campanhas anteriores à data. Espelha o cutover de saldo (NÃO
   * usa o cutover global de ledger — dashboard mostra histórico das demais casas).
   * `undefined` quando nenhuma casa tem cutover (no-op).
   */
  async buildCampaignCutover(
    campaignIds: string[] | null,
  ): Promise<Map<string, Date> | undefined> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { startsWith: 'balance_cutover_date_' } },
      select: { key: true, value: true },
    });
    const perHouse = new Map<string, Date>();
    for (const r of rows) {
      const slug = r.key.slice('balance_cutover_date_'.length);
      const d = new Date(`${r.value}T00:00:00.000Z`);
      if (slug && !isNaN(d.getTime())) perHouse.set(slug, d);
    }
    if (perHouse.size === 0) return undefined;

    // Só campanhas cujo LINK é de uma casa com cutover (escopo pequeno).
    const links = await this.prisma.affiliateLink.findMany({
      where: {
        deletedAt: null,
        bettingHouse: { in: [...perHouse.keys()] },
        ...(campaignIds ? { campaignId: { in: campaignIds } } : {}),
      },
      select: { campaignId: true, bettingHouse: true },
    });
    const map = new Map<string, Date>();
    for (const l of links) {
      const d = perHouse.get(l.bettingHouse);
      if (d) map.set(l.campaignId, d);
    }
    return map.size > 0 ? map : undefined;
  }

  async loadAuditExclusion(): Promise<AuditExclusion | undefined> {
    const settingsMap = await this.settings.getMany([...SETTINGS_KEYS]);
    const active = settingsMap.get('withdrawal_block_active');
    if (active !== 'true') return undefined;

    const startStr =
      settingsMap.get('withdrawal_block_start_date') ?? '2026-04-01';
    const endStr = settingsMap.get('withdrawal_block_end_date') ?? '2026-05-01';

    return {
      startDate: new Date(startStr),
      endDate: new Date(endStr),
    };
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function buildDateRange(
  startDate?: string,
  endDate?: string,
): { startDate: Date; endDate: Date } {
  const now = new Date();
  const start = startDate
    ? new Date(`${startDate}T00:00:00.000Z`)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = endDate ? new Date(`${endDate}T23:59:59.999Z`) : now;
  return { startDate: start, endDate: end };
}
