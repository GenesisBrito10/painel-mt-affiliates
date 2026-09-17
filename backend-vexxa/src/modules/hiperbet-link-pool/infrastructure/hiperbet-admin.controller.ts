import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, Roles, RolesGuard } from '../../auth/index.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { HIPERBET_SLUG, PoolStatus } from '../domain/hiperbet.types.js';
import { HiperbetSchedulerService } from '../application/hiperbet-scheduler.service.js';
import { HiperbetSheetService } from '../application/hiperbet-sheet.service.js';
import { HiperbetMetricsSyncService } from '../application/hiperbet-metrics-sync.service.js';

@ApiTags('Hiperbet Auto-Assign')
@ApiBearerAuth()
@Controller({ path: 'admin/hiperbet', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class HiperbetAdminController {
  private readonly logger = new Logger(HiperbetAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetService: HiperbetSheetService,
    private readonly schedulerService: HiperbetSchedulerService,
    private readonly metricsSyncService: HiperbetMetricsSyncService,
  ) {}

  @Post('assign-pending')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger backfill of pending Hiperbet link requests',
  })
  async assignPending(): Promise<{ triggered: true }> {
    void this.schedulerService.backfillPending().catch((err) => {
      this.logger.error(`Manual backfill failed: ${(err as Error).message}`);
    });
    return { triggered: true };
  }

  @Post('sync-metrics')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Manually trigger Hiperbet metrics sync from "Historico" sheet tab',
  })
  async syncMetrics(): Promise<{ triggered: true }> {
    void this.metricsSyncService.sync().catch((err) => {
      this.logger.error(
        `Manual metrics sync failed: ${(err as Error).message}`,
      );
    });
    return { triggered: true };
  }

  @Get('pool-status')
  @ApiOperation({
    summary: 'Get Hiperbet link pool status',
  })
  async poolStatus(): Promise<PoolStatus> {
    const rows = await this.sheetService.readPool();
    const total = rows.length;
    const used = rows.filter((r) => r.status || r.email).length;
    const available = total - used;

    let inconsistencies = 0;
    for (const row of rows) {
      if (row.status || row.email) continue;
      if (!row.id) continue;
      const exists = await this.prisma.affiliateLink.findFirst({
        where: { campaignId: row.id, bettingHouse: HIPERBET_SLUG },
        select: { id: true },
      });
      if (exists) inconsistencies++;
    }

    return { total, available, used, inconsistencies };
  }
}
