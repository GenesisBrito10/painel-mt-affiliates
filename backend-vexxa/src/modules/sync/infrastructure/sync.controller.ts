import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SyncSchedulerService } from './scheduling/sync-scheduler.service.js';
import { SyncOrchestratorService } from '../application/sync-orchestrator.service.js';
import { JwtAuthGuard, RolesGuard, Roles } from '../../auth/index.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  expandDateRange,
  InvalidDateRangeError,
} from '../domain/date-range.js';

@Controller('admin/sync')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    private readonly scheduler: SyncSchedulerService,
    private readonly orchestrator: SyncOrchestratorService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /admin/sync/trigger
   * Triggers sync for all houses or a specific one.
   * Body: { bettingHouseSlug?: string }
   */
  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  async trigger(
    @Body()
    body: {
      bettingHouseSlug?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const { bettingHouseSlug, dateFrom, dateTo } = body;

    // Backfill: só com casa definida. Varrer o histórico de todas as casas de
    // uma vez é pedido demais para os provedores.
    let dates: string[] | undefined;
    if (dateFrom || dateTo) {
      if (!bettingHouseSlug) {
        throw new BadRequestException(
          'bettingHouseSlug é obrigatório ao informar dateFrom/dateTo',
        );
      }
      if (!dateFrom || !dateTo) {
        throw new BadRequestException('Informe dateFrom e dateTo juntos');
      }
      try {
        dates = expandDateRange(dateFrom, dateTo);
      } catch (err: unknown) {
        throw new BadRequestException(
          err instanceof InvalidDateRangeError
            ? err.message
            : 'Intervalo de datas inválido',
        );
      }
    }

    if (bettingHouseSlug) {
      this.logger.log(
        `Admin triggered sync for "${bettingHouseSlug}"` +
          (dates ? ` (backfill ${dates[0]}..${dates[dates.length - 1]})` : ''),
      );
      // Fire-and-forget: don't await so the HTTP response returns immediately
      this.scheduler
        .runHouse(bettingHouseSlug, 'admin', dates)
        .catch((err: unknown) => {
          this.logger.error(
            `Admin sync error: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    } else {
      this.logger.log('Admin triggered sync for all houses');
      this.scheduler.runAllHouses('admin').catch((err: unknown) => {
        this.logger.error(
          `Admin sync error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    return {
      accepted: true,
      target: bettingHouseSlug ?? 'all',
      ...(dates
        ? { days: dates.length, from: dates[0], to: dates[dates.length - 1] }
        : {}),
      runningHouses: this.orchestrator.getRunningHouses(),
    };
  }

  /**
   * GET /admin/sync/status
   * Returns which houses are currently syncing.
   */
  @Get('status')
  status() {
    const running = this.orchestrator.getRunningHouses();
    return {
      running,
      idle: running.length === 0,
    };
  }

  /**
   * GET /admin/sync/health
   * Per-house health: last sync time, lag hours, recent-day coverage,
   * missing-recent-day list, and an `ok` flag.
   */
  @Get('health')
  async health() {
    return this.orchestrator.getSyncHealth();
  }

  /**
   * GET /admin/sync/logs
   * Returns paginated sync logs with optional house filter.
   */
  @Get('logs')
  async getLogs(
    @Query('house') house?: string,
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
  ) {
    const take = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = parseInt(offset, 10) || 0;

    const where = house ? { bettingHouse: house } : undefined;

    // Serialized to avoid connection pool contention
    const total = await this.prisma.syncLog.count({ where });

    const rows = await this.prisma.syncLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    return { data: rows, total, take, skip };
  }
}
