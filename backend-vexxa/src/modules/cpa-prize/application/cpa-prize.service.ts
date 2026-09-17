import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationService } from '../../notification/index.js';
import { NETWORK_LEVEL_CAP } from '../../dashboard/application/dashboard-balance.service.js';

export interface RuleProgress {
  ruleId: string;
  ruleVersionId: string;
  name: string;
  description: string;
  countMode: 'INDIVIDUAL' | 'NETWORK';
  bettingHouse: string | null;
  meta: number;
  prizeType: string;
  prizeValue: number;
  prizeLabel: string;
  icon: string;
  totalCpa: number;
  prizesWon: number;
  remainder: number;
  faltam: number;
  message: string;
}

@Injectable()
export class CpaPrizeService {
  private readonly logger = new Logger(CpaPrizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // ─── GET /v1/cpa-prizes/progress ─────────────────────────────────────────

  async getProgress(userId: string): Promise<{ data: RuleProgress[] }> {
    const rules = await this.prisma.cpaPrizeRule.findMany({
      where: { active: true, archived: false },
      include: { versions: { where: { supersededAt: null }, take: 1 } },
    });

    const data: RuleProgress[] = [];
    for (const rule of rules) {
      const v = rule.versions[0];
      if (!v) continue;

      const startWindow = this.start(v.startDate, v.effectiveFromDate);
      const totalCpa =
        v.countMode === 'NETWORK'
          ? await this.networkTotal(
              userId,
              v.bettingHouse,
              startWindow,
              v.endDate,
            )
          : await this.individualTotal(
              userId,
              v.bettingHouse,
              startWindow,
              v.endDate,
            );

      const meta = v.cpaPerPrize;
      const earned = Math.floor(totalCpa / meta);
      const remainder = Math.max(0, totalCpa - earned * meta);
      const faltam = meta - remainder;

      const prizesWon = await this.prisma.cpaPrizeAward.count({
        where: {
          ruleVersionId: v.id,
          userId,
          status: { notIn: ['CANCELLED', 'REJECTED'] },
        },
      });

      data.push({
        ruleId: rule.id,
        ruleVersionId: v.id,
        name: rule.name,
        description: rule.description,
        countMode: v.countMode,
        bettingHouse: v.bettingHouse,
        meta,
        prizeType: v.prizeType,
        prizeValue: v.prizeValue.toNumber(),
        prizeLabel: v.prizeLabel,
        icon: v.icon,
        totalCpa,
        prizesWon,
        remainder,
        faltam,
        message:
          v.countMode === 'NETWORK'
            ? `Esta premiação considera apenas os CPAs gerados pela sua rede/downline. Seus próprios CPAs não entram nessa contagem. Você possui ${totalCpa} CPAs de rede acumulados. Faltam ${faltam} para a próxima premiação.`
            : `Você possui ${totalCpa} CPAs acumulados. Faltam ${faltam} CPAs para liberar sua próxima premiação.`,
      });
    }
    return { data };
  }

  // ─── GET /v1/cpa-prizes/my-awards ────────────────────────────────────────

  async getMyAwards(userId: string) {
    const awards = await this.prisma.cpaPrizeAward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { rule: { select: { name: true } } },
    });
    return {
      data: awards.map((a) => ({
        id: a.id,
        ruleName: a.rule.name,
        countMode: a.countMode,
        bettingHouse: a.bettingHouse,
        cpaThreshold: a.cpaThreshold,
        cycleIndex: a.cycleIndex,
        prizeType: a.prizeType,
        prizeValue: a.prizeValue.toNumber(),
        prizeLabel: a.prizeLabel,
        status: a.status,
        rejectionReason: a.rejectionReason,
        createdAt: a.createdAt,
        redemptionRequestedAt: a.redemptionRequestedAt,
        resolvedAt: a.resolvedAt,
      })),
    };
  }

  // ─── POST /v1/cpa-prizes/awards/:id/redeem ───────────────────────────────

  async requestRedemption(userId: string, awardId: string) {
    const award = await this.prisma.cpaPrizeAward.findUnique({
      where: { id: awardId },
    });
    if (!award) throw new NotFoundException('Prêmio não encontrado');
    if (award.userId !== userId)
      throw new ForbiddenException('Prêmio não pertence a você');
    if (award.status !== 'AVAILABLE') {
      throw new ConflictException(
        'Apenas prêmios disponíveis podem ser resgatados.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cpaPrizeAward.update({
        where: { id: awardId },
        data: {
          status: 'REDEMPTION_REQUESTED',
          redemptionRequestedAt: new Date(),
        },
      });
      await tx.cpaPrizeLog.create({
        data: {
          ruleId: award.ruleId,
          ruleVersionId: award.ruleVersionId,
          userId,
          event: 'REDEMPTION_REQUESTED',
          note: 'Usuário solicitou resgate do prêmio.',
        },
      });
    });

    // Notify admins of the new redemption request.
    this.notifyAdmins(award.userName, award.prizeLabel || 'CPA').catch(
      (e: unknown) =>
        this.logger.warn(
          `admin notify failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
    );

    return {
      success: true,
      message: 'Resgate solicitado. Aguarde a aprovação do administrador.',
    };
  }

  // ─── Per-user CPA totals (live) ──────────────────────────────────────────

  private start(startDate: Date, effectiveFromDate: Date): Date {
    return effectiveFromDate.getTime() > startDate.getTime()
      ? effectiveFromDate
      : startDate;
  }

  private async individualTotal(
    userId: string,
    house: string | null,
    start: Date,
    endDate: Date | null,
  ): Promise<number> {
    const links = await this.prisma.affiliateLink.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(house ? { bettingHouse: house } : {}),
        campaignId: { not: '' },
      },
      select: { campaignId: true },
    });
    return this.sumCpa(
      links.map((l) => l.campaignId),
      start,
      endDate ?? new Date(),
      house,
    );
  }

  private async networkTotal(
    userId: string,
    house: string | null,
    start: Date,
    endDate: Date | null,
  ): Promise<number> {
    // BFS downline from this user (exclude self), collect their campaignIds.
    const downlineIds: string[] = [];
    let frontier = [userId];
    const visited = new Set<string>([userId]);
    for (
      let depth = 1;
      depth <= NETWORK_LEVEL_CAP && frontier.length > 0;
      depth++
    ) {
      const rows = await this.prisma.user.findMany({
        where: { referredById: { in: frontier }, deletedAt: null },
        select: { id: true },
      });
      const next: string[] = [];
      for (const r of rows) {
        if (visited.has(r.id)) continue;
        visited.add(r.id);
        downlineIds.push(r.id);
        next.push(r.id);
      }
      frontier = next;
    }
    if (downlineIds.length === 0) return 0;

    const links = await this.prisma.affiliateLink.findMany({
      where: {
        userId: { in: downlineIds },
        deletedAt: null,
        ...(house ? { bettingHouse: house } : {}),
        campaignId: { not: '' },
      },
      select: { campaignId: true },
    });
    return this.sumCpa(
      links.map((l) => l.campaignId),
      start,
      endDate ?? new Date(),
      house,
    );
  }

  private async sumCpa(
    campaignIds: string[],
    start: Date,
    end: Date,
    house: string | null,
  ): Promise<number> {
    if (campaignIds.length === 0) return 0;
    const agg = await this.prisma.affiliateData.aggregate({
      where: {
        campaignId: { in: campaignIds },
        date: { gte: start, lte: end },
        ...(house ? { bettingHouse: house } : {}),
      },
      _sum: { cpaQualified: true },
    });
    return agg._sum.cpaQualified ?? 0;
  }

  private async notifyAdmins(
    userName: string,
    prizeLabel: string,
  ): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: ['ADMIN', 'SUPERADMIN'] },
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (admins.length === 0) return;
    await this.notificationService.createMany(
      admins.map((a) => ({
        userId: a.id,
        type: NotificationType.GENERAL,
        title: 'Novo pedido de resgate (CPA)',
        message: `${userName} solicitou resgate do prêmio "${prizeLabel}".`,
        metadata: {},
      })),
    );
  }
}
