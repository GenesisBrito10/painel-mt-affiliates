import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/index.js';
import {
  NETWORK_REPOSITORY,
  type INetworkRepository,
} from '../domain/ports/network.repository.js';
import type {
  EnrichedNetworkMember,
  FraudReportMember,
  FraudReportResult,
  NetworkMemberStats,
  NetworkTreeResult,
  ReferralEntry,
} from '../domain/types/network.types.js';
import type {
  NetworkTreeQueryDto,
  ReferralsQueryDto,
} from './dto/network.dto.js';

// Max referral-tree depth shown in the affiliate "Rede" tab. Mirrors the
// spread model cap (NETWORK_LEVEL_CAP=10 in dashboard-balance.service).
const NETWORK_TREE_DEPTH = 10;

// ─── Internal BFS raw member shape ──────────────────────────────────────────

interface RawMember {
  id: string;
  name: string;
  email: string;
  status: string;
  referralCode: string | null;
  referredById: string | null;
  createdAt: Date;
  affiliateLinks: Array<{
    campaignId: string;
    bettingHouse: string;
    cpa: { toNumber(): number } | null;
    revshare: { toNumber(): number } | null;
  }>;
  fraudCounts: Array<{ bettingHouse: string; count: number }>;
}

@Injectable()
export class NetworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(NETWORK_REPOSITORY)
    private readonly repo: INetworkRepository,
  ) {}

  // ─── Tree ──────────────────────────────────────────────────────────────────

  async getTree(
    userId: string,
    query: NetworkTreeQueryDto,
  ): Promise<NetworkTreeResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    let dateRange: { startDate: Date; endDate: Date } | undefined;
    if (query.startDate || query.endDate) {
      const now = new Date();
      const start = query.startDate
        ? new Date(`${query.startDate}T00:00:00.000Z`)
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const end = query.endDate
        ? new Date(`${query.endDate}T23:59:59.999Z`)
        : now;
      dateRange = { startDate: start, endDate: end };
    }

    // Load root user + their links (for spread calculation)
    const rootUser = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        referralCode: true,
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

    // Audit exclusion: skip April 2026 when setting is active
    const auditExclusion = await this.resolveAuditExclusion();

    // ── BFS 3-level ──────────────────────────────────────────────────────────
    const levelMap = new Map<string, number>(); // userId → depth (1..10)
    const parentMap = new Map<string, string>(); // userId → parentUserId
    const nameMap = new Map<string, string>(); // userId → name
    const allMembers: RawMember[] = [];

    nameMap.set(userId, ''); // root placeholder; overwritten below if needed

    let currentIds: string[] = [userId];

    for (let depth = 1; depth <= NETWORK_TREE_DEPTH; depth++) {
      if (currentIds.length === 0) break;

      const members = (await this.prisma.user.findMany({
        where: { referredById: { in: currentIds }, isExternal: false },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          referralCode: true,
          referredById: true,
          createdAt: true,
          affiliateLinks: {
            where: { deletedAt: null },
            select: {
              campaignId: true,
              bettingHouse: true,
              cpa: true,
              revshare: true,
            },
          },
          fraudCounts: { select: { bettingHouse: true, count: true } },
        },
      })) as RawMember[];

      if (members.length === 0) break;

      for (const m of members) {
        levelMap.set(m.id, depth);
        parentMap.set(m.id, m.referredById!);
        nameMap.set(m.id, m.name);
        allMembers.push(m);
      }

      currentIds = members.map((m) => m.id);
    }

    if (allMembers.length === 0) {
      return this.emptyTreeResult(rootUser.referralCode, page, limit);
    }

    // ── Batch operations ─────────────────────────────────────────────────────
    const allMemberIds = allMembers.map((m) => m.id);

    // All campaignIds in the network (for batch stats query)
    const allCampaignIds = allMembers.flatMap((m) =>
      m.affiliateLinks.map((l) => l.campaignId),
    );

    const [statsMap, subReferralMap] = await Promise.all([
      allCampaignIds.length > 0
        ? this.repo.aggregateStatsByCampaignId(
            allCampaignIds,
            auditExclusion,
            dateRange,
          )
        : Promise.resolve(new Map<string, NetworkMemberStats>()),
      this.repo.countSubReferrals(allMemberIds),
    ]);

    // ── Build parent name map from nameMap ───────────────────────────────────
    const rootName = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { name: true } })
      .then((u) => u?.name ?? '');
    nameMap.set(userId, rootName);

    // ── Assemble members ─────────────────────────────────────────────────────
    let networkEarnings = 0;
    let networkFraudLoss = 0;
    const network: EnrichedNetworkMember[] = [];

    const myLinks = rootUser.affiliateLinks;

    for (const member of allMembers) {
      // Optional house filter
      const memberLinks = query.house
        ? member.affiliateLinks.filter((l) => l.bettingHouse === query.house)
        : member.affiliateLinks;

      if (
        query.house &&
        memberLinks.length === 0 &&
        member.affiliateLinks.length > 0
      ) {
        continue; // member exists but has no link for the requested house
      }

      // Optional search filter (name or email, case-insensitive)
      if (query.search) {
        const q = query.search.toLowerCase();
        if (
          !member.name.toLowerCase().includes(q) &&
          !member.email.toLowerCase().includes(q)
        ) {
          continue;
        }
      }

      // Optional status filter
      if (query.status && member.status !== query.status) {
        continue;
      }

      // Optional maxLevel filter — esconde nível > maxLevel (ex.: aba "Árvore da
      // rede" pede maxLevel=1, só convidados diretos, que é o que o head aprova).
      // Filtra ANTES de stats/earnings/total → summary e paginação consistentes.
      if (query.maxLevel && (levelMap.get(member.id) ?? 1) > query.maxLevel) {
        continue;
      }

      // Merge stats from all campaigns of this member
      const stats = this.mergeStats(memberLinks, statsMap);

      // ── Spread model ──────────────────────────────────────────────────────
      const memberLevel = levelMap.get(member.id) ?? 1;
      const l1AncestorId = this.resolveL1Ancestor(
        member.id,
        memberLevel,
        parentMap,
      );
      const l1Member = allMembers.find((m) => m.id === l1AncestorId);
      const l1Links = l1Member?.affiliateLinks ?? [];

      let marginCpa = 0;
      let marginRev = 0;

      for (const ml of member.affiliateLinks) {
        const myLink = myLinks.find((l) => l.bettingHouse === ml.bettingHouse);
        const myCpa = myLink?.cpa?.toNumber() ?? 0;
        const myRevshare = myLink?.revshare?.toNumber() ?? 0;
        const l1Link = l1Links.find((l) => l.bettingHouse === ml.bettingHouse);
        const l1Cpa = l1Link?.cpa?.toNumber() ?? 0;
        const l1Rev = l1Link?.revshare?.toNumber() ?? 0;

        const mCpa = Math.max(0, myCpa - l1Cpa);
        const mRev = Math.max(0, myRevshare - l1Rev);

        if (mCpa > 0 || mRev > 0) {
          marginCpa = mCpa;
          marginRev = mRev;
          break;
        }
      }

      const myEarnings =
        marginCpa * stats.cpaQualified +
        Math.max(0, (marginRev / 100) * stats.revShare);
      networkEarnings += myEarnings;

      // ── Fraud deduction ───────────────────────────────────────────────────
      let fraudCount = 0;
      let fraudDeduction = 0;

      for (const fraud of member.fraudCounts) {
        if (fraud.count <= 0) continue;
        const myFraudLink = myLinks.find(
          (l) => l.bettingHouse === fraud.bettingHouse,
        );
        const myFraudCpa = myFraudLink?.cpa?.toNumber() ?? 0;
        const l1FraudLink = l1Links.find(
          (l) => l.bettingHouse === fraud.bettingHouse,
        );
        const l1FraudCpa = l1FraudLink?.cpa?.toNumber() ?? 0;
        const fraudMargin = Math.max(0, myFraudCpa - l1FraudCpa);
        if (fraudMargin <= 0) continue;
        fraudCount += fraud.count;
        fraudDeduction += fraudMargin * fraud.count;
      }
      networkFraudLoss += fraudDeduction;

      // ── Parent name ───────────────────────────────────────────────────────
      const parentId = parentMap.get(member.id);
      const parentName = parentId ? (nameMap.get(parentId) ?? '') : rootName;

      network.push({
        userId: member.id,
        name: member.name,
        email: member.email,
        status: member.status,
        referralCode: member.referralCode,
        joinedAt: member.createdAt,
        houses: memberLinks.map((l) => l.bettingHouse).filter(Boolean),
        cpa: member.affiliateLinks[0]?.cpa?.toNumber() ?? 0,
        revshare: member.affiliateLinks[0]?.revshare?.toNumber() ?? 0,
        level: memberLevel,
        parentName,
        subReferrals: subReferralMap.get(member.id) ?? 0,
        stats,
        myEarnings,
        fraudCount,
        fraudDeduction,
      });
    }

    // ── Totals ────────────────────────────────────────────────────────────────
    const totals = network.reduce<NetworkMemberStats>(
      (acc, m) => ({
        registrations: acc.registrations + m.stats.registrations,
        ftds: acc.ftds + m.stats.ftds,
        deposit: acc.deposit + m.stats.deposit,
        totalCommission: acc.totalCommission + m.stats.totalCommission,
        revShare: acc.revShare + m.stats.revShare,
        cpaQualified: acc.cpaQualified + m.stats.cpaQualified,
      }),
      {
        registrations: 0,
        ftds: 0,
        deposit: 0,
        totalCommission: 0,
        revShare: 0,
        cpaQualified: 0,
      },
    );

    // ── Server-side pagination ────────────────────────────────────────────────
    const total = network.length;

    // Status summary computed BEFORE pagination — reflects totals across all pages
    const statusSummary = {
      total,
      pending: network.filter((m) => m.status === 'PENDING').length,
      approved: network.filter((m) => m.status === 'APPROVED').length,
      rejected: network.filter((m) => m.status === 'REJECTED').length,
    };

    const paginated = network.slice((page - 1) * limit, page * limit);

    return {
      referralCode: rootUser.referralCode,
      totalReferrals: total,
      networkEarnings,
      networkFraudLoss,
      netNetworkEarnings: networkEarnings - networkFraudLoss,
      totals,
      statusSummary,
      network: paginated,
      total,
      page,
      limit,
    };
  }

  // ─── Fraud Report ──────────────────────────────────────────────────────────

  async getFraudReport(userId: string): Promise<FraudReportResult> {
    // BFS to NETWORK_TREE_DEPTH — collect member IDs only
    const allMemberIds: string[] = [];
    let currentIds: string[] = [userId];

    for (let depth = 0; depth < NETWORK_TREE_DEPTH; depth++) {
      if (currentIds.length === 0) break;
      const members = await this.prisma.user.findMany({
        where: { referredById: { in: currentIds }, isExternal: false },
        select: { id: true },
      });
      if (members.length === 0) break;
      const nextIds = members.map((m) => m.id);
      allMemberIds.push(...nextIds);
      currentIds = nextIds;
    }

    if (allMemberIds.length === 0) {
      return { total: 0, totalFraudCpa: 0, members: [] };
    }

    const logs = await this.repo.findFraudLogs(allMemberIds);

    if (logs.length === 0) {
      return { total: 0, totalFraudCpa: 0, members: [] };
    }

    // Fetch user names for the member IDs referenced in logs
    const logUserIds = [...new Set(logs.map((l) => l.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: logUserIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Group logs by userId
    const memberMap = new Map<string, FraudReportMember>();

    for (const log of logs) {
      const userInfo = userMap.get(log.userId);
      if (!memberMap.has(log.userId)) {
        memberMap.set(log.userId, {
          userId: log.userId,
          name: userInfo?.name ?? 'N/A',
          email: userInfo?.email ?? '',
          totalFraudCpa: 0,
          logs: [],
        });
      }
      const entry = memberMap.get(log.userId)!;
      const fraudCount = log.newCount - log.oldCount;
      entry.totalFraudCpa += fraudCount;
      entry.logs.push({
        id: log.id,
        bettingHouse: log.bettingHouse,
        oldCount: log.oldCount,
        newCount: log.newCount,
        fraudCount,
        reason: log.reason,
        registeredBy:
          log.changedByName && log.changedByEmail
            ? { name: log.changedByName, email: log.changedByEmail }
            : null,
        createdAt: log.createdAt,
      });
    }

    const members = Array.from(memberMap.values()).sort(
      (a, b) => b.totalFraudCpa - a.totalFraudCpa,
    );
    const totalFraudCpa = members.reduce((sum, m) => sum + m.totalFraudCpa, 0);

    return { total: members.length, totalFraudCpa, members };
  }

  // ─── Referrals (direct) ───────────────────────────────────────────────────

  async getReferrals(
    userId: string,
    query: ReferralsQueryDto,
  ): Promise<ReferralEntry[]> {
    return this.repo.findReferrals(userId, query.house, query.maxLevel);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async resolveAuditExclusion(): Promise<
    { startDate: Date; endDate: Date } | undefined
  > {
    const settings = await this.settings.getMany([
      'withdrawal_block_active',
      'withdrawal_block_start_date',
      'withdrawal_block_end_date',
    ]);
    if (settings.get('withdrawal_block_active') !== 'true') return undefined;
    const start = settings.get('withdrawal_block_start_date');
    const end = settings.get('withdrawal_block_end_date');
    if (!start || !end) return undefined;
    return { startDate: new Date(start), endDate: new Date(end) };
  }

  private resolveL1Ancestor(
    memberId: string,
    memberLevel: number,
    parentMap: Map<string, string>,
  ): string {
    if (memberLevel === 1) return memberId;
    let currentId = memberId;
    for (let i = memberLevel; i > 1; i--) {
      const pid = parentMap.get(currentId);
      if (pid) currentId = pid;
    }
    return currentId;
  }

  private mergeStats(
    links: Array<{ campaignId: string }>,
    statsMap: Map<string, NetworkMemberStats>,
  ): NetworkMemberStats {
    const stats: NetworkMemberStats = {
      registrations: 0,
      ftds: 0,
      deposit: 0,
      totalCommission: 0,
      revShare: 0,
      cpaQualified: 0,
    };
    for (const link of links) {
      const s = statsMap.get(link.campaignId);
      if (!s) continue;
      stats.registrations += s.registrations;
      stats.ftds += s.ftds;
      stats.deposit += s.deposit;
      stats.totalCommission += s.totalCommission;
      stats.revShare += s.revShare;
      stats.cpaQualified += s.cpaQualified;
    }
    return stats;
  }

  private emptyTreeResult(
    referralCode: string | null,
    page: number,
    limit: number,
  ): NetworkTreeResult {
    return {
      referralCode,
      totalReferrals: 0,
      networkEarnings: 0,
      networkFraudLoss: 0,
      netNetworkEarnings: 0,
      totals: {
        registrations: 0,
        ftds: 0,
        deposit: 0,
        totalCommission: 0,
        revShare: 0,
        cpaQualified: 0,
      },
      statusSummary: { total: 0, pending: 0, approved: 0, rejected: 0 },
      network: [],
      total: 0,
      page,
      limit,
    };
  }
}
