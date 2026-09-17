import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LinkRequestStatus,
  NotificationType,
  LinkSource,
} from '@prisma/client';
import type Redis from 'ioredis';
import { NotificationService } from '../../notification/index.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LinkWebhookService } from '../../link-webhook/application/link-webhook.service.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import {
  AssignResult,
  buildSportingbetCampaignId,
  isSportingbetRowAvailable,
  normalizeSportingbetAffiliate,
  selectSequentialSportingbetRows,
  SheetRow,
  SPORTINGBET_BACKOFF_DELAYS_MS,
  SPORTINGBET_LOCK_KEY,
  SPORTINGBET_LOCK_TTL_SECONDS,
  SPORTINGBET_SLUG,
} from '../domain/sportingbet.types.js';
import { SportingbetSheetService } from './sportingbet-sheet.service.js';

@Injectable()
export class SportingbetAssignmentService {
  private readonly logger = new Logger(SportingbetAssignmentService.name);

  constructor(
    private readonly linkWebhook: LinkWebhookService,
    private readonly prisma: PrismaService,
    private readonly sheetService: SportingbetSheetService,
    private readonly notificationService: NotificationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async tryAssign(
    userId: string,
    linkRequestId: string,
    opts: {
      prefetchedRows?: SheetRow[];
      defaultCommission?: { cpa: number; revshare: number };
      deferSheetWrite?: boolean;
    } = {},
  ): Promise<AssignResult> {
    const lockToken = `${linkRequestId}:${Date.now()}`;
    const acquired = await this.acquireLockWithBackoff(lockToken);
    if (!acquired) {
      this.logger.warn(
        `Could not acquire lock for request ${linkRequestId} after retries`,
      );
      return { assigned: false, reason: 'lock_busy' };
    }

    try {
      const request = await this.prisma.linkRequest.findUnique({
        where: { id: linkRequestId },
        select: { id: true, status: true },
      });
      if (!request) return { assigned: false, reason: 'request_not_found' };
      if (request.status !== LinkRequestStatus.PENDING) {
        return { assigned: false, reason: 'already_fulfilled' };
      }

      let rows: SheetRow[];
      if (opts.prefetchedRows) {
        rows = opts.prefetchedRows;
      } else {
        try {
          rows = await this.sheetService.readPool();
        } catch (err) {
          this.logger.error(
            `Failed to read sheet pool: ${(err as Error).message}`,
          );
          return { assigned: false, reason: 'sheet_read_failed' };
        }
      }

      const candidates = selectSequentialSportingbetRows(rows);
      if (candidates.length === 0) {
        return { assigned: false, reason: 'pool_empty' };
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!user) {
        this.logger.error(`User ${userId} not found`);
        return { assigned: false, reason: 'all_conflicts' };
      }

      // Link ativo atual do usuário nesta casa (alvo do update). Excluído da
      // checagem de conflito p/ permitir idempotência sem colidir com o índice
      // único parcial uq_campaign_house_active (campaignId, bettingHouse) WHERE deletedAt IS NULL.
      const existingLink = await this.prisma.affiliateLink.findFirst({
        where: { userId, bettingHouse: SPORTINGBET_SLUG, deletedAt: null },
        select: { id: true },
      });

      for (const row of candidates) {
        if (!isSportingbetRowAvailable(row)) {
          this.logger.error(
            `Sequential pool blocked at row ${row.rowIndex}: required cells are incomplete or control cells are inconsistent`,
          );
          return { assigned: false, reason: 'pool_blocked' };
        }

        const affiliateId = normalizeSportingbetAffiliate(row.affiliate);
        const campaignId = buildSportingbetCampaignId(
          row.affiliate,
          row.linkType,
        );

        const conflict = await this.prisma.affiliateLink.findFirst({
          where: {
            campaignId,
            bettingHouse: SPORTINGBET_SLUG,
            deletedAt: null,
            ...(existingLink ? { NOT: { id: existingLink.id } } : {}),
          },
          select: { userId: true, user: { select: { email: true } } },
        });
        if (conflict) {
          this.logger.warn(
            `campaignId ${campaignId} (row ${row.rowIndex}) already assigned to user ${conflict.userId}; reconciling before advancing`,
          );
          const reconciled = await this.reconcileRow(
            row,
            conflict.user.email,
            campaignId,
          );
          if (!reconciled) {
            return { assigned: false, reason: 'sheet_write_failed' };
          }
          continue;
        }

        let committed = false;
        try {
          committed = await this.prisma.$transaction(async (tx) => {
            // Idempotência: só atribui se ainda PENDING.
            const fresh = await tx.linkRequest.findUnique({
              where: { id: linkRequestId },
              select: { status: true },
            });
            if (fresh?.status !== LinkRequestStatus.PENDING) return false;

            const existing = await tx.affiliateLink.findFirst({
              where: {
                userId,
                bettingHouse: SPORTINGBET_SLUG,
                deletedAt: null,
              },
              select: { id: true },
            });
            const commissionData = opts.defaultCommission
              ? {
                  cpa: opts.defaultCommission.cpa,
                  revshare: opts.defaultCommission.revshare,
                }
              : {};
            if (existing) {
              await tx.affiliateLink.update({
                where: { id: existing.id },
                data: {
                  campaignId,
                  affiliateId,
                  linkType: row.linkType,
                  userLink: row.link,
                  source: LinkSource.POOL,
                  ...commissionData,
                },
              });
            } else {
              await tx.affiliateLink.create({
                data: {
                  userId,
                  bettingHouse: SPORTINGBET_SLUG,
                  campaignId,
                  affiliateId,
                  linkType: row.linkType,
                  userLink: row.link,
                  source: LinkSource.POOL,
                  ...commissionData,
                },
              });
            }
            await tx.linkRequest.update({
              where: { id: linkRequestId },
              data: {
                status: LinkRequestStatus.FULFILLED,
                fulfilledAt: new Date(),
                fulfilledByName: 'Sistema',
                adminNote: '',
                links: [{ label: row.linkType, url: row.link }],
              },
            });
            return true;
          });
        } catch (err) {
          // P2002 = índice único parcial uq_campaign_house_active disparou: outro
          // ciclo/instância pegou este campaignId entre o pre-check e o commit.
          // Reconcilia a própria linha antes de avançar para não abrir lacuna.
          if ((err as { code?: string }).code === 'P2002') {
            const owner = await this.prisma.affiliateLink.findFirst({
              where: {
                campaignId,
                bettingHouse: SPORTINGBET_SLUG,
                deletedAt: null,
              },
              select: { user: { select: { email: true } } },
            });
            if (
              !owner ||
              !(await this.reconcileRow(row, owner.user.email, campaignId))
            ) {
              return { assigned: false, reason: 'sheet_write_failed' };
            }
            this.logger.warn(
              `campaignId ${campaignId} (row ${row.rowIndex}) reconciliado após colisão no commit`,
            );
            continue;
          }
          throw err;
        }
        if (!committed) {
          return { assigned: false, reason: 'already_fulfilled' };
        }

        // deferSheetWrite: o scheduler marca em lote (1 write request/ciclo)
        // para respeitar a quota do Sheets. Caminho avulso (create) marca já.
        if (!opts.deferSheetWrite) {
          try {
            await this.sheetService.markRowUsed(row.rowIndex, user.email);
          } catch (err) {
            this.logger.error(
              `[INCONSISTÊNCIA] DB updated for request ${linkRequestId} (row ${row.rowIndex}, campaignId ${campaignId}) but sheet write failed: ${(err as Error).message}`,
            );
          }
        }

        row.status = 'marcado';
        row.email = user.email;

        try {
          await this.notificationService.create({
            userId,
            type: NotificationType.GENERAL,
            title: 'Link SportingBet liberado',
            message:
              'Sua solicitação de afiliação para SportingBet foi liberada. Confira o link no seu painel.',
            metadata: {
              source: 'sportingbet-auto-assign',
              campaignId,
              link: row.link,
              linkRequestId,
              bettingHouse: SPORTINGBET_SLUG,
            },
          });
        } catch (err) {
          this.logger.error(
            `Notification failed for user ${userId} (request ${linkRequestId}): ${(err as Error).message}`,
          );
        }

        this.logger.log(
          `Assigned row ${row.rowIndex} (campaignId ${campaignId}) to user ${userId} for request ${linkRequestId}`,
        );
        try {
          await this.linkWebhook.notifyApproved(linkRequestId, 'AUTO_ASSIGN');
        } catch (err) {
          this.logger.error(
            `Webhook approved emit failed for request ${linkRequestId}: ${(err as Error).message}`,
          );
        }
        return {
          assigned: true,
          campaignId,
          link: row.link,
          rowIndex: row.rowIndex,
          email: user.email,
        };
      }

      return { assigned: false, reason: 'all_conflicts' };
    } finally {
      await this.releaseLock(lockToken).catch((err) => {
        this.logger.warn(`Failed to release lock: ${(err as Error).message}`);
      });
    }
  }

  private async reconcileRow(
    row: SheetRow,
    ownerEmail: string,
    campaignId: string,
  ): Promise<boolean> {
    try {
      await this.sheetService.markRowUsed(row.rowIndex, ownerEmail);
      row.status = 'marcado';
      row.email = ownerEmail;
      return true;
    } catch (err) {
      this.logger.error(
        `[INCONSISTÊNCIA] Não foi possível reconciliar row ${row.rowIndex} (${campaignId}): ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async acquireLockWithBackoff(token: string): Promise<boolean> {
    const acquireOnce = async (): Promise<boolean> => {
      try {
        const res = await this.redis.set(
          SPORTINGBET_LOCK_KEY,
          token,
          'EX',
          SPORTINGBET_LOCK_TTL_SECONDS,
          'NX',
        );
        return res === 'OK';
      } catch (err) {
        this.logger.error(`Redis SET NX failed: ${(err as Error).message}`);
        return false;
      }
    };

    if (await acquireOnce()) return true;
    for (const delayMs of SPORTINGBET_BACKOFF_DELAYS_MS) {
      await new Promise((r) => setTimeout(r, delayMs));
      if (await acquireOnce()) return true;
    }
    return false;
  }

  private async releaseLock(token: string): Promise<void> {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, SPORTINGBET_LOCK_KEY, token);
  }
}
