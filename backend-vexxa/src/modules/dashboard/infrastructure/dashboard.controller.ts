import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { buildDateRange } from '../application/dashboard.service.js';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
} from '../../auth/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { DashboardService } from '../application/dashboard.service.js';
import {
  DashboardBalanceService,
  NETWORK_LEVEL_CAP,
} from '../application/dashboard-balance.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  DashboardQueryDto,
  RankingQueryDto,
} from '../application/dto/dashboard.dto.js';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'dashboard', version: '1' })
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly balanceService: DashboardBalanceService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── GET /v1/dashboard/filters ──────────────────────────────────────────
  @Get('filters')
  async getFilters(
    @CurrentUser() user: JwtPayload,
    @Query() query: Pick<DashboardQueryDto, 'bettingHouse' | 'affiliateName'>,
  ) {
    return this.dashboardService.getFilters(user, query);
  }

  // ─── GET /v1/dashboard/summary ──────────────────────────────────────────
  @Get('summary')
  async getSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getSummary(user, query);
  }

  @Get('pinbet-metrics')
  async getPinbetMetrics(
    @CurrentUser() user: JwtPayload,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getPinbetMetrics(user, query);
  }

  // ─── GET /v1/dashboard/daily ────────────────────────────────────────────
  @Get('daily')
  async getDaily(
    @CurrentUser() user: JwtPayload,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getDaily(user, query);
  }

  // ─── GET /v1/dashboard/balance ──────────────────────────────────────────
  @Get('balance')
  async getBalance(
    @CurrentUser() user: JwtPayload,
    @Query()
    query: Pick<DashboardQueryDto, 'startDate' | 'endDate' | 'bettingHouse'>,
  ) {
    return this.balanceService.getBalance(user, query);
  }

  // ─── GET /v1/dashboard/campaigns ────────────────────────────────────────
  @Get('campaigns')
  async getCampaigns(
    @CurrentUser() user: JwtPayload,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getCampaigns(user, query);
  }

  // ─── GET /v1/dashboard/links-performance ────────────────────────────────
  @Get('links-performance')
  async getLinksPerformance(
    @CurrentUser() user: JwtPayload,
    @Query() query: DashboardQueryDto,
  ) {
    // Admin has no individual link view — return empty
    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN)
      return { data: [] };

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        affiliateLinks: {
          where: { deletedAt: null },
          select: {
            campaignId: true,
            bettingHouse: true,
            cpa: true,
            revshare: true,
          },
        },
      },
    });

    if (!dbUser || dbUser.affiliateLinks.length === 0) return { data: [] };

    // Filter by query params
    const links = dbUser.affiliateLinks.filter((l) => {
      if (query.bettingHouse && l.bettingHouse !== query.bettingHouse)
        return false;
      return true;
    });

    if (links.length === 0) return { data: [] };

    const { startDate, endDate } = buildDateRange(
      query.startDate,
      query.endDate,
    );
    const auditExclusion = await this.dashboardService.loadAuditExclusion();

    const agg = await this.prisma.affiliateData.groupBy({
      by: ['campaignId', 'bettingHouse'],
      where: {
        campaignId: { in: links.map((l) => l.campaignId) },
        ...(query.bettingHouse ? { bettingHouse: query.bettingHouse } : {}),
        ...(auditExclusion
          ? {
              NOT: {
                date: {
                  gte: auditExclusion.startDate,
                  lt: auditExclusion.endDate,
                },
              },
            }
          : {}),
      },
      _sum: {
        clicks: true,
        registrations: true,
        ftds: true,
        qftd: true,
        deposit: true,
        revShare: true,
        cpaValue: true,
        cpaQualified: true,
        totalCommission: true,
      },
    });

    const aggMap = new Map(
      agg.map((r) => [`${r.campaignId}__${r.bettingHouse}`, r]),
    );

    const data = links.map((link) => {
      const row = aggMap.get(`${link.campaignId}__${link.bettingHouse}`);
      const cpaRate = link.cpa?.toNumber() ?? 0;
      const revRate = link.revshare?.toNumber() ?? 0;
      const qftd = row?._sum.cpaQualified ?? 0;
      const revShare = row?._sum.revShare?.toNumber() ?? 0;
      const myCpa = cpaRate * qftd;
      const myRev = (revRate / 100) * revShare;

      return {
        key: `${link.bettingHouse}||${link.campaignId}`,
        bettingHouse: link.bettingHouse,
        campaignId: link.campaignId,
        cpaRate,
        revRate,
        myCpa,
        myRev,
        myCommission: myCpa + myRev,
        clicks: row?._sum.clicks ?? 0,
        registrations: row?._sum.registrations ?? 0,
        ftds: row?._sum.ftds ?? 0,
        qftd,
        deposit: row?._sum.deposit?.toNumber() ?? 0,
        revShare,
        cpaValue: row?._sum.cpaValue?.toNumber() ?? 0,
        cpaQualified: qftd,
        totalCommission: row?._sum.totalCommission?.toNumber() ?? 0,
      };
    });

    return {
      data: data.sort((a, b) => b.myCommission - a.myCommission),
    };
  }

  // ─── GET /v1/dashboard/sync-status ──────────────────────────────────────
  @Get('sync-status')
  async getSyncStatus(@Query('house') house: string) {
    if (!house) throw new BadRequestException('house é obrigatório');
    return this.dashboardService.getSyncStatus(house);
  }

  // ─── GET /v1/dashboard/ranking ──────────────────────────────────────────
  @Get('ranking')
  async getRanking(@Query() query: RankingQueryDto) {
    const data = await this.dashboardService.getRanking(query);
    return { data };
  }

  // ─── GET /v1/dashboard/fraud-details ────────────────────────────────────
  @Get('fraud-details')
  async getFraudDetails(@CurrentUser() user: JwtPayload) {
    const dbUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: {
        affiliateLinks: {
          where: { deletedAt: null },
          select: { campaignId: true, bettingHouse: true, cpa: true },
        },
        fraudCounts: { select: { bettingHouse: true, count: true } },
      },
    });

    const directFrauds = dbUser.fraudCounts
      .filter((f) => f.count > 0)
      .map((f) => {
        const link = dbUser.affiliateLinks.find(
          (l) => l.bettingHouse === f.bettingHouse,
        );
        const cpaRate = link?.cpa?.toNumber() ?? 0;
        return {
          bettingHouse: f.bettingHouse,
          fraudCount: f.count,
          cpaRate,
          deduction: cpaRate * f.count,
          source: 'direct' as const,
        };
      });

    // Load network fraud (same BFS as balance)
    type FraudRow = {
      bettingHouse: string;
      fraudCount: number;
      cpaRate: number;
      deduction: number;
      source: 'direct' | 'network';
      memberId?: string;
      memberName?: string;
      memberEmail?: string;
      memberStatus?: string;
    };
    const networkFrauds: FraudRow[] = [];
    const networkMembers = await this.loadNetworkMembersFraud(user.sub);

    for (const member of networkMembers) {
      for (const fraud of member.fraudCounts) {
        if (!fraud.count || fraud.count <= 0) continue;
        const myLink = dbUser.affiliateLinks.find(
          (l) => l.bettingHouse === fraud.bettingHouse,
        );
        const myCpaRate = myLink?.cpa?.toNumber() ?? 0;
        const l1Cpa = member.l1CpaByHouse.get(fraud.bettingHouse) ?? 0;
        const marginCpa = Math.max(0, myCpaRate - l1Cpa);
        if (marginCpa <= 0) continue;

        networkFrauds.push({
          bettingHouse: fraud.bettingHouse,
          fraudCount: fraud.count,
          cpaRate: marginCpa,
          deduction: marginCpa * fraud.count,
          source: 'network',
          memberId: member.id,
          memberName: member.name ?? undefined,
          memberEmail: member.email ?? undefined,
          memberStatus: member.status,
        });
      }
    }

    return {
      directFrauds,
      networkFrauds,
      totalDirect: directFrauds.reduce((s, f) => s + f.deduction, 0),
      totalNetwork: networkFrauds.reduce((s, f) => s + f.deduction, 0),
      totalDeduction: [...directFrauds, ...networkFrauds].reduce(
        (s, f) => s + f.deduction,
        0,
      ),
    };
  }

  // ─── GET /v1/dashboard/fraud-overview (admin) ───────────────────────────
  @Get('fraud-overview')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getFraudOverview() {
    const usersWithFraud = await this.prisma.user.findMany({
      where: { fraudCounts: { some: { count: { gt: 0 } } } },
      select: {
        id: true,
        name: true,
        email: true,
        affiliateLinks: {
          where: { deletedAt: null },
          select: { bettingHouse: true, cpa: true },
        },
        fraudCounts: { select: { bettingHouse: true, count: true } },
      },
    });

    const data = usersWithFraud
      .map((u) => {
        const fraudList = u.fraudCounts
          .filter((f) => f.count > 0)
          .map((f) => {
            const link = u.affiliateLinks.find(
              (l) => l.bettingHouse === f.bettingHouse,
            );
            const cpa = link?.cpa?.toNumber() ?? 0;
            const deduction = cpa * f.count;
            return {
              bettingHouse: f.bettingHouse,
              fraudCount: f.count,
              cpaRate: cpa,
              deduction,
            };
          });

        if (fraudList.length === 0) return null;
        const totalCount = fraudList.reduce((s, f) => s + f.fraudCount, 0);
        const totalDeduction = fraudList.reduce((s, f) => s + f.deduction, 0);
        return {
          userId: u.id,
          name: u.name,
          email: u.email,
          fraudList,
          totalCount,
          totalDeduction,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b!.totalDeduction - a!.totalDeduction);

    return { data };
  }

  // ─── GET /v1/dashboard/withdrawal-schedule ──────────────────────────────
  @Get('withdrawal-schedule')
  async getWithdrawalSchedule() {
    return { data: await this.dashboardService.getWithdrawalSchedule() };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async loadNetworkMembersFraud(userId: string) {
    const level1 = await this.prisma.user.findMany({
      where: { referredById: userId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        affiliateLinks: {
          where: { deletedAt: null },
          select: { bettingHouse: true, cpa: true },
        },
        fraudCounts: { select: { bettingHouse: true, count: true } },
      },
    });

    type L1Anchor = {
      cpaByHouse: Map<string, number>;
      name: string | null;
      email: string;
      status: string;
    };
    const memberL1 = new Map<string, L1Anchor>();

    for (const l1 of level1) {
      const anchor: L1Anchor = {
        cpaByHouse: new Map(),
        name: l1.name,
        email: l1.email,
        status: l1.status,
      };
      for (const link of l1.affiliateLinks) {
        if (link.cpa && link.cpa.toNumber() > 0)
          anchor.cpaByHouse.set(link.bettingHouse, link.cpa.toNumber());
      }
      memberL1.set(l1.id, anchor);
    }

    // BFS L2..NETWORK_LEVEL_CAP — fraud view mirrors the balance network depth.
    let frontierIds = level1.map((m) => m.id);
    for (
      let lvl = 2;
      lvl <= NETWORK_LEVEL_CAP && frontierIds.length > 0;
      lvl++
    ) {
      const nextLevel = await this.prisma.user.findMany({
        where: { referredById: { in: frontierIds } },
        select: { id: true, referredById: true },
      });
      const nextIds: string[] = [];
      for (const m of nextLevel) {
        if (memberL1.has(m.id)) continue; // guard against cycles / re-entry
        const anchor = memberL1.get(m.referredById!);
        if (!anchor) continue;
        memberL1.set(m.id, anchor);
        nextIds.push(m.id);
      }
      frontierIds = nextIds;
    }

    const allIds = Array.from(memberL1.keys());
    if (allIds.length === 0) return [];

    const members = await this.prisma.user.findMany({
      where: { id: { in: allIds } },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        fraudCounts: { select: { bettingHouse: true, count: true } },
      },
    });

    return members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      status: memberL1.get(m.id)!.status,
      fraudCounts: m.fraudCounts,
      l1CpaByHouse: memberL1.get(m.id)!.cpaByHouse,
    }));
  }
}
