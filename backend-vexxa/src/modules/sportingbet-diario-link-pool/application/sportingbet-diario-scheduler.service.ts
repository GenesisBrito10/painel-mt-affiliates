import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LinkRequestStatus } from '@prisma/client';
import type Redis from 'ioredis';
import { LinkPoolAlertService } from '../../link-pool-alert/index.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import {
  selectAssignableSportingbetRows,
  SheetRow,
} from '../../sportingbet-link-pool/domain/sportingbet.types.js';
import {
  SPORTINGBET_DIARIO_SCHEDULER_LOCK_KEY,
  SPORTINGBET_DIARIO_SCHEDULER_LOCK_TTL_SECONDS,
  SPORTINGBET_DIARIO_SLUG,
} from '../domain/sportingbet-diario.types.js';
import { SportingbetDiarioAssignmentService } from './sportingbet-diario-assignment.service.js';
import { SportingbetDiarioSheetService } from './sportingbet-diario-sheet.service.js';

@Injectable()
export class SportingbetDiarioSchedulerService {
  private readonly logger = new Logger(SportingbetDiarioSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentService: SportingbetDiarioAssignmentService,
    private readonly sheetService: SportingbetDiarioSheetService,
    private readonly linkPoolAlert: LinkPoolAlertService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('*/1 * * * *', {
    timeZone: 'America/Sao_Paulo',
    name: 'sportingbet-diario-assign-backfill',
  })
  async backfillPending(): Promise<void> {
    const config = await this.prisma.bettingHouse.findUnique({
      where: { slug: SPORTINGBET_DIARIO_SLUG },
      select: {
        active: true,
        linkRule: { select: { autoAssignEnabled: true } },
      },
    });
    if (!config?.active || !config.linkRule?.autoAssignEnabled) return;

    const lockToken = `scheduler:${process.pid}:${Date.now()}`;
    if (!(await this.acquireSchedulerLock(lockToken))) return;

    try {
      const pending = await this.prisma.linkRequest.findMany({
        where: {
          bettingHouseSlug: SPORTINGBET_DIARIO_SLUG,
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

      let rows: SheetRow[];
      try {
        rows = await this.sheetService.readPool();
      } catch (err) {
        this.logger.error(
          `Daily backfill sheet read failed: ${(err as Error).message}`,
        );
        return;
      }

      const freeCount = selectAssignableSportingbetRows(rows).length;
      await this.linkPoolAlert.checkPool(
        SPORTINGBET_DIARIO_SLUG,
        'SportingBet Diário',
        freeCount,
      );
      if (rows.length === 0) return;

      const toMark: { rowIndex: number; email: string }[] = [];
      for (const request of pending) {
        try {
          const result = await this.assignmentService.tryAssign(
            request.userId,
            request.id,
            {
              prefetchedRows: rows,
              deferSheetWrite: true,
              defaultCommission: {
                cpa: request.resolvedCpa!.toNumber(),
                revshare: request.resolvedRevshare?.toNumber() ?? 0,
              },
            },
          );
          if (result.assigned) {
            toMark.push({
              rowIndex: result.rowIndex,
              email: result.email,
            });
          } else if (
            result.reason === 'pool_empty' ||
            result.reason === 'pool_blocked' ||
            result.reason === 'sheet_read_failed' ||
            result.reason === 'sheet_write_failed'
          ) {
            break;
          }
        } catch (err) {
          this.logger.error(
            `Daily backfill failed for ${request.id}: ${(err as Error).message}`,
          );
        }
      }

      if (toMark.length > 0) {
        try {
          await this.sheetService.markRowsUsed(toMark);
        } catch (err) {
          this.logger.error(
            `[INCONSISTÊNCIA] ${toMark.length} daily rows assigned in DB but sheet batch failed: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      await this.releaseSchedulerLock(lockToken).catch((err) => {
        this.logger.warn(
          `Failed to release daily scheduler lock: ${(err as Error).message}`,
        );
      });
    }
  }

  private async acquireSchedulerLock(token: string): Promise<boolean> {
    try {
      const result = await this.redis.set(
        SPORTINGBET_DIARIO_SCHEDULER_LOCK_KEY,
        token,
        'EX',
        SPORTINGBET_DIARIO_SCHEDULER_LOCK_TTL_SECONDS,
        'NX',
      );
      return result === 'OK';
    } catch (err) {
      this.logger.error(
        `Daily scheduler Redis SET NX failed: ${(err as Error).message}`,
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
    await this.redis.eval(
      script,
      1,
      SPORTINGBET_DIARIO_SCHEDULER_LOCK_KEY,
      token,
    );
  }
}
