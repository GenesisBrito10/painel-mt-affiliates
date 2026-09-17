import { Inject, Injectable, Logger } from '@nestjs/common';
import { LinkRequestStatus, NotificationType } from '@prisma/client';
import type Redis from 'ioredis';
import { NotificationService } from '../../notification/index.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LinkWebhookService } from '../../link-webhook/application/link-webhook.service.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import {
  AssignResult,
  extractBetanoCampaignId,
  SheetRow,
  BETANO_BACKOFF_DELAYS_MS,
  BETANO_FAMILY_SLUGS,
  BETANO_LOCK_KEY,
  BETANO_LOCK_TTL_SECONDS,
  BETANO_DIARIO_SLUG,
} from '../domain/betano-diario.types.js';
import { BetanoDiarioSheetService } from './betano-diario-sheet.service.js';

@Injectable()
export class BetanoDiarioAssignmentService {
  private readonly logger = new Logger(BetanoDiarioAssignmentService.name);

  constructor(
    private readonly linkWebhook: LinkWebhookService,
    private readonly prisma: PrismaService,
    private readonly sheetService: BetanoDiarioSheetService,
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
    // Lock de atribuição compartilhado com o Betano: mesmo em planilhas
    // separadas, evita ativar a mesma campanha simultaneamente nas duas casas.
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
        select: { id: true, status: true, userId: true },
      });
      if (!request) {
        this.logger.warn(`LinkRequest ${linkRequestId} not found`);
        return { assigned: false, reason: 'request_not_found' };
      }
      if (request.status !== LinkRequestStatus.PENDING) {
        this.logger.debug(
          `LinkRequest ${linkRequestId} not PENDING (status=${request.status}); skipping`,
        );
        return { assigned: false, reason: 'already_fulfilled' };
      }

      const hasCommission = await this.prisma.affiliateLink.findFirst({
        where: {
          userId,
          bettingHouse: BETANO_DIARIO_SLUG,
          cpa: { not: null },
          revshare: { not: null },
        },
        select: { id: true },
      });
      const applyDefault = !hasCommission && !!opts.defaultCommission;
      if (!hasCommission && !applyDefault) {
        this.logger.debug(
          `LinkRequest ${linkRequestId}: user ${userId} has no AffiliateLink with cpa+rev set; skipping`,
        );
        return { assigned: false, reason: 'commission_not_set' };
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

      const candidates = rows.filter((r) => !r.status && !r.email && r.link);
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

      const existingLink = await this.prisma.affiliateLink.findFirst({
        where: { userId, bettingHouse: BETANO_DIARIO_SLUG, deletedAt: null },
        select: { id: true },
      });

      for (const row of candidates) {
        const parsed = extractBetanoCampaignId(row.link);
        if (!parsed) {
          this.logger.warn(
            `Row ${row.rowIndex} has malformed URL (no siteid/c): ${row.link}`,
          );
          continue;
        }
        const campaignId = `${parsed.siteid}-${parsed.c}`;

        const conflict = await this.prisma.affiliateLink.findFirst({
          where: {
            campaignId,
            // Cross-casa: o link físico não pode estar em betano NEM betano-diario.
            bettingHouse: { in: BETANO_FAMILY_SLUGS },
            deletedAt: null,
            ...(existingLink ? { NOT: { id: existingLink.id } } : {}),
          },
          select: { userId: true },
        });
        if (conflict) {
          this.logger.warn(
            `campaignId ${campaignId} (row ${row.rowIndex}) already assigned to user ${conflict.userId}; skipping`,
          );
          continue;
        }

        try {
          await this.prisma.$transaction(async (tx) => {
            const existing = await tx.affiliateLink.findFirst({
              where: {
                userId,
                bettingHouse: BETANO_DIARIO_SLUG,
                deletedAt: null,
              },
              select: { id: true },
            });
            const commissionData =
              applyDefault && opts.defaultCommission
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
                  affiliateId: parsed.siteid,
                  userLink: row.link,
                  ...commissionData,
                },
              });
            } else {
              await tx.affiliateLink.create({
                data: {
                  userId,
                  bettingHouse: BETANO_DIARIO_SLUG,
                  campaignId,
                  affiliateId: parsed.siteid,
                  userLink: row.link,
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
                links: [{ label: '', url: row.link }],
              },
            });
          });
        } catch (err) {
          if ((err as { code?: string }).code === 'P2002') {
            this.logger.warn(
              `campaignId ${campaignId} (row ${row.rowIndex}) colidiu no commit (corrida); pulando p/ próxima linha`,
            );
            continue;
          }
          throw err;
        }

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
            title: 'Link Betano Diário liberado',
            message: `Sua solicitação de afiliação para Betano Diário foi liberada. Confira o link no seu painel.`,
            metadata: {
              source: 'betano-diario-auto-assign',
              campaignId,
              link: row.link,
              linkRequestId,
              bettingHouse: BETANO_DIARIO_SLUG,
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
          affiliateId: parsed.siteid,
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

  private async acquireLockWithBackoff(token: string): Promise<boolean> {
    const acquireOnce = async (): Promise<boolean> => {
      try {
        const res = await this.redis.set(
          BETANO_LOCK_KEY,
          token,
          'EX',
          BETANO_LOCK_TTL_SECONDS,
          'NX',
        );
        return res === 'OK';
      } catch (err) {
        this.logger.error(`Redis SET NX failed: ${(err as Error).message}`);
        return false;
      }
    };

    if (await acquireOnce()) return true;
    for (const delayMs of BETANO_BACKOFF_DELAYS_MS) {
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
    await this.redis.eval(script, 1, BETANO_LOCK_KEY, token);
  }
}
