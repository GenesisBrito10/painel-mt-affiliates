import { Injectable, Logger } from '@nestjs/common';
import { Prisma, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationService } from '../../notification/index.js';
import { NETWORK_LEVEL_CAP } from '../../dashboard/application/dashboard-balance.service.js';

export interface EvaluateResult {
  ruleVersionId: string;
  usersEvaluated: number;
  awardsGenerated: number;
  errors: number;
  skippedLocked: boolean;
}

type CurrentVersion = {
  id: string;
  ruleId: string;
  bettingHouse: string | null;
  cpaPerPrize: number;
  countMode: 'INDIVIDUAL' | 'NETWORK';
  prizeType: 'BALANCE' | 'PHYSICAL' | 'OTHER';
  prizeValue: Prisma.Decimal;
  prizeLabel: string;
  startDate: Date;
  endDate: Date | null;
  effectiveFromDate: Date;
};

@Injectable()
export class CpaPrizeEngineService {
  private readonly logger = new Logger(CpaPrizeEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // ─── Public entry points ────────────────────────────────────────────────

  /** Evaluate the current version of every active, non-archived rule. */
  async evaluateAllActiveRules(adminId?: string): Promise<EvaluateResult[]> {
    const rules = await this.prisma.cpaPrizeRule.findMany({
      where: { active: true, archived: false, currentVersionId: { not: null } },
      select: { id: true, currentVersionId: true },
    });

    const results: EvaluateResult[] = [];
    for (const rule of rules) {
      if (!rule.currentVersionId) continue;
      try {
        results.push(
          await this.evaluateRuleVersion(rule.currentVersionId, adminId),
        );
      } catch (err) {
        this.logger.error(
          `evaluateRuleVersion failed for ${rule.currentVersionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        results.push({
          ruleVersionId: rule.currentVersionId,
          usersEvaluated: 0,
          awardsGenerated: 0,
          errors: 1,
          skippedLocked: false,
        });
      }
    }
    return results;
  }

  /**
   * Evaluate one rule version. Idempotent: only generates awards for the
   * positive delta between earned (floor(total/meta)) and already generated.
   * Guarded by a Postgres advisory lock so cron and manual recalc never run
   * the same version concurrently.
   */
  async evaluateRuleVersion(
    ruleVersionId: string,
    _adminId?: string,
  ): Promise<EvaluateResult> {
    const locked = await this.tryLock(ruleVersionId);
    if (!locked) {
      this.logger.warn(
        `Evaluation already running for version ${ruleVersionId} — skipped`,
      );
      return {
        ruleVersionId,
        usersEvaluated: 0,
        awardsGenerated: 0,
        errors: 0,
        skippedLocked: true,
      };
    }

    try {
      const version = await this.prisma.cpaPrizeRuleVersion.findUnique({
        where: { id: ruleVersionId },
      });
      if (!version || version.supersededAt) {
        return {
          ruleVersionId,
          usersEvaluated: 0,
          awardsGenerated: 0,
          errors: 0,
          skippedLocked: false,
        };
      }

      const v: CurrentVersion = {
        id: version.id,
        ruleId: version.ruleId,
        bettingHouse: version.bettingHouse,
        cpaPerPrize: version.cpaPerPrize,
        countMode: version.countMode,
        prizeType: version.prizeType,
        prizeValue: version.prizeValue,
        prizeLabel: version.prizeLabel,
        startDate: version.startDate,
        endDate: version.endDate,
        effectiveFromDate: version.effectiveFromDate,
      };

      const totals =
        v.countMode === 'NETWORK'
          ? await this.computeNetworkTotals(v)
          : await this.computeIndividualTotals(v);

      let awardsGenerated = 0;
      let errors = 0;
      for (const [userId, total] of totals) {
        try {
          awardsGenerated += await this.generateForUser(v, userId, total);
        } catch (err) {
          errors++;
          this.logger.error(
            `generateForUser failed (version=${ruleVersionId} user=${userId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return {
        ruleVersionId,
        usersEvaluated: totals.size,
        awardsGenerated,
        errors,
        skippedLocked: false,
      };
    } finally {
      await this.unlock(ruleVersionId);
    }
  }

  // ─── Totals computation ──────────────────────────────────────────────────

  /** Counting window: [max(startDate, effectiveFromDate) , endDate ?? now]. */
  private window(v: CurrentVersion): { start: Date; end: Date } {
    const start =
      v.effectiveFromDate.getTime() > v.startDate.getTime()
        ? v.effectiveFromDate
        : v.startDate;
    const end = v.endDate ?? new Date();
    return { start, end };
  }

  /** INDIVIDUAL: sum of cpaQualified across the user's own campaigns. */
  private async computeIndividualTotals(
    v: CurrentVersion,
  ): Promise<Map<string, number>> {
    const { start, end } = this.window(v);

    const links = await this.prisma.affiliateLink.findMany({
      where: {
        deletedAt: null,
        ...(v.bettingHouse ? { bettingHouse: v.bettingHouse } : {}),
        campaignId: { not: '' },
      },
      select: { userId: true, campaignId: true },
    });
    if (links.length === 0) return new Map();

    const campaignToUser = new Map<string, string>();
    for (const l of links) campaignToUser.set(l.campaignId, l.userId);

    const cpaByCampaign = await this.cpaByCampaign(
      [...campaignToUser.keys()],
      start,
      end,
      v.bettingHouse,
    );

    const totals = new Map<string, number>();
    for (const [campaignId, cpa] of cpaByCampaign) {
      const userId = campaignToUser.get(campaignId);
      if (!userId) continue;
      totals.set(userId, (totals.get(userId) ?? 0) + cpa);
    }
    return totals;
  }

  /**
   * NETWORK: for every head (user with ≥1 referral), sum cpaQualified of its
   * downline (BFS to NETWORK_LEVEL_CAP), EXCLUDING the head's own CPA.
   */
  private async computeNetworkTotals(
    v: CurrentVersion,
  ): Promise<Map<string, number>> {
    const { start, end } = this.window(v);

    // Own CPA per user (same as individual, but keyed by user).
    const links = await this.prisma.affiliateLink.findMany({
      where: {
        deletedAt: null,
        ...(v.bettingHouse ? { bettingHouse: v.bettingHouse } : {}),
        campaignId: { not: '' },
      },
      select: { userId: true, campaignId: true },
    });
    const campaignToUser = new Map<string, string>();
    for (const l of links) campaignToUser.set(l.campaignId, l.userId);

    const cpaByCampaign = await this.cpaByCampaign(
      [...campaignToUser.keys()],
      start,
      end,
      v.bettingHouse,
    );
    const ownCpa = new Map<string, number>();
    for (const [campaignId, cpa] of cpaByCampaign) {
      const userId = campaignToUser.get(campaignId);
      if (!userId) continue;
      ownCpa.set(userId, (ownCpa.get(userId) ?? 0) + cpa);
    }

    // Referral adjacency (parent → children).
    const allUsers = await this.prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, referredById: true },
    });
    const children = new Map<string, string[]>();
    for (const u of allUsers) {
      if (!u.referredById) continue;
      const arr = children.get(u.referredById) ?? [];
      arr.push(u.id);
      children.set(u.referredById, arr);
    }

    // For each head, BFS downline (cap) and sum descendants' own CPA.
    const totals = new Map<string, number>();
    for (const headId of children.keys()) {
      let sum = 0;
      const visited = new Set<string>([headId]);
      let frontier = children.get(headId) ?? [];
      for (
        let depth = 1;
        depth <= NETWORK_LEVEL_CAP && frontier.length > 0;
        depth++
      ) {
        const next: string[] = [];
        for (const id of frontier) {
          if (visited.has(id)) continue;
          visited.add(id);
          sum += ownCpa.get(id) ?? 0;
          const kids = children.get(id);
          if (kids) next.push(...kids);
        }
        frontier = next;
      }
      if (sum > 0) totals.set(headId, sum);
    }
    return totals;
  }

  /** groupBy AffiliateData → cpaQualified sum per campaignId within window/house. */
  private async cpaByCampaign(
    campaignIds: string[],
    start: Date,
    end: Date,
    house: string | null,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (campaignIds.length === 0) return result;

    const rows = await this.prisma.affiliateData.groupBy({
      by: ['campaignId'],
      where: {
        campaignId: { in: campaignIds },
        date: { gte: start, lte: end },
        ...(house ? { bettingHouse: house } : {}),
      },
      _sum: { cpaQualified: true },
    });
    for (const r of rows) result.set(r.campaignId, r._sum.cpaQualified ?? 0);
    return result;
  }

  // ─── Award generation (per user, transactional, idempotent) ──────────────

  private async generateForUser(
    v: CurrentVersion,
    userId: string,
    total: number,
  ): Promise<number> {
    const earned = Math.floor(total / v.cpaPerPrize);

    const progress = await this.prisma.cpaPrizeProgress.findUnique({
      where: { ruleVersionId_userId: { ruleVersionId: v.id, userId } },
    });
    const already = progress?.awardsGenerated ?? 0;
    const delta = earned - already;

    // Always refresh progress totals (for derived display), but only generate
    // awards when delta > 0. delta <= 0 never removes awards.
    if (delta <= 0) {
      await this.prisma.cpaPrizeProgress.upsert({
        where: { ruleVersionId_userId: { ruleVersionId: v.id, userId } },
        create: {
          ruleVersionId: v.id,
          ruleId: v.ruleId,
          userId,
          totalCpaCounted: total,
          awardsGenerated: already,
          lastEvaluatedAt: new Date(),
        },
        update: { totalCpaCounted: total, lastEvaluatedAt: new Date() },
      });
      return 0;
    }

    const userName = await this.resolveUserName(userId);
    const prizeValueNum = v.prizeValue.toNumber();

    try {
      await this.prisma.$transaction(async (tx) => {
        const awardsData = Array.from({ length: delta }, (_, i) => ({
          ruleId: v.ruleId,
          ruleVersionId: v.id,
          userId,
          userName,
          bettingHouse: v.bettingHouse,
          countMode: v.countMode,
          cpaThreshold: v.cpaPerPrize,
          cycleIndex: already + i + 1,
          prizeType: v.prizeType,
          prizeValue: v.prizeValue,
          prizeLabel: v.prizeLabel,
          status: 'AVAILABLE' as const,
        }));

        await tx.cpaPrizeAward.createMany({ data: awardsData });

        await tx.cpaPrizeProgress.upsert({
          where: { ruleVersionId_userId: { ruleVersionId: v.id, userId } },
          create: {
            ruleVersionId: v.id,
            ruleId: v.ruleId,
            userId,
            totalCpaCounted: total,
            awardsGenerated: earned,
            lastEvaluatedAt: new Date(),
          },
          update: {
            totalCpaCounted: total,
            awardsGenerated: earned,
            lastEvaluatedAt: new Date(),
          },
        });

        await tx.cpaPrizeLog.create({
          data: {
            ruleId: v.ruleId,
            ruleVersionId: v.id,
            userId,
            event: 'PRIZE_GENERATED',
            bettingHouse: v.bettingHouse,
            cpaBefore: already * v.cpaPerPrize,
            cpaAdded: total - already * v.cpaPerPrize,
            cpaAfter: total,
            prizesGenerated: delta,
            totalValueGenerated: new Prisma.Decimal(prizeValueNum * delta),
            note: this.generationNote(total, v.cpaPerPrize, delta),
          },
        });
      });
    } catch (err) {
      // Idempotency defense: concurrent reprocessing hit the unique constraint.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.warn(
          `Unique violation generating awards (version=${v.id} user=${userId}) — treated as reprocessing, no duplicate created`,
        );
        return 0;
      }
      throw err;
    }

    // Notify (fire-and-forget, outside tx).
    this.notificationService
      .create({
        userId,
        type: NotificationType.GENERAL,
        title: '🎯 Você ganhou uma premiação por CPA!',
        message: this.generationNote(total, v.cpaPerPrize, delta),
        metadata: {
          ruleId: v.ruleId,
          ruleVersionId: v.id,
          prizesGenerated: delta,
        },
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `Prize notification failed for ${userId}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );

    return delta;
  }

  private generationNote(total: number, meta: number, delta: number): string {
    const earned = Math.floor(total / meta);
    const remainder = total - earned * meta;
    return `Você acumulou ${total} CPAs. Como a meta é ${meta} CPAs por prêmio, foram geradas ${delta} premiações. Saldo restante: ${remainder} CPAs.`;
  }

  private async resolveUserName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return u?.name ?? 'Afiliado';
  }

  // ─── Advisory lock ───────────────────────────────────────────────────────

  private async tryLock(ruleVersionId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${ruleVersionId})::bigint) AS locked
    `;
    return rows[0]?.locked === true;
  }

  private async unlock(ruleVersionId: string): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        SELECT pg_advisory_unlock(hashtext(${ruleVersionId})::bigint)
      `;
    } catch (err) {
      this.logger.warn(
        `advisory unlock failed for ${ruleVersionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
