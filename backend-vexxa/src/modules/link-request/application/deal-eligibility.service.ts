import { Injectable } from '@nestjs/common';
import { LinkSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/index.js';
import {
  DEAL_ELIGIBILITY_METRICS_SLUG,
  DEAL_ELIGIBILITY_WINDOW_DAYS_SETTING,
  DEFAULT_DEAL_ELIGIBILITY_WINDOW_DAYS,
  DEFAULT_DEAL_MIN_AVG_DEPOSIT_PER_FTD,
  DEFAULT_DEAL_MIN_QUALIFIED_FTD,
  type DealEligibilityResult,
  type DealEligibilitySnapshot,
} from '../domain/types/link-request.types.js';

/**
 * Ported from legacy deal-request-eligibility.ts.
 *
 * Eligibility for the gated deal is evaluated against the affiliate's own
 * active Superbet campaigns. The caller decides which thresholds are enabled.
 *
 * Exceptions (caller is responsible for skipping this check):
 * - Affiliate already has an AffiliateLink for the deal's house
 * - The deal is not explicitly gated by isDealEligibilityRequired()
 */
@Injectable()
export class DealEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async check(
    userId: string,
    _dealBettingHouseSlug: string,
    minAvgDepositPerFtd?: number,
    minQualifiedFtd?: number,
  ): Promise<DealEligibilityResult> {
    const snapshot = await this.getSnapshot(userId);
    return this.evaluate(snapshot, minAvgDepositPerFtd, minQualifiedFtd);
  }

  async getSnapshot(userId: string): Promise<DealEligibilitySnapshot> {
    const windowDays = await this.getWindowDays();
    const { from, to } = this.eligibilityWindow(windowDays);
    const base = this.emptySnapshot(from, to, windowDays);

    const superbetLinks = await this.prisma.affiliateLink.findMany({
      where: {
        userId,
        bettingHouse: DEAL_ELIGIBILITY_METRICS_SLUG,
        deletedAt: null,
        source: { in: [LinkSource.POOL, LinkSource.MANUAL] },
      },
      select: { campaignId: true, affiliateId: true },
    });

    const campaignIds = [
      ...new Set(superbetLinks.map((link) => link.campaignId).filter(Boolean)),
    ];
    if (campaignIds.length === 0) {
      return {
        ...base,
        missingSuperbetLink: true,
      };
    }

    const agg = await this.prisma.affiliateData.aggregate({
      where: {
        bettingHouse: DEAL_ELIGIBILITY_METRICS_SLUG,
        date: { gte: from, lte: to },
        campaignId: { in: campaignIds },
      },
      _sum: { cpaQualified: true, deposit: true, ftds: true },
    });

    const sumQualifiedFtd = agg._sum.cpaQualified ?? 0;
    const sumDeposit = Number(agg._sum.deposit ?? 0);
    const sumFtds = agg._sum.ftds ?? 0;
    const avgDepositPerFtd = sumFtds > 0 ? sumDeposit / sumFtds : null;

    return {
      ...base,
      missingSuperbetLink: false,
      sumQualifiedFtd,
      sumCpaQualified: sumQualifiedFtd,
      sumDeposit,
      sumFtds,
      avgDepositPerFtd,
    };
  }

  evaluate(
    snapshot: DealEligibilitySnapshot,
    minAvgDepositPerFtd?: number,
    minQualifiedFtd?: number,
  ): DealEligibilityResult {
    const minAvg = this.normalizeMinAvg(minAvgDepositPerFtd);
    const minQftd = this.normalizeMinQualifiedFtd(minQualifiedFtd);
    const eligible =
      !snapshot.missingSuperbetLink &&
      (minQftd <= 0 || snapshot.sumQualifiedFtd >= minQftd) &&
      (minAvg <= 0 ||
        (snapshot.sumFtds > 0 &&
          snapshot.avgDepositPerFtd !== null &&
          snapshot.avgDepositPerFtd >= minAvg));

    const reasons = this.buildReasons(snapshot, minAvg, minQftd);

    return {
      required: true,
      metricsHouseSlug: snapshot.metricsHouseSlug,
      windowDays: snapshot.windowDays,
      minAvgDepositPerFtd: minAvg,
      minQualifiedFtd: minQftd,
      sumQualifiedFtd: snapshot.sumQualifiedFtd,
      sumCpaQualified: snapshot.sumCpaQualified,
      sumDeposit: snapshot.sumDeposit,
      sumFtds: snapshot.sumFtds,
      avgDepositPerFtd: snapshot.avgDepositPerFtd,
      from: snapshot.from,
      to: snapshot.to,
      eligible,
      reasons,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async getWindowDays(): Promise<number> {
    const settings = await this.settings.getMany([
      DEAL_ELIGIBILITY_WINDOW_DAYS_SETTING,
    ]);

    const rawWindowDays = Number(
      settings.get(DEAL_ELIGIBILITY_WINDOW_DAYS_SETTING),
    );

    return Number.isFinite(rawWindowDays) && rawWindowDays > 0
      ? Math.floor(rawWindowDays)
      : DEFAULT_DEAL_ELIGIBILITY_WINDOW_DAYS;
  }

  private normalizeMinAvg(value?: number): number {
    return Number.isFinite(value) && value !== undefined && value >= 0
      ? value
      : DEFAULT_DEAL_MIN_AVG_DEPOSIT_PER_FTD;
  }

  private normalizeMinQualifiedFtd(value?: number): number {
    return Number.isFinite(value) && value !== undefined && value >= 0
      ? Math.floor(value)
      : DEFAULT_DEAL_MIN_QUALIFIED_FTD;
  }

  private eligibilityWindow(windowDays: number): { from: Date; to: Date } {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const to = new Date(
      Date.UTC(
        value('year'),
        value('month') - 1,
        value('day'),
        23,
        59,
        59,
        999,
      ),
    );
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - (windowDays - 1));
    from.setUTCHours(0, 0, 0, 0);
    return { from, to };
  }

  private emptySnapshot(
    from: Date,
    to: Date,
    windowDays: number,
  ): DealEligibilitySnapshot {
    return {
      required: true,
      metricsHouseSlug: DEAL_ELIGIBILITY_METRICS_SLUG,
      windowDays,
      missingSuperbetLink: false,
      sumQualifiedFtd: 0,
      sumCpaQualified: 0,
      sumDeposit: 0,
      sumFtds: 0,
      avgDepositPerFtd: null,
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }

  private buildReasons(
    snapshot: DealEligibilitySnapshot,
    minAvgDepositPerFtd: number,
    minQualifiedFtd: number,
  ): string[] {
    const reasons: string[] = [];
    if (snapshot.missingSuperbetLink) {
      reasons.push(
        `Para solicitar deals de outras casas, é preciso ter vínculo ativo na Superbet ` +
          `— os requisitos usam só seus dados na Superbet.`,
      );
    } else if (minAvgDepositPerFtd <= 0) {
      // Deposit average gate disabled for this deal.
    } else if (snapshot.sumFtds === 0) {
      reasons.push(
        `Nenhum FTD nos últimos ${snapshot.windowDays} dias na Superbet.`,
      );
    } else if (
      snapshot.avgDepositPerFtd !== null &&
      snapshot.avgDepositPerFtd < minAvgDepositPerFtd
    ) {
      reasons.push(
        `Depósito médio na Superbet: R$ ${snapshot.avgDepositPerFtd.toFixed(2)} — mínimo: R$ ${minAvgDepositPerFtd}.`,
      );
    }
    if (
      !snapshot.missingSuperbetLink &&
      minQualifiedFtd > 0 &&
      snapshot.sumQualifiedFtd < minQualifiedFtd
    ) {
      reasons.push(
        `CPAs qualificados na Superbet: ${snapshot.sumQualifiedFtd} — mínimo: ${minQualifiedFtd}.`,
      );
    }
    return reasons;
  }
}
