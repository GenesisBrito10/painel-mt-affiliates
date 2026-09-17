import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LinkRequestStatus,
  LinkSource,
  NotificationType,
} from '@prisma/client';
import type Redis from 'ioredis';
import { LinkWebhookService } from '../../link-webhook/application/link-webhook.service.js';
import { NotificationService } from '../../notification/index.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import {
  AssignResult,
  buildSportingbetCampaignId,
  isSportingbetRowAvailable,
  normalizeSportingbetAffiliate,
  selectSequentialSportingbetRows,
  SheetRow,
  SPORTINGBET_BACKOFF_DELAYS_MS,
} from '../../sportingbet-link-pool/domain/sportingbet.types.js';
import {
  SPORTINGBET_DIARIO_LOCK_KEY,
  SPORTINGBET_DIARIO_LOCK_TTL_SECONDS,
  SPORTINGBET_DIARIO_SLUG,
} from '../domain/sportingbet-diario.types.js';
import { SportingbetDiarioSheetService } from './sportingbet-diario-sheet.service.js';

@Injectable()
export class SportingbetDiarioAssignmentService {
  private readonly logger = new Logger(SportingbetDiarioAssignmentService.name);

  constructor(
    private readonly linkWebhook: LinkWebhookService,
    private readonly prisma: PrismaService,
    private readonly sheetService: SportingbetDiarioSheetService,
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
    if (!(await this.acquireLockWithBackoff(lockToken))) {
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
            `Failed to read daily sheet pool: ${(err as Error).message}`,
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
      if (!user) return { assigned: false, reason: 'all_conflicts' };

      const existingLink = await this.prisma.affiliateLink.findFirst({
        where: {
          userId,
          bettingHouse: SPORTINGBET_DIARIO_SLUG,
          deletedAt: null,
        },
        select: { id: true },
      });

      for (const row of candidates) {
        if (!isSportingbetRowAvailable(row)) {
          this.logger.error(
            `Daily sequential pool blocked at row ${row.rowIndex}`,
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
            bettingHouse: SPORTINGBET_DIARIO_SLUG,
            deletedAt: null,
            ...(existingLink ? { NOT: { id: existingLink.id } } : {}),
          },
          select: { user: { select: { email: true } } },
        });
        if (conflict) {
          if (
            !(await this.reconcileRow(row, conflict.user.email, campaignId))
          ) {
            return { assigned: false, reason: 'sheet_write_failed' };
          }
          continue;
        }

        let committed = false;
        try {
          committed = await this.prisma.$transaction(async (tx) => {
            const fresh = await tx.linkRequest.findUnique({
              where: { id: linkRequestId },
              select: { status: true },
            });
            if (fresh?.status !== LinkRequestStatus.PENDING) return false;

            const existing = await tx.affiliateLink.findFirst({
              where: {
                userId,
                bettingHouse: SPORTINGBET_DIARIO_SLUG,
                deletedAt: null,
              },
              select: { id: true },
            });
            const commission = opts.defaultCommission
              ? {
                  cpa: opts.defaultCommission.cpa,
                  revshare: opts.defaultCommission.revshare,
                }
              : {};
            const linkData = {
              campaignId,
              affiliateId,
              linkType: row.linkType,
              userLink: row.link,
              source: LinkSource.POOL,
              ...commission,
            };
            if (existing) {
              await tx.affiliateLink.update({
                where: { id: existing.id },
                data: linkData,
              });
            } else {
              await tx.affiliateLink.create({
                data: {
                  userId,
                  bettingHouse: SPORTINGBET_DIARIO_SLUG,
                  ...linkData,
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
          if ((err as { code?: string }).code === 'P2002') {
            const owner = await this.prisma.affiliateLink.findFirst({
              where: {
                campaignId,
                bettingHouse: SPORTINGBET_DIARIO_SLUG,
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
            continue;
          }
          throw err;
        }
        if (!committed) {
          return { assigned: false, reason: 'already_fulfilled' };
        }

        if (!opts.deferSheetWrite) {
          try {
            await this.sheetService.markRowUsed(row.rowIndex, user.email);
          } catch (err) {
            this.logger.error(
              `[INCONSISTÊNCIA] Daily DB updated for request ${linkRequestId}, but row ${row.rowIndex} write failed: ${(err as Error).message}`,
            );
          }
        }
        row.status = 'marcado';
        row.email = user.email;

        try {
          await this.notificationService.create({
            userId,
            type: NotificationType.GENERAL,
            title: 'Link SportingBet Diário liberado',
            message:
              'Sua solicitação para SportingBet Diário foi liberada. Confira o link no seu painel.',
            metadata: {
              source: 'sportingbet-diario-auto-assign',
              campaignId,
              link: row.link,
              linkRequestId,
              bettingHouse: SPORTINGBET_DIARIO_SLUG,
            },
          });
        } catch (err) {
          this.logger.error(
            `Daily notification failed for ${userId}: ${(err as Error).message}`,
          );
        }
        try {
          await this.linkWebhook.notifyApproved(linkRequestId, 'AUTO_ASSIGN');
        } catch (err) {
          this.logger.error(
            `Daily webhook failed for ${linkRequestId}: ${(err as Error).message}`,
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
        this.logger.warn(
          `Failed to release daily lock: ${(err as Error).message}`,
        );
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
        `Daily row ${row.rowIndex} (${campaignId}) reconciliation failed: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async acquireLockWithBackoff(token: string): Promise<boolean> {
    const acquireOnce = async (): Promise<boolean> => {
      try {
        const result = await this.redis.set(
          SPORTINGBET_DIARIO_LOCK_KEY,
          token,
          'EX',
          SPORTINGBET_DIARIO_LOCK_TTL_SECONDS,
          'NX',
        );
        return result === 'OK';
      } catch (err) {
        this.logger.error(
          `Daily Redis SET NX failed: ${(err as Error).message}`,
        );
        return false;
      }
    };

    if (await acquireOnce()) return true;
    for (const delayMs of SPORTINGBET_BACKOFF_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
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
    await this.redis.eval(script, 1, SPORTINGBET_DIARIO_LOCK_KEY, token);
  }
}
