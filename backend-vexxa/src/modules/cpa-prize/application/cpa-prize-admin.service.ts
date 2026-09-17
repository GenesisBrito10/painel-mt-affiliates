import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, PrizeType, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationService } from '../../notification/index.js';
import { CpaPrizeEngineService } from './cpa-prize-engine.service.js';
import type {
  CreateCpaPrizeRuleDto,
  UpdateCpaPrizeRuleDto,
  ListCpaPrizeRulesQueryDto,
} from './dto/cpa-prize.dto.js';

const STRUCTURAL_KEYS = [
  'cpaPerPrize',
  'prizeValue',
  'prizeType',
  'countMode',
  'bettingHouse',
  'startDate',
  'endDate',
] as const;

function dateOnly(input: string): Date {
  return new Date(`${input}T00:00:00.000Z`);
}

function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

@Injectable()
export class CpaPrizeAdminService {
  private readonly logger = new Logger(CpaPrizeAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly engine: CpaPrizeEngineService,
  ) {}

  // ─── Rules CRUD ────────────────────────────────────────────────────────────

  async listRules(query: ListCpaPrizeRulesQueryDto) {
    const rules = await this.prisma.cpaPrizeRule.findMany({
      where: { archived: query.archived ?? false },
      include: {
        createdBy: { select: { name: true, email: true } },
        versions: { orderBy: { version: 'desc' }, take: 1 },
        _count: { select: { awards: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: rules.map((r) => this.serializeRule(r)) };
  }

  async getRule(id: string) {
    const rule = await this.prisma.cpaPrizeRule.findUnique({
      where: { id },
      include: {
        createdBy: { select: { name: true, email: true } },
        versions: { orderBy: { version: 'desc' } },
        _count: { select: { awards: true } },
      },
    });
    if (!rule) throw new NotFoundException('Regra não encontrada');
    return this.serializeRule(rule);
  }

  async createRule(
    adminId: string,
    adminEmail: string,
    dto: CreateCpaPrizeRuleDto,
    ip: string,
    userAgent: string,
  ) {
    const start = dateOnly(dto.startDate);
    const end = dto.endDate ? dateOnly(dto.endDate) : null;

    const rule = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cpaPrizeRule.create({
        data: {
          name: dto.name,
          description: dto.description ?? '',
          createdById: adminId,
        },
      });
      const version = await tx.cpaPrizeRuleVersion.create({
        data: {
          ruleId: created.id,
          version: 1,
          bettingHouse: dto.bettingHouse ? dto.bettingHouse : null,
          cpaPerPrize: dto.cpaPerPrize,
          countMode: dto.countMode,
          prizeType: dto.prizeType,
          prizeValue: dto.prizeValue ?? 0,
          prizeLabel: dto.prizeLabel ?? '',
          icon: dto.icon ?? '🎯',
          startDate: start,
          endDate: end,
          effectiveFromDate: start, // v1 conta desde o início da regra
        },
      });
      await tx.cpaPrizeRule.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
      await tx.cpaPrizeLog.create({
        data: {
          ruleId: created.id,
          ruleVersionId: version.id,
          adminId,
          event: 'RULE_CREATED',
          bettingHouse: version.bettingHouse,
          note: `Regra "${dto.name}" criada (meta ${dto.cpaPerPrize} CPAs, ${dto.countMode}).`,
        },
      });
      return tx.cpaPrizeRule.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          createdBy: { select: { name: true, email: true } },
          versions: { orderBy: { version: 'desc' } },
          _count: { select: { awards: true } },
        },
      });
    });

    await this.audit(
      adminId,
      adminEmail,
      'cpa_prize_rule_created',
      rule.id,
      ip,
      userAgent,
      {
        name: dto.name,
      },
    );
    this.logger.log(`CPA prize rule "${dto.name}" created by ${adminId}`);
    return this.serializeRule(rule);
  }

  async updateRule(
    adminId: string,
    adminEmail: string,
    id: string,
    dto: UpdateCpaPrizeRuleDto,
    ip: string,
    userAgent: string,
  ) {
    const rule = await this.prisma.cpaPrizeRule.findUnique({
      where: { id },
      include: { versions: { where: { supersededAt: null }, take: 1 } },
    });
    if (!rule) throw new NotFoundException('Regra não encontrada');
    const current = rule.versions[0];
    if (!current) throw new BadRequestException('Regra sem versão vigente');

    const hasStructural = STRUCTURAL_KEYS.some((k) => dto[k] !== undefined);

    await this.prisma.$transaction(async (tx) => {
      // Container (non-structural) updates.
      const containerData: Prisma.CpaPrizeRuleUpdateInput = {};
      if (dto.name !== undefined) containerData.name = dto.name;
      if (dto.description !== undefined)
        containerData.description = dto.description;
      if (dto.active !== undefined) containerData.active = dto.active;
      if (Object.keys(containerData).length > 0) {
        await tx.cpaPrizeRule.update({ where: { id }, data: containerData });
        if (dto.active !== undefined) {
          await tx.cpaPrizeLog.create({
            data: {
              ruleId: id,
              adminId,
              event: 'RULE_TOGGLED',
              note: `Regra ${dto.active ? 'ativada' : 'inativada'}.`,
            },
          });
        }
      }

      if (hasStructural) {
        // Daily cutoff: new version starts TOMORROW by default to avoid the
        // change-day CPA landing in two versions; same-day only if explicit.
        const effectiveFromDate = dto.applySameDay
          ? todayUtc()
          : addDays(todayUtc(), 1);
        const nextVersionNum = current.version + 1;

        await tx.cpaPrizeRuleVersion.update({
          where: { id: current.id },
          data: { supersededAt: new Date() },
        });
        const newVersion = await tx.cpaPrizeRuleVersion.create({
          data: {
            ruleId: id,
            version: nextVersionNum,
            bettingHouse:
              dto.bettingHouse !== undefined
                ? dto.bettingHouse
                  ? dto.bettingHouse
                  : null
                : current.bettingHouse,
            cpaPerPrize: dto.cpaPerPrize ?? current.cpaPerPrize,
            countMode: dto.countMode ?? current.countMode,
            prizeType: dto.prizeType ?? current.prizeType,
            prizeValue: dto.prizeValue ?? current.prizeValue,
            prizeLabel: dto.prizeLabel ?? current.prizeLabel,
            icon: dto.icon ?? current.icon,
            startDate: dto.startDate
              ? dateOnly(dto.startDate)
              : current.startDate,
            endDate:
              dto.endDate !== undefined
                ? dto.endDate
                  ? dateOnly(dto.endDate)
                  : null
                : current.endDate,
            effectiveFromDate,
          },
        });
        await tx.cpaPrizeRule.update({
          where: { id },
          data: { currentVersionId: newVersion.id },
        });
        await tx.cpaPrizeLog.create({
          data: {
            ruleId: id,
            ruleVersionId: newVersion.id,
            adminId,
            event: 'RULE_VERSIONED',
            bettingHouse: newVersion.bettingHouse,
            note: `Nova versão v${nextVersionNum} (mudança estrutural). Contagem a partir de ${effectiveFromDate.toISOString().slice(0, 10)}.${dto.applySameDay ? ' [aplicada no mesmo dia — risco de sobreposição]' : ''}`,
          },
        });
      } else if (dto.prizeLabel !== undefined || dto.icon !== undefined) {
        // Cosmetic-only update on the current version (no new cycle).
        await tx.cpaPrizeRuleVersion.update({
          where: { id: current.id },
          data: {
            ...(dto.prizeLabel !== undefined
              ? { prizeLabel: dto.prizeLabel }
              : {}),
            ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
          },
        });
        await tx.cpaPrizeLog.create({
          data: {
            ruleId: id,
            adminId,
            event: 'RULE_UPDATED',
            note: 'Atualização cosmética da regra.',
          },
        });
      }
    });

    await this.audit(
      adminId,
      adminEmail,
      'cpa_prize_rule_updated',
      id,
      ip,
      userAgent,
      {
        structural: hasStructural,
      },
    );
    return this.getRule(id);
  }

  /** "Remover": archive when the rule has any history; physical delete only if empty. */
  async removeRule(
    adminId: string,
    adminEmail: string,
    id: string,
    ip: string,
    userAgent: string,
  ) {
    const rule = await this.prisma.cpaPrizeRule.findUnique({
      where: { id },
      include: { _count: { select: { awards: true, versions: true } } },
    });
    if (!rule) throw new NotFoundException('Regra não encontrada');

    const progressCount = await this.prisma.cpaPrizeProgress.count({
      where: { ruleId: id },
    });
    const hasHistory = rule._count.awards > 0 || progressCount > 0;

    if (hasHistory) {
      await this.prisma.cpaPrizeRule.update({
        where: { id },
        data: { active: false, archived: true },
      });
      await this.prisma.cpaPrizeLog.create({
        data: {
          ruleId: id,
          adminId,
          event: 'RULE_TOGGLED',
          note: 'Regra arquivada (possui histórico).',
        },
      });
      await this.audit(
        adminId,
        adminEmail,
        'cpa_prize_rule_archived',
        id,
        ip,
        userAgent,
        {},
      );
      return { success: true, archived: true };
    }

    // Truly empty rule — safe physical delete.
    await this.prisma.cpaPrizeRule.delete({ where: { id } });
    await this.audit(
      adminId,
      adminEmail,
      'cpa_prize_rule_deleted',
      id,
      ip,
      userAgent,
      {},
    );
    return { success: true, archived: false };
  }

  // ─── Manual recalculation ──────────────────────────────────────────────────

  async recalculate(
    adminId: string,
    adminEmail: string,
    id: string,
    ip: string,
    userAgent: string,
  ) {
    const rule = await this.prisma.cpaPrizeRule.findUnique({
      where: { id },
      select: { id: true, currentVersionId: true, name: true },
    });
    if (!rule) throw new NotFoundException('Regra não encontrada');
    if (!rule.currentVersionId)
      throw new BadRequestException('Regra sem versão vigente');

    const result = await this.engine.evaluateRuleVersion(
      rule.currentVersionId,
      adminId,
    );

    await this.prisma.cpaPrizeLog.create({
      data: {
        ruleId: id,
        ruleVersionId: rule.currentVersionId,
        adminId,
        event: 'MANUAL_RECALC',
        prizesGenerated: result.awardsGenerated,
        note: `Recálculo manual: ${result.usersEvaluated} usuários avaliados, ${result.awardsGenerated} prêmios gerados, ${result.errors} erros.${result.skippedLocked ? ' [ignorado — avaliação já em andamento]' : ''}`,
        metadata: {
          usersEvaluated: result.usersEvaluated,
          awardsGenerated: result.awardsGenerated,
          errors: result.errors,
          skippedLocked: result.skippedLocked,
        },
      },
    });
    await this.audit(
      adminId,
      adminEmail,
      'cpa_prize_recalculated',
      id,
      ip,
      userAgent,
      {
        ...result,
      },
    );
    return result;
  }

  // ─── Awards / redemption ─────────────────────────────────────────────────

  async listAwards(status?: string) {
    const awards = await this.prisma.cpaPrizeAward.findMany({
      where: status ? { status: status as never } : {},
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return { data: awards.map((a) => this.serializeAward(a)) };
  }

  listRedemptionRequests() {
    return this.listAwards('REDEMPTION_REQUESTED');
  }

  async approveRedemption(
    adminId: string,
    adminEmail: string,
    awardId: string,
    ip: string,
    userAgent: string,
  ) {
    const award = await this.prisma.cpaPrizeAward.findUnique({
      where: { id: awardId },
    });
    if (!award) throw new NotFoundException('Prêmio não encontrado');
    if (award.status !== 'REDEMPTION_REQUESTED') {
      throw new ConflictException(
        'Prêmio não está aguardando aprovação de resgate.',
      );
    }

    const value = award.prizeValue.toNumber();
    await this.prisma.$transaction(async (tx) => {
      if (award.prizeType === PrizeType.BALANCE && value > 0) {
        await tx.user.update({
          where: { id: award.userId },
          data: { bonusBalance: { increment: value } },
        });
      }
      await tx.cpaPrizeAward.update({
        where: { id: awardId },
        data: {
          status: 'PAID',
          balanceCredited: award.prizeType === PrizeType.BALANCE && value > 0,
          resolvedAt: new Date(),
          resolvedById: adminId,
        },
      });
      await tx.cpaPrizeLog.create({
        data: {
          ruleId: award.ruleId,
          ruleVersionId: award.ruleVersionId,
          userId: award.userId,
          adminId,
          event: 'REDEMPTION_APPROVED',
          totalValueGenerated: award.prizeValue,
          note: `Resgate aprovado${award.prizeType === PrizeType.BALANCE ? ` — R$${value.toFixed(2)} creditado no saldo bônus` : ''}.`,
        },
      });
    });

    this.notify(
      award.userId,
      'Resgate aprovado',
      `Seu prêmio "${award.prizeLabel || 'CPA'}" foi aprovado.${award.prizeType === PrizeType.BALANCE ? ' O valor foi creditado no seu saldo bônus.' : ''}`,
      { awardId },
    );
    await this.audit(
      adminId,
      adminEmail,
      'cpa_prize_redemption_approved',
      award.ruleId,
      ip,
      userAgent,
      { awardId },
    );
    return { success: true };
  }

  async rejectRedemption(
    adminId: string,
    adminEmail: string,
    awardId: string,
    reason: string,
    ip: string,
    userAgent: string,
  ) {
    const award = await this.prisma.cpaPrizeAward.findUnique({
      where: { id: awardId },
    });
    if (!award) throw new NotFoundException('Prêmio não encontrado');
    if (award.status !== 'REDEMPTION_REQUESTED') {
      throw new ConflictException(
        'Prêmio não está aguardando aprovação de resgate.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cpaPrizeAward.update({
        where: { id: awardId },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          resolvedAt: new Date(),
          resolvedById: adminId,
        },
      });
      await tx.cpaPrizeLog.create({
        data: {
          ruleId: award.ruleId,
          ruleVersionId: award.ruleVersionId,
          userId: award.userId,
          adminId,
          event: 'REDEMPTION_REJECTED',
          note: `Resgate rejeitado: ${reason}`,
        },
      });
    });

    this.notify(
      award.userId,
      'Resgate recusado',
      `Seu pedido de resgate foi recusado. Motivo: ${reason}`,
      { awardId },
    );
    await this.audit(
      adminId,
      adminEmail,
      'cpa_prize_redemption_rejected',
      award.ruleId,
      ip,
      userAgent,
      { awardId, reason },
    );
    return { success: true };
  }

  async cancelAward(
    adminId: string,
    adminEmail: string,
    awardId: string,
    reason: string,
    ip: string,
    userAgent: string,
  ) {
    const award = await this.prisma.cpaPrizeAward.findUnique({
      where: { id: awardId },
    });
    if (!award) throw new NotFoundException('Prêmio não encontrado');
    if (award.status === 'PAID' || award.status === 'CANCELLED') {
      throw new ConflictException(
        'Prêmio já finalizado — não pode ser cancelado.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.cpaPrizeAward.update({
        where: { id: awardId },
        data: {
          status: 'CANCELLED',
          rejectionReason: reason,
          resolvedAt: new Date(),
          resolvedById: adminId,
        },
      });
      await tx.cpaPrizeLog.create({
        data: {
          ruleId: award.ruleId,
          ruleVersionId: award.ruleVersionId,
          userId: award.userId,
          adminId,
          event: 'AWARD_CANCELLED',
          note: `Prêmio cancelado manualmente: ${reason}`,
        },
      });
    });

    this.notify(
      award.userId,
      'Premiação cancelada',
      `Uma premiação foi cancelada. Motivo: ${reason}`,
      { awardId },
    );
    await this.audit(
      adminId,
      adminEmail,
      'cpa_prize_award_cancelled',
      award.ruleId,
      ip,
      userAgent,
      { awardId, reason },
    );
    return { success: true };
  }

  // ─── Metrics / history / logs ────────────────────────────────────────────

  async metrics() {
    const [byStatus, valueByStatus, redemptionByStatus, topUsers] =
      await Promise.all([
        this.prisma.cpaPrizeAward.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.cpaPrizeAward.groupBy({
          by: ['status'],
          _sum: { prizeValue: true },
        }),
        this.prisma.cpaPrizeAward.groupBy({
          by: ['status'],
          where: {
            status: { in: ['REDEMPTION_REQUESTED', 'PAID', 'REJECTED'] },
          },
          _count: { _all: true },
        }),
        this.prisma.cpaPrizeAward.groupBy({
          by: ['userId', 'userName'],
          _count: { _all: true },
          orderBy: { _count: { userId: 'desc' } },
          take: 10,
        }),
      ]);

    const countMap: Record<string, number> = {};
    for (const r of byStatus) countMap[r.status] = r._count._all;
    const valueMap: Record<string, number> = {};
    for (const r of valueByStatus)
      valueMap[r.status] = r._sum.prizeValue?.toNumber() ?? 0;

    const totalGenerated = Object.values(countMap).reduce((a, b) => a + b, 0);
    const totalValueGenerated = Object.values(valueMap).reduce(
      (a, b) => a + b,
      0,
    );

    return {
      awards: {
        total: totalGenerated,
        available: countMap.AVAILABLE ?? 0,
        redemptionRequested: countMap.REDEMPTION_REQUESTED ?? 0,
        paid: countMap.PAID ?? 0,
        cancelled: countMap.CANCELLED ?? 0,
        rejected: countMap.REJECTED ?? 0,
      },
      value: {
        totalGenerated: totalValueGenerated,
        paid: valueMap.PAID ?? 0,
        pending:
          (valueMap.AVAILABLE ?? 0) + (valueMap.REDEMPTION_REQUESTED ?? 0),
      },
      redemptions: {
        requested:
          redemptionByStatus.find((r) => r.status === 'REDEMPTION_REQUESTED')
            ?._count._all ?? 0,
        approved:
          redemptionByStatus.find((r) => r.status === 'PAID')?._count._all ?? 0,
        rejected:
          redemptionByStatus.find((r) => r.status === 'REJECTED')?._count
            ._all ?? 0,
      },
      topUsers: topUsers.map((u) => ({
        userId: u.userId,
        userName: u.userName,
        awards: u._count._all,
      })),
    };
  }

  async userHistory(userId: string) {
    const [awards, progress, logs] = await Promise.all([
      this.prisma.cpaPrizeAward.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cpaPrizeProgress.findMany({ where: { userId } }),
      this.prisma.cpaPrizeLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    return {
      awards: awards.map((a) => this.serializeAward(a)),
      progress,
      logs,
    };
  }

  async getLogs(ruleId?: string) {
    const logs = await this.prisma.cpaPrizeLog.findMany({
      where: ruleId ? { ruleId } : {},
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return {
      data: logs.map((l) => ({
        ...l,
        totalValueGenerated: l.totalValueGenerated?.toNumber() ?? null,
      })),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private serializeRule(rule: {
    versions: { prizeValue: Prisma.Decimal; [k: string]: unknown }[];
    [k: string]: unknown;
  }) {
    return {
      ...rule,
      versions: rule.versions.map((v) => ({
        ...v,
        prizeValue: v.prizeValue.toNumber(),
      })),
    };
  }

  private serializeAward(a: {
    prizeValue: Prisma.Decimal;
    [k: string]: unknown;
  }) {
    return { ...a, prizeValue: a.prizeValue.toNumber() };
  }

  private notify(
    userId: string,
    title: string,
    message: string,
    metadata: Record<string, unknown>,
  ) {
    this.notificationService
      .create({
        userId,
        type: NotificationType.GENERAL,
        title,
        message,
        metadata,
      })
      .catch((e: unknown) =>
        this.logger.warn(
          `notify failed for ${userId}: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }

  private async audit(
    adminId: string,
    adminEmail: string,
    action: string,
    ruleId: string,
    ip: string,
    userAgent: string,
    details: Record<string, unknown>,
  ) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
      select: { name: true },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        userName: admin?.name ?? 'Admin',
        userEmail: adminEmail,
        action,
        resource: 'CpaPrizeRule',
        method: 'POST',
        path: `/admin/cpa-prizes/${ruleId}`,
        ip,
        userAgent,
        details: { ruleId, ...details },
      },
    });
  }
}
