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
  buildEsportivaCampaignId,
  SheetRow,
  ESPORTIVA_BACKOFF_DELAYS_MS,
  ESPORTIVA_FAMILY_SLUGS,
  ESPORTIVA_LOCK_KEY,
  ESPORTIVA_LOCK_TTL_SECONDS,
  ESPORTIVA_SLUG,
} from '../domain/esportiva.types.js';
import { EsportivaSheetService } from './esportiva-sheet.service.js';

@Injectable()
export class EsportivaAssignmentService {
  private readonly logger = new Logger(EsportivaAssignmentService.name);

  constructor(
    private readonly linkWebhook: LinkWebhookService,
    private readonly prisma: PrismaService,
    private readonly sheetService: EsportivaSheetService,
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

      // Disponível: tem ID + LINK, sem STATUS e sem EMAIL.
      const candidates = rows.filter(
        (r) => !r.status && !r.email && r.link && r.id,
      );
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
        where: { userId, bettingHouse: ESPORTIVA_SLUG, deletedAt: null },
        select: { id: true },
      });

      for (const row of candidates) {
        // campaignId = "MJM COMPANY - <ID da planilha>".
        const campaignId = buildEsportivaCampaignId(row.id);

        const conflict = await this.prisma.affiliateLink.findFirst({
          where: {
            campaignId,
            // Cross-casa: link físico não pode estar em esportivabet NEM esportiva-diario.
            bettingHouse: { in: ESPORTIVA_FAMILY_SLUGS },
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
            // Idempotência: só atribui se ainda PENDING.
            const fresh = await tx.linkRequest.findUnique({
              where: { id: linkRequestId },
              select: { status: true },
            });
            if (fresh?.status !== LinkRequestStatus.PENDING) return;

            const existing = await tx.affiliateLink.findFirst({
              where: { userId, bettingHouse: ESPORTIVA_SLUG, deletedAt: null },
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
                  affiliateId: '',
                  source: LinkSource.POOL,
                  ...commissionData,
                },
              });
            } else {
              await tx.affiliateLink.create({
                data: {
                  userId,
                  bettingHouse: ESPORTIVA_SLUG,
                  campaignId,
                  affiliateId: '',
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
                links: [{ label: '', url: row.link }],
              },
            });
          });
        } catch (err) {
          // P2002 = índice único parcial uq_campaign_house_active disparou: outro
          // ciclo/instância pegou este campaignId entre o pre-check e o commit
          // (corrida TOCTOU). Trata como linha indisponível e tenta a próxima.
          if ((err as { code?: string }).code === 'P2002') {
            this.logger.warn(
              `campaignId ${campaignId} (row ${row.rowIndex}) colidiu no commit (corrida); pulando p/ próxima linha`,
            );
            continue;
          }
          throw err;
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
            title: 'Link Esportiva liberado',
            message:
              'Sua solicitação de afiliação para Esportiva foi liberada. Confira o link no seu painel.',
            metadata: {
              source: 'esportiva-auto-assign',
              campaignId,
              link: row.link,
              linkRequestId,
              bettingHouse: ESPORTIVA_SLUG,
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

  private async acquireLockWithBackoff(token: string): Promise<boolean> {
    const acquireOnce = async (): Promise<boolean> => {
      try {
        const res = await this.redis.set(
          ESPORTIVA_LOCK_KEY,
          token,
          'EX',
          ESPORTIVA_LOCK_TTL_SECONDS,
          'NX',
        );
        return res === 'OK';
      } catch (err) {
        this.logger.error(`Redis SET NX failed: ${(err as Error).message}`);
        return false;
      }
    };

    if (await acquireOnce()) return true;
    for (const delayMs of ESPORTIVA_BACKOFF_DELAYS_MS) {
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
    await this.redis.eval(script, 1, ESPORTIVA_LOCK_KEY, token);
  }
}
