import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LinkRequestStatus } from '@prisma/client';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import {
  SheetRow,
  ESPORTIVA_SCHEDULER_LOCK_KEY,
  ESPORTIVA_SCHEDULER_LOCK_TTL_SECONDS,
  ESPORTIVA_SLUG,
} from '../domain/esportiva.types.js';
import { LinkPoolAlertService } from '../../link-pool-alert/index.js';
import { EsportivaAssignmentService } from './esportiva-assignment.service.js';
import { EsportivaSheetService } from './esportiva-sheet.service.js';

@Injectable()
export class EsportivaSchedulerService {
  private readonly logger = new Logger(EsportivaSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentService: EsportivaAssignmentService,
    private readonly sheetService: EsportivaSheetService,
    private readonly linkPoolAlert: LinkPoolAlertService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('*/1 * * * *', {
    timeZone: 'America/Sao_Paulo',
    name: 'esportiva-assign-backfill',
  })
  async backfillPending(): Promise<void> {
    const lockToken = `scheduler:${process.pid}:${Date.now()}`;
    const acquired = await this.acquireSchedulerLock(lockToken);
    if (!acquired) {
      this.logger.debug(
        'Backfill skipped: scheduler lock held by another instance',
      );
      return;
    }

    try {
      // CPA resolvido no momento da solicitação (snapshot na LinkRequest).
      // O scheduler atribui o link real usando o snapshot — NUNCA recalcula.
      // PENDING sem snapshot (antiga) espera o backfill.
      const pending = await this.prisma.linkRequest.findMany({
        where: {
          bettingHouseSlug: ESPORTIVA_SLUG,
          status: LinkRequestStatus.PENDING,
          resolvedCpa: { not: null },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: {
          id: true,
          userId: true,
          resolvedCpa: true,
          resolvedRevshare: true,
        },
      });

      if (pending.length === 0) return;

      let prefetchedRows: SheetRow[];
      try {
        prefetchedRows = await this.sheetService.readPool();
      } catch (err) {
        this.logger.error(
          `Backfill aborted: sheet read failed: ${(err as Error).message}`,
        );
        return;
      }
      // Alerta "planilha cheia": livres <= limite → avisa (1x, dedup no Redis).
      const freeCount = prefetchedRows.filter(
        (r) => !r.status && !r.email && r.link,
      ).length;
      await this.linkPoolAlert.checkPool(
        ESPORTIVA_SLUG,
        'Esportiva',
        freeCount,
      );

      if (prefetchedRows.length === 0) return;

      this.logger.log(
        `Backfill: attempting to assign ${pending.length} pending Esportiva requests (pool rows=${prefetchedRows.length})`,
      );

      let assigned = 0;
      let skipped = 0;
      const reasonCounts: Record<string, number> = {};
      // Marca a planilha em LOTE no fim (1 write request/ciclo) — respeita quota.
      const toMark: { rowIndex: number; email: string }[] = [];
      for (let i = 0; i < pending.length; i++) {
        const req = pending[i]!;
        try {
          const result = await this.assignmentService.tryAssign(
            req.userId,
            req.id,
            {
              prefetchedRows,
              deferSheetWrite: true,
              defaultCommission: {
                cpa: req.resolvedCpa!.toNumber(),
                revshare: req.resolvedRevshare?.toNumber() ?? 0,
              },
            },
          );
          if (result.assigned) {
            assigned++;
            toMark.push({ rowIndex: result.rowIndex, email: result.email });
          } else {
            skipped++;
            reasonCounts[result.reason] =
              (reasonCounts[result.reason] ?? 0) + 1;
            if (
              result.reason === 'pool_empty' ||
              result.reason === 'sheet_read_failed'
            ) {
              break;
            }
          }
        } catch (err) {
          this.logger.error(
            `Backfill failed for request ${req.id}: ${(err as Error).message}`,
          );
          skipped++;
        }
      }
      if (toMark.length > 0) {
        try {
          await this.sheetService.markRowsUsed(toMark);
        } catch (err) {
          this.logger.error(
            `[INCONSISTÊNCIA] ${toMark.length} linhas atribuídas no DB mas batch sheet write falhou: ${(err as Error).message}`,
          );
        }
      }
      this.logger.log(
        `Backfill complete: assigned=${assigned}, skipped=${skipped}, reasons=${JSON.stringify(reasonCounts)}`,
      );
    } finally {
      await this.releaseSchedulerLock(lockToken).catch((err) => {
        this.logger.warn(
          `Failed to release scheduler lock: ${(err as Error).message}`,
        );
      });
    }
  }

  private async acquireSchedulerLock(token: string): Promise<boolean> {
    try {
      const res = await this.redis.set(
        ESPORTIVA_SCHEDULER_LOCK_KEY,
        token,
        'EX',
        ESPORTIVA_SCHEDULER_LOCK_TTL_SECONDS,
        'NX',
      );
      return res === 'OK';
    } catch (err) {
      this.logger.error(
        `Redis SET NX failed (scheduler): ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async releaseSchedulerLock(token: string): Promise<void> {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, ESPORTIVA_SCHEDULER_LOCK_KEY, token);
  }
}
