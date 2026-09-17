import { Injectable } from '@nestjs/common';
import {
  DashboardBalanceService,
  NETWORK_LEVEL_CAP,
} from './dashboard-balance.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import type {
  NetworkBreakdownDto,
  NetworkMemberEarningDto,
  NetworkMemberHouseBreakdownDto,
} from './dto/earnings.dto.js';

const emptyNetworkBreakdown = (): NetworkBreakdownDto => ({
  totalNetworkEarnings: 0,
  grossNetworkEarnings: 0,
  totalCpaEarnings: 0,
  totalRevshareEarnings: 0,
  totalFraudDeduction: 0,
  totalMembers: 0,
  totals: {
    clicks: 0,
    registrations: 0,
    ftds: 0,
    cpaQualified: 0,
    deposit: 0,
    revShareGenerated: 0,
    totalCommissionGenerated: 0,
    fraudCount: 0,
    subReferrals: 0,
  },
  statusSummary: { approved: 0, pending: 0, rejected: 0, blocked: 0 },
  levelSummary: Object.fromEntries(
    Array.from({ length: NETWORK_LEVEL_CAP }, (_, i) => [
      i + 1,
      { members: 0, earnings: 0, registrations: 0, cpaQualified: 0 },
    ]),
  ),
  members: [],
});

const roundMoney = (value: number) => parseFloat(value.toFixed(2));
const campaignHouseKey = (campaignId: string, bettingHouse: string) =>
  `${campaignId}__${bettingHouse}`;

@Injectable()
export class EarningsNetworkService {
  constructor(
    private readonly balanceService: DashboardBalanceService,
    private readonly prisma: PrismaService,
  ) {}

  async getNetworkBreakdown(
    user: JwtPayload,
    query: { startDate?: string; endDate?: string; bettingHouse?: string },
  ): Promise<NetworkBreakdownDto> {
    const networkMembers = await this.balanceService.loadNetworkMembers(
      user.sub,
    );
    if (networkMembers.length === 0) return emptyNetworkBreakdown();

    const startDate = query.startDate
      ? new Date(`${query.startDate}T00:00:00.000Z`)
      : new Date('2020-01-01T00:00:00.000Z');
    const endDate = query.endDate
      ? new Date(`${query.endDate}T23:59:59.999Z`)
      : new Date();

    const memberIds = networkMembers.map((member) => member.id);
    const dbUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.sub },
      select: {
        affiliateLinks: {
          where: { deletedAt: null },
          select: { bettingHouse: true, cpa: true, revshare: true },
        },
      },
    });

    const [usersData, subReferralRows] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: memberIds } },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          createdAt: true,
          referredById: true,
        },
      }),
      this.prisma.user.groupBy({
        by: ['referredById'],
        where: { referredById: { in: memberIds } },
        _count: { id: true },
      }),
    ]);

    const usersMap = new Map(
      usersData.map((userData) => [userData.id, userData]),
    );
    const parentIds = [
      ...new Set(
        usersData.map((userData) => userData.referredById).filter(Boolean),
      ),
    ] as string[];
    const parentData = parentIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: parentIds } },
          select: { id: true, name: true },
        })
      : [];
    const parentNameMap = new Map(
      parentData.map((parent) => [parent.id, parent.name]),
    );
    const subReferralMap = new Map(
      subReferralRows.map((row) => [row.referredById, row._count.id]),
    );

    const memberByCampaignHouse = new Map<string, string>();
    const visibleLinksByMember = new Map<
      string,
      (typeof networkMembers)[number]['links']
    >();
    const allCampaignIds = new Set<string>();

    for (const member of networkMembers) {
      const visibleLinks = query.bettingHouse
        ? member.links.filter(
            (link) => link.bettingHouse === query.bettingHouse,
          )
        : member.links;

      visibleLinksByMember.set(member.id, visibleLinks);
      for (const link of visibleLinks) {
        allCampaignIds.add(link.campaignId);
        memberByCampaignHouse.set(
          campaignHouseKey(link.campaignId, link.bettingHouse),
          member.id,
        );
      }
    }

    const performanceRows = allCampaignIds.size
      ? await this.prisma.affiliateData.groupBy({
          by: ['campaignId', 'bettingHouse'],
          where: {
            campaignId: { in: Array.from(allCampaignIds) },
            date: { gte: startDate, lte: endDate },
            ...(query.bettingHouse ? { bettingHouse: query.bettingHouse } : {}),
          },
          _sum: {
            clicks: true,
            cpaQualified: true,
            revShare: true,
            ftds: true,
            registrations: true,
            deposit: true,
            totalCommission: true,
          },
        })
      : [];

    const memberRows = new Map<string, NetworkMemberEarningDto>();
    const houseRows = new Map<
      string,
      Map<string, NetworkMemberHouseBreakdownDto>
    >();

    const ensureMember = (
      member: (typeof networkMembers)[number],
    ): NetworkMemberEarningDto | null => {
      const existing = memberRows.get(member.id);
      if (existing) return existing;

      const userData = usersMap.get(member.id);
      if (!userData) return null;

      const visibleLinks = visibleLinksByMember.get(member.id) ?? [];
      const firstVisibleLink = visibleLinks[0];
      const parentName = userData.referredById
        ? (parentNameMap.get(userData.referredById) ?? null)
        : null;

      const row: NetworkMemberEarningDto = {
        memberId: member.id,
        memberName: userData.name,
        memberEmail: userData.email,
        level: member.level ?? 1,
        parentName,
        joinedAt: userData.createdAt.toISOString(),
        cpaEarnings: 0,
        revshareEarnings: 0,
        grossEarnings: 0,
        totalEarnings: 0,
        fraudDeduction: 0,
        fraudCount: 0,
        clicks: 0,
        ftds: 0,
        cpaQualified: 0,
        registrations: 0,
        deposit: 0,
        revShareGenerated: 0,
        totalCommissionGenerated: 0,
        cpaRate: firstVisibleLink?.cpa?.toNumber() ?? 0,
        revshareRate: firstVisibleLink?.revshare?.toNumber() ?? 0,
        subReferrals: subReferralMap.get(member.id) ?? 0,
        houses: Array.from(
          new Set(visibleLinks.map((link) => link.bettingHouse)),
        ),
        houseBreakdown: [],
        status: userData.status as
          | 'APPROVED'
          | 'PENDING'
          | 'REJECTED'
          | 'BLOCKED',
      };

      memberRows.set(member.id, row);
      houseRows.set(member.id, new Map());
      return row;
    };

    const ensureHouse = (
      member: (typeof networkMembers)[number],
      house: string,
    ): NetworkMemberHouseBreakdownDto => {
      const byHouse =
        houseRows.get(member.id) ??
        new Map<string, NetworkMemberHouseBreakdownDto>();
      houseRows.set(member.id, byHouse);

      const existing = byHouse.get(house);
      if (existing) return existing;

      const memberLink = member.links.find(
        (link) => link.bettingHouse === house,
      );
      const rootLink = dbUser.affiliateLinks.find(
        (link) => link.bettingHouse === house,
      );
      const uplineCpaRate = member.l1CpaByHouse.get(house) ?? 0;
      const uplineRevshareRate = member.l1RevByHouse.get(house) ?? 0;

      const row: NetworkMemberHouseBreakdownDto = {
        house,
        cpaRate: memberLink?.cpa?.toNumber() ?? 0,
        revshareRate: memberLink?.revshare?.toNumber() ?? 0,
        uplineCpaRate,
        uplineRevshareRate,
        cpaMargin: Math.max(
          0,
          (rootLink?.cpa?.toNumber() ?? 0) - uplineCpaRate,
        ),
        revshareMargin: Math.max(
          0,
          (rootLink?.revshare?.toNumber() ?? 0) - uplineRevshareRate,
        ),
        clicks: 0,
        registrations: 0,
        ftds: 0,
        cpaQualified: 0,
        deposit: 0,
        revShareGenerated: 0,
        totalCommissionGenerated: 0,
        cpaEarnings: 0,
        revshareEarnings: 0,
        grossEarnings: 0,
        fraudCount: 0,
        fraudDeduction: 0,
        netEarnings: 0,
      };

      byHouse.set(house, row);
      return row;
    };

    const membersById = new Map(
      networkMembers.map((member) => [member.id, member]),
    );

    for (const perf of performanceRows) {
      const memberId = memberByCampaignHouse.get(
        campaignHouseKey(perf.campaignId, perf.bettingHouse),
      );
      if (!memberId) continue;

      const member = membersById.get(memberId);
      if (!member) continue;

      const memberRow = ensureMember(member);
      if (!memberRow) continue;

      const houseRow = ensureHouse(member, perf.bettingHouse);
      if (!memberRow.houses.includes(perf.bettingHouse))
        memberRow.houses.push(perf.bettingHouse);

      const clicks = perf._sum.clicks ?? 0;
      const registrations = perf._sum.registrations ?? 0;
      const ftds = perf._sum.ftds ?? 0;
      const cpaQualified = perf._sum.cpaQualified ?? 0;
      const deposit = perf._sum.deposit?.toNumber() ?? 0;
      const revShareGenerated = perf._sum.revShare?.toNumber() ?? 0;
      const totalCommissionGenerated =
        perf._sum.totalCommission?.toNumber() ?? 0;
      const cpaEarnings = houseRow.cpaMargin * cpaQualified;
      const revshareEarnings =
        (houseRow.revshareMargin / 100) * revShareGenerated;

      memberRow.clicks += clicks;
      memberRow.registrations += registrations;
      memberRow.ftds += ftds;
      memberRow.cpaQualified += cpaQualified;
      memberRow.deposit += deposit;
      memberRow.revShareGenerated += revShareGenerated;
      memberRow.totalCommissionGenerated += totalCommissionGenerated;
      memberRow.cpaEarnings += cpaEarnings;
      memberRow.revshareEarnings += revshareEarnings;

      houseRow.clicks += clicks;
      houseRow.registrations += registrations;
      houseRow.ftds += ftds;
      houseRow.cpaQualified += cpaQualified;
      houseRow.deposit += deposit;
      houseRow.revShareGenerated += revShareGenerated;
      houseRow.totalCommissionGenerated += totalCommissionGenerated;
      houseRow.cpaEarnings += cpaEarnings;
      houseRow.revshareEarnings += revshareEarnings;
    }

    for (const member of networkMembers) {
      const memberRow = ensureMember(member);
      if (!memberRow) continue;

      for (const fraud of member.fraudCounts) {
        if (!fraud.count || fraud.count <= 0) continue;
        if (query.bettingHouse && fraud.bettingHouse !== query.bettingHouse)
          continue;

        const rootLink = dbUser.affiliateLinks.find(
          (link) => link.bettingHouse === fraud.bettingHouse,
        );
        const marginCpa = Math.max(
          0,
          (rootLink?.cpa?.toNumber() ?? 0) -
            (member.l1CpaByHouse.get(fraud.bettingHouse) ?? 0),
        );
        if (marginCpa <= 0) continue;

        const deduction = marginCpa * fraud.count;
        const houseRow = ensureHouse(member, fraud.bettingHouse);
        if (!memberRow.houses.includes(fraud.bettingHouse))
          memberRow.houses.push(fraud.bettingHouse);

        memberRow.fraudCount += fraud.count;
        memberRow.fraudDeduction += deduction;
        houseRow.fraudCount += fraud.count;
        houseRow.fraudDeduction += deduction;
      }
    }

    const summary = emptyNetworkBreakdown();

    for (const memberRow of memberRows.values()) {
      memberRow.cpaEarnings = roundMoney(memberRow.cpaEarnings);
      memberRow.revshareEarnings = roundMoney(memberRow.revshareEarnings);
      memberRow.grossEarnings = roundMoney(
        memberRow.cpaEarnings + memberRow.revshareEarnings,
      );
      memberRow.fraudDeduction = roundMoney(memberRow.fraudDeduction);
      memberRow.totalEarnings = roundMoney(
        memberRow.grossEarnings - memberRow.fraudDeduction,
      );
      memberRow.deposit = roundMoney(memberRow.deposit);
      memberRow.revShareGenerated = roundMoney(memberRow.revShareGenerated);
      memberRow.totalCommissionGenerated = roundMoney(
        memberRow.totalCommissionGenerated,
      );

      const breakdown = houseRows.get(memberRow.memberId);
      memberRow.houseBreakdown = Array.from(breakdown?.values() ?? [])
        .map((row) => ({
          ...row,
          cpaEarnings: roundMoney(row.cpaEarnings),
          revshareEarnings: roundMoney(row.revshareEarnings),
          grossEarnings: roundMoney(row.cpaEarnings + row.revshareEarnings),
          fraudDeduction: roundMoney(row.fraudDeduction),
          netEarnings: roundMoney(
            row.cpaEarnings + row.revshareEarnings - row.fraudDeduction,
          ),
          deposit: roundMoney(row.deposit),
          revShareGenerated: roundMoney(row.revShareGenerated),
          totalCommissionGenerated: roundMoney(row.totalCommissionGenerated),
        }))
        .sort((a, b) => b.netEarnings - a.netEarnings);

      summary.totalNetworkEarnings += memberRow.totalEarnings;
      summary.grossNetworkEarnings += memberRow.grossEarnings;
      summary.totalCpaEarnings += memberRow.cpaEarnings;
      summary.totalRevshareEarnings += memberRow.revshareEarnings;
      summary.totalFraudDeduction += memberRow.fraudDeduction;
      summary.totals.clicks += memberRow.clicks;
      summary.totals.registrations += memberRow.registrations;
      summary.totals.ftds += memberRow.ftds;
      summary.totals.cpaQualified += memberRow.cpaQualified;
      summary.totals.deposit += memberRow.deposit;
      summary.totals.revShareGenerated += memberRow.revShareGenerated;
      summary.totals.totalCommissionGenerated +=
        memberRow.totalCommissionGenerated;
      summary.totals.fraudCount += memberRow.fraudCount;
      summary.totals.subReferrals += memberRow.subReferrals;
      summary.levelSummary[memberRow.level].members += 1;
      summary.levelSummary[memberRow.level].earnings += memberRow.totalEarnings;
      summary.levelSummary[memberRow.level].registrations +=
        memberRow.registrations;
      summary.levelSummary[memberRow.level].cpaQualified +=
        memberRow.cpaQualified;

      if (memberRow.status === 'APPROVED') summary.statusSummary.approved += 1;
      if (memberRow.status === 'PENDING') summary.statusSummary.pending += 1;
      if (memberRow.status === 'REJECTED') summary.statusSummary.rejected += 1;
      if (memberRow.status === 'BLOCKED') summary.statusSummary.blocked += 1;
    }

    summary.totalNetworkEarnings = roundMoney(summary.totalNetworkEarnings);
    summary.grossNetworkEarnings = roundMoney(summary.grossNetworkEarnings);
    summary.totalCpaEarnings = roundMoney(summary.totalCpaEarnings);
    summary.totalRevshareEarnings = roundMoney(summary.totalRevshareEarnings);
    summary.totalFraudDeduction = roundMoney(summary.totalFraudDeduction);
    summary.totalMembers = memberRows.size;
    summary.totals.deposit = roundMoney(summary.totals.deposit);
    summary.totals.revShareGenerated = roundMoney(
      summary.totals.revShareGenerated,
    );
    summary.totals.totalCommissionGenerated = roundMoney(
      summary.totals.totalCommissionGenerated,
    );

    for (const level of Object.keys(summary.levelSummary)) {
      const ls = summary.levelSummary[Number(level)];
      ls.earnings = roundMoney(ls.earnings);
    }

    return {
      ...summary,
      members: Array.from(memberRows.values()).sort(
        (a, b) => b.totalEarnings - a.totalEarnings,
      ),
    };
  }
}
