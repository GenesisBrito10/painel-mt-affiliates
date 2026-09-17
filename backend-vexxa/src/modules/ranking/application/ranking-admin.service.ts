import { Injectable, Inject, Logger } from '@nestjs/common';
import { NotificationType, PrizeStatus, PrizeType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationService } from '../../notification/index.js';
import {
  PrizeNotFoundException,
  PrizeAlreadyFinalizedException,
  PrizeNotActiveException,
  PrizeRedemptionBlockedException,
  PrizeRevertBlockedException,
  PrizeValidationException,
} from '../domain/exceptions/ranking.exceptions.js';
import {
  RANKING_REPOSITORY,
  type IRankingRepository,
} from '../domain/ports/ranking.repository.js';
import type { CalculatedWinner } from '../domain/types/ranking.types.js';
import type {
  ListPrizesQueryDto,
  CreatePrizeDto,
  UpdatePrizeDto,
  FinalizePrizeDto,
} from './dto/ranking.dto.js';

@Injectable()
export class RankingAdminService {
  private readonly logger = new Logger(RankingAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RANKING_REPOSITORY)
    private readonly repo: IRankingRepository,
    private readonly notificationService: NotificationService,
  ) {}

  // ─── GET /v1/admin/prizes ─────────────────────────────────────────────────

  async listPrizes(query: ListPrizesQueryDto) {
    const where = query.status ? { status: query.status } : {};

    const prizes = await this.prisma.rankingPrize.findMany({
      where,
      include: {
        createdBy: { select: { name: true, email: true } },
        finalizedBy: { select: { name: true, email: true } },
        prizes: { orderBy: { rank: 'asc' } },
        _count: { select: { winners: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: prizes.map((p) => ({
        ...p,
        prizeValue: p.prizeValue.toNumber(),
        prizes: p.prizes.map((rp) => ({
          ...rp,
          prizeValue: rp.prizeValue.toNumber(),
        })),
      })),
    };
  }

  // ─── POST /v1/admin/prizes ────────────────────────────────────────────────

  async createPrize(
    adminId: string,
    adminEmail: string,
    dto: CreatePrizeDto,
    ip: string,
    userAgent: string,
  ) {
    const prizesArr = dto.prizes ?? [];
    const winnersCount =
      prizesArr.length > 0 ? prizesArr.length : (dto.winnersCount ?? 1);

    if (prizesArr.length === 0 && !dto.prizeType) {
      throw new PrizeValidationException('Defina prizes[] ou prizeType.');
    }

    const prize = await this.prisma.rankingPrize.create({
      data: {
        title: dto.title,
        description: dto.description ?? '',
        prizeType: dto.prizeType ?? prizesArr[0]?.prizeType ?? 'OTHER',
        prizeValue: dto.prizeValue ?? prizesArr[0]?.prizeValue ?? 0,
        prizeLabel: dto.prizeLabel ?? prizesArr[0]?.prizeLabel ?? '',
        icon: dto.icon ?? prizesArr[0]?.icon ?? '🏆',
        startDate: new Date(`${dto.startDate}T00:00:00.000Z`),
        endDate: new Date(`${dto.endDate}T23:59:59.999Z`),
        winnersCount,
        targetCpa: dto.targetCpa ?? 0,
        bettingHouse: dto.bettingHouse ? dto.bettingHouse : null,
        winMode: dto.winMode ?? 'RANKING',
        cpaFromNetwork: dto.cpaFromNetwork ?? false,
        maxWinsPerUser: dto.maxWinsPerUser ?? null,
        status: PrizeStatus.ACTIVE,
        createdById: adminId,
        prizes: {
          create: prizesArr.map((p) => ({
            rank: p.rank,
            prizeType: p.prizeType,
            prizeValue: p.prizeValue ?? 0,
            prizeLabel: p.prizeLabel ?? '',
            icon: p.icon ?? '',
          })),
        },
      },
      include: {
        prizes: { orderBy: { rank: 'asc' } },
      },
    });

    const adminName = await this.resolveUserName(adminId);
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        userName: adminName,
        userEmail: adminEmail,
        action: 'prize_created',
        resource: 'RankingPrize',
        method: 'POST',
        path: '/admin/prizes',
        ip,
        userAgent,
        details: { prizeId: prize.id, title: dto.title },
      },
    });

    this.logger.log(`Prize "${dto.title}" created by admin ${adminId}`);

    return {
      ...prize,
      prizeValue: prize.prizeValue.toNumber(),
      prizes: prize.prizes.map((rp) => ({
        ...rp,
        prizeValue: rp.prizeValue.toNumber(),
      })),
    };
  }

  // ─── PUT /v1/admin/prizes/:id ─────────────────────────────────────────────

  async updatePrize(prizeId: string, dto: UpdatePrizeDto) {
    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
    });

    if (!prize) throw new PrizeNotFoundException(prizeId);
    if (prize.status !== PrizeStatus.ACTIVE) {
      throw new PrizeNotActiveException(prizeId);
    }

    // Build update data from provided fields
    const updateData: Record<string, unknown> = {};

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.prizeType !== undefined) updateData.prizeType = dto.prizeType;
    if (dto.prizeValue !== undefined) updateData.prizeValue = dto.prizeValue;
    if (dto.prizeLabel !== undefined) updateData.prizeLabel = dto.prizeLabel;
    if (dto.icon !== undefined) updateData.icon = dto.icon;
    if (dto.winnersCount !== undefined)
      updateData.winnersCount = dto.winnersCount;
    if (dto.targetCpa !== undefined) updateData.targetCpa = dto.targetCpa;
    if (dto.bettingHouse !== undefined)
      updateData.bettingHouse = dto.bettingHouse ? dto.bettingHouse : null;
    if (dto.winMode !== undefined) updateData.winMode = dto.winMode;
    if (dto.cpaFromNetwork !== undefined)
      updateData.cpaFromNetwork = dto.cpaFromNetwork;
    if (dto.maxWinsPerUser !== undefined)
      updateData.maxWinsPerUser = dto.maxWinsPerUser;
    if (dto.startDate !== undefined) {
      updateData.startDate = new Date(`${dto.startDate}T00:00:00.000Z`);
    }
    if (dto.endDate !== undefined) {
      updateData.endDate = new Date(`${dto.endDate}T23:59:59.999Z`);
    }

    // If prizes[] is provided, replace all rank prizes
    if (dto.prizes !== undefined) {
      updateData.winnersCount = dto.prizes.length || prize.winnersCount;
    }

    // F4 fix: Atomic transaction for delete + create + update
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.prizes !== undefined) {
        await tx.rankPrize.deleteMany({
          where: { rankingPrizeId: prizeId },
        });

        if (dto.prizes.length > 0) {
          await tx.rankPrize.createMany({
            data: dto.prizes.map((p) => ({
              rankingPrizeId: prizeId,
              rank: p.rank,
              prizeType: p.prizeType,
              prizeValue: p.prizeValue ?? 0,
              prizeLabel: p.prizeLabel ?? '',
              icon: p.icon ?? '',
            })),
          });
        }
      }

      return tx.rankingPrize.update({
        where: { id: prizeId },
        data: updateData,
        include: {
          prizes: { orderBy: { rank: 'asc' } },
        },
      });
    });

    return {
      ...updated,
      prizeValue: updated.prizeValue.toNumber(),
      prizes: updated.prizes.map((rp) => ({
        ...rp,
        prizeValue: rp.prizeValue.toNumber(),
      })),
    };
  }

  // ─── DELETE /v1/admin/prizes/:id ──────────────────────────────────────────

  async deletePrize(prizeId: string) {
    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
      include: { winners: { select: { redeemed: true } } },
    });

    if (!prize) throw new PrizeNotFoundException(prizeId);

    if (
      prize.status === PrizeStatus.FINALIZED &&
      prize.winners.some((w) => w.redeemed)
    ) {
      throw new PrizeRedemptionBlockedException(
        'Não é possível deletar premiação com prêmios já resgatados.',
      );
    }

    // Cascade: RankPrize + PrizeWinner auto-delete via schema onDelete Cascade
    await this.prisma.rankingPrize.delete({ where: { id: prizeId } });

    return { success: true };
  }

  // ─── POST /v1/admin/prizes/:id/preview-winners ────────────────────────────

  async previewWinners(prizeId: string) {
    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
      include: { prizes: { orderBy: { rank: 'asc' } } },
    });

    if (!prize) throw new PrizeNotFoundException(prizeId);
    if (prize.status === PrizeStatus.FINALIZED) {
      throw new PrizeAlreadyFinalizedException(prizeId);
    }

    const candidates = this.capWinsPerUser(
      await this.repo.calculateWinners(
        prize.startDate,
        prize.endDate,
        prize.winnersCount,
        prize.targetCpa,
        prize.bettingHouse,
        prize.winMode,
        prize.cpaFromNetwork,
      ),
      prize,
    );

    if (candidates.length === 0) {
      return {
        winners: [],
        message: 'Nenhum afiliado vinculado com CPA no período.',
        prize: {
          title: prize.title,
          startDate: prize.startDate,
          endDate: prize.endDate,
          winnersCount: prize.winnersCount,
          prizeLabel: prize.prizeLabel,
          prizeType: prize.prizeType,
          prizeValue: prize.prizeValue.toNumber(),
        },
      };
    }

    const winners = this.mapCandidatesToWinners(candidates, prize);

    return {
      winners,
      prize: {
        title: prize.title,
        startDate: prize.startDate,
        endDate: prize.endDate,
        winnersCount: prize.winnersCount,
        prizeLabel: prize.prizeLabel,
        prizeType: prize.prizeType,
        prizeValue: prize.prizeValue.toNumber(),
      },
    };
  }

  // ─── POST /v1/admin/prizes/:id/finalize ───────────────────────────────────

  async finalizePrize(
    adminId: string,
    adminEmail: string,
    prizeId: string,
    dto: FinalizePrizeDto,
    ip: string,
    userAgent: string,
  ) {
    if (!dto.confirmed) {
      throw new PrizeValidationException(
        'É necessário confirmar a finalização. Envie { confirmed: true }.',
      );
    }

    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
      include: { prizes: { orderBy: { rank: 'asc' } } },
    });

    if (!prize) throw new PrizeNotFoundException(prizeId);
    if (prize.status === PrizeStatus.FINALIZED) {
      throw new PrizeAlreadyFinalizedException(prizeId);
    }

    // TARGET (Meta de CPA): vencedores são criados incrementalmente pelo cron
    // horário enquanto ACTIVE. No finalize só fazemos uma varredura final (se
    // ainda na janela) e marcamos FINALIZED — NÃO recriamos (evita duplicar).
    if (prize.winMode === 'TARGET') {
      await this.awardTargetWinners(prizeId);

      await this.prisma.rankingPrize.update({
        where: { id: prizeId },
        data: {
          status: PrizeStatus.FINALIZED,
          finalizedById: adminId,
          finalizedAt: new Date(),
        },
      });

      const rows = await this.prisma.prizeWinner.findMany({
        where: { rankingPrizeId: prizeId },
        orderBy: { rank: 'asc' },
        select: {
          userId: true,
          userName: true,
          campaignId: true,
          cpaAchieved: true,
          rank: true,
          prizeType: true,
          prizeValue: true,
          prizeLabel: true,
        },
      });
      const winners = rows.map((w) => ({
        userId: w.userId,
        userName: w.userName,
        campaignId: w.campaignId,
        cpaAchieved: w.cpaAchieved,
        rank: w.rank,
        prizeType: w.prizeType as string,
        prizeValue: w.prizeValue.toNumber(),
        prizeLabel: w.prizeLabel,
      }));

      const adminNameTarget = await this.resolveUserName(adminId);
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          userName: adminNameTarget,
          userEmail: adminEmail,
          action: 'prize_finalized',
          resource: 'RankingPrize',
          method: 'POST',
          path: `/admin/prizes/${prizeId}/finalize`,
          ip,
          userAgent,
          details: {
            prizeId,
            title: prize.title,
            winnersCount: winners.length,
            mode: 'TARGET',
          },
        },
      });

      this.logger.log(
        `Prize "${prize.title}" (TARGET) finalized by admin ${adminId} — ${winners.length} winners`,
      );

      return { success: true, winners };
    }

    const candidates = this.capWinsPerUser(
      await this.repo.calculateWinners(
        prize.startDate,
        prize.endDate,
        prize.winnersCount,
        prize.targetCpa,
        prize.bettingHouse,
        prize.winMode,
        prize.cpaFromNetwork,
      ),
      prize,
    );

    const winners = this.mapCandidatesToWinners(candidates, prize);

    // Persist prize status + winners inside a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.rankingPrize.update({
        where: { id: prizeId },
        data: {
          status: PrizeStatus.FINALIZED,
          finalizedById: adminId,
          finalizedAt: new Date(),
        },
      });

      if (winners.length > 0) {
        await tx.prizeWinner.createMany({
          data: winners.map((w) => ({
            rankingPrizeId: prizeId,
            userId: w.userId,
            userName: w.userName,
            campaignId: w.campaignId,
            cpaAchieved: w.cpaAchieved,
            rank: w.rank,
            prizeType: w.prizeType as PrizeType,
            prizeValue: w.prizeValue,
            prizeLabel: w.prizeLabel,
          })),
        });
      }
    });

    // Notify winners (fire-and-forget, outside transaction — non-critical)
    if (winners.length > 0) {
      this.notificationService
        .createMany(
          winners
            .filter((w) => w.userId)
            .map((w) => {
              const winnerLabel =
                w.prizeLabel || prize.prizeLabel || prize.title;
              return {
                userId: w.userId,
                type: NotificationType.GENERAL,
                title: `🏆 Parabéns! Você ganhou: ${prize.title}`,
                message: `Você ficou em ${w.rank}º lugar com ${w.cpaAchieved} CPAs e ganhou "${winnerLabel}"! Acesse a página de Prêmios para resgatar.`,
                metadata: { prizeId, rank: w.rank },
              };
            }),
        )
        .catch((err: unknown) =>
          this.logger.warn(
            `Winner notifications failed for prize ${prizeId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    // Audit log
    const adminName = await this.resolveUserName(adminId);
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        userName: adminName,
        userEmail: adminEmail,
        action: 'prize_finalized',
        resource: 'RankingPrize',
        method: 'POST',
        path: `/admin/prizes/${prizeId}/finalize`,
        ip,
        userAgent,
        details: {
          prizeId,
          title: prize.title,
          winnersCount: winners.length,
          winners: winners.map((w) => ({
            userName: w.userName,
            rank: w.rank,
            cpa: w.cpaAchieved,
          })),
        },
      },
    });

    this.logger.log(
      `Prize "${prize.title}" finalized by admin ${adminId} — ${winners.length} winners`,
    );

    return { success: true, winners };
  }

  // ─── Premiação incremental do modo TARGET (Meta de CPA) ───────────────────

  /**
   * Cria PrizeWinner para quem JÁ atingiu a meta, sem esperar o finalize/data
   * fim. Idempotente: pula campanhas já premiadas e respeita maxWinsPerUser
   * contando os vencedores já existentes. Só age em prêmio TARGET ACTIVE dentro
   * de [startDate, endDate]. Usado pelo cron horário e pelo finalize (TARGET).
   */
  async awardTargetWinners(prizeId: string): Promise<{ awarded: number }> {
    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
      include: { prizes: { orderBy: { rank: 'asc' } } },
    });
    if (!prize) throw new PrizeNotFoundException(prizeId);

    const now = new Date();
    if (
      prize.winMode !== 'TARGET' ||
      prize.status !== PrizeStatus.ACTIVE ||
      now < prize.startDate ||
      now > prize.endDate
    ) {
      return { awarded: 0 };
    }

    const existing = await this.prisma.prizeWinner.findMany({
      where: { rankingPrizeId: prizeId },
      select: { userId: true, campaignId: true },
    });
    const awardedCampaigns = new Set(existing.map((w) => w.campaignId));
    const winsPerUser = new Map<string, number>();
    for (const w of existing) {
      winsPerUser.set(w.userId, (winsPerUser.get(w.userId) ?? 0) + 1);
    }

    const candidates = await this.repo.calculateWinners(
      prize.startDate,
      prize.endDate,
      prize.winnersCount,
      prize.targetCpa,
      prize.bettingHouse,
      prize.winMode,
      prize.cpaFromNetwork,
    );

    const max = prize.maxWinsPerUser;
    const fresh: typeof candidates = [];
    for (const c of candidates) {
      if (awardedCampaigns.has(c.campaignId)) continue; // já premiado
      if (max && (winsPerUser.get(c.userId) ?? 0) >= max) continue; // cap
      winsPerUser.set(c.userId, (winsPerUser.get(c.userId) ?? 0) + 1);
      fresh.push(c);
    }

    if (fresh.length === 0) return { awarded: 0 };

    // rank sequencial após os já existentes (cosmético no TARGET, mas único).
    const baseRank = existing.length;
    const winners = this.mapCandidatesToWinners(fresh, prize).map((w, i) => ({
      ...w,
      rank: baseRank + i + 1,
    }));

    await this.prisma.prizeWinner.createMany({
      data: winners.map((w) => ({
        rankingPrizeId: prizeId,
        userId: w.userId,
        userName: w.userName,
        campaignId: w.campaignId,
        cpaAchieved: w.cpaAchieved,
        rank: w.rank,
        prizeType: w.prizeType as PrizeType,
        prizeValue: w.prizeValue,
        prizeLabel: w.prizeLabel,
      })),
    });

    this.notificationService
      .createMany(
        winners
          .filter((w) => w.userId)
          .map((w) => {
            const winnerLabel = w.prizeLabel || prize.prizeLabel || prize.title;
            return {
              userId: w.userId,
              type: NotificationType.GENERAL,
              title: `🏆 Meta atingida: ${prize.title}`,
              message: `Você atingiu a meta com ${w.cpaAchieved} CPAs e ganhou "${winnerLabel}"! Acesse a página de Prêmios para resgatar.`,
              metadata: { prizeId, rank: w.rank },
            };
          }),
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `Award notifications failed for prize ${prizeId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    this.logger.log(
      `Target prize "${prize.title}" — awarded ${fresh.length} new winner(s)`,
    );
    return { awarded: fresh.length };
  }

  /**
   * Varre todos os prêmios TARGET ativos e premia incrementalmente. A janela
   * [startDate, endDate] é checada dentro de {@link awardTargetWinners}. Usado
   * pelo cron horário.
   */
  async awardAllActiveTargetPrizes(): Promise<{
    prizes: number;
    awarded: number;
  }> {
    const prizes = await this.prisma.rankingPrize.findMany({
      where: { winMode: 'TARGET', status: PrizeStatus.ACTIVE },
      select: { id: true },
    });

    let awarded = 0;
    for (const p of prizes) {
      try {
        const r = await this.awardTargetWinners(p.id);
        awarded += r.awarded;
      } catch (err) {
        this.logger.warn(
          `Award sweep failed for prize ${p.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (awarded > 0) {
      this.logger.log(
        `Target award sweep: prizes=${prizes.length} newWinners=${awarded}`,
      );
    }
    return { prizes: prizes.length, awarded };
  }

  // ─── POST /v1/admin/prizes/:id/revert ─────────────────────────────────────

  async revertPrize(
    adminId: string,
    adminEmail: string,
    prizeId: string,
    ip: string,
    userAgent: string,
  ) {
    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
      include: {
        winners: { select: { id: true, userId: true, redeemed: true } },
      },
    });

    if (!prize) throw new PrizeNotFoundException(prizeId);
    if (prize.status !== PrizeStatus.FINALIZED) {
      throw new PrizeNotActiveException(prizeId);
    }

    if (prize.winners.some((w) => w.redeemed)) {
      throw new PrizeRevertBlockedException(prizeId);
    }

    const winnerUserIds = prize.winners.map((w) => w.userId).filter(Boolean);

    // Determine revert status based on dates
    const now = new Date();
    const revertStatus =
      now > prize.endDate ? PrizeStatus.ENDED : PrizeStatus.ACTIVE;

    await this.prisma.$transaction(async (tx) => {
      // Remove winners
      await tx.prizeWinner.deleteMany({
        where: { rankingPrizeId: prizeId },
      });

      // Revert prize status
      await tx.rankingPrize.update({
        where: { id: prizeId },
        data: {
          status: revertStatus,
          finalizedById: null,
          finalizedAt: null,
        },
      });
    });

    // Remove related notifications (fire-and-forget, outside transaction)
    if (winnerUserIds.length > 0) {
      this.notificationService
        .deleteByPrizeId(prizeId, winnerUserIds)
        .catch((err: unknown) =>
          this.logger.warn(
            `Notification cleanup failed for prize ${prizeId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    // Audit log
    const adminName = await this.resolveUserName(adminId);
    await this.prisma.auditLog.create({
      data: {
        userId: adminId,
        userName: adminName,
        userEmail: adminEmail,
        action: 'prize_reverted',
        resource: 'RankingPrize',
        method: 'POST',
        path: `/admin/prizes/${prizeId}/revert`,
        ip,
        userAgent,
        details: {
          prizeId,
          title: prize.title,
          revertedStatus: revertStatus,
          winnersRemoved: winnerUserIds.length,
        },
      },
    });

    this.logger.log(
      `Prize "${prize.title}" reverted by admin ${adminId} → ${revertStatus}`,
    );

    return { success: true, status: revertStatus };
  }

  // ─── POST /v1/admin/prizes/:id/end ────────────────────────────────────────

  async endPrize(prizeId: string) {
    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
    });

    if (!prize) throw new PrizeNotFoundException(prizeId);
    if (prize.status !== PrizeStatus.ACTIVE) {
      throw new PrizeNotActiveException(prizeId);
    }

    await this.prisma.rankingPrize.update({
      where: { id: prizeId },
      data: { status: PrizeStatus.ENDED },
    });

    return { success: true };
  }

  // ─── GET /v1/admin/prizes/:id/winners ─────────────────────────────────────

  async getWinners(prizeId: string) {
    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
      select: { id: true, title: true, status: true },
    });

    if (!prize) throw new PrizeNotFoundException(prizeId);

    const winners = await this.prisma.prizeWinner.findMany({
      where: { rankingPrizeId: prizeId },
      orderBy: { rank: 'asc' },
      select: {
        id: true,
        rank: true,
        userName: true,
        campaignId: true,
        cpaAchieved: true,
        prizeType: true,
        prizeValue: true,
        prizeLabel: true,
        redeemed: true,
        redeemedAt: true,
        user: { select: { name: true, email: true } },
      },
    });

    return {
      prize: { id: prize.id, title: prize.title, status: prize.status },
      winners: winners.map((w) => ({
        ...w,
        prizeValue: w.prizeValue.toNumber(),
      })),
    };
  }

  // ─── GET /v1/admin/prizes/:id/audit ───────────────────────────────────────

  async getAudit(prizeId: string) {
    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
      include: {
        createdBy: { select: { name: true, email: true } },
        finalizedBy: { select: { name: true, email: true } },
        prizes: { orderBy: { rank: 'asc' } },
        winners: {
          orderBy: { rank: 'asc' },
          include: { user: { select: { name: true, email: true } } },
        },
      },
    });

    if (!prize) throw new PrizeNotFoundException(prizeId);

    const auditLogs = await this.prisma.auditLog.findMany({
      where: {
        resource: 'RankingPrize',
        details: { path: ['prizeId'], equals: prizeId },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      prize: {
        ...prize,
        prizeValue: prize.prizeValue.toNumber(),
        prizes: prize.prizes.map((rp) => ({
          ...rp,
          prizeValue: rp.prizeValue.toNumber(),
        })),
        winners: prize.winners.map((w) => ({
          ...w,
          prizeValue: w.prizeValue.toNumber(),
        })),
      },
      auditLogs,
    };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Modo TARGET (Meta de CPA): limita quantas vezes o MESMO usuário pode vencer
   * a meta. Os candidatos já vêm ordenados por CPA desc, então mantemos as
   * primeiras N ocorrências de cada userId (as de maior CPA). `maxWinsPerUser`
   * null/0 = ilimitado. Não afeta o modo RANKING (limitado por vagas).
   */
  private capWinsPerUser<T extends { userId: string }>(
    candidates: T[],
    prize: { winMode: string; maxWinsPerUser: number | null },
  ): T[] {
    if (prize.winMode !== 'TARGET' || !prize.maxWinsPerUser) {
      return candidates;
    }
    const perUser = new Map<string, number>();
    const out: T[] = [];
    for (const c of candidates) {
      const seen = perUser.get(c.userId) ?? 0;
      if (seen >= prize.maxWinsPerUser) continue;
      perUser.set(c.userId, seen + 1);
      out.push(c);
    }
    return out;
  }

  private mapCandidatesToWinners(
    candidates: {
      userId: string;
      userName: string;
      campaignId: string;
      cpaQualified: number;
    }[],
    prize: {
      prizeType: string;
      prizeValue: { toNumber(): number };
      prizeLabel: string;
      prizes: {
        rank: number;
        prizeType: string;
        prizeValue: { toNumber(): number };
        prizeLabel: string;
      }[];
    },
  ): CalculatedWinner[] {
    return candidates.map((c, index) => {
      const rank = index + 1;
      const rankPrize = prize.prizes.find((p) => p.rank === rank);

      return {
        userId: c.userId,
        userName: c.userName,
        campaignId: c.campaignId,
        cpaAchieved: c.cpaQualified,
        rank,
        prizeType: rankPrize?.prizeType || prize.prizeType || 'OTHER',
        prizeValue:
          rankPrize?.prizeValue?.toNumber() ?? prize.prizeValue.toNumber() ?? 0,
        prizeLabel: rankPrize?.prizeLabel || prize.prizeLabel || '',
      };
    });
  }

  private async resolveUserName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? 'Admin';
  }
}
