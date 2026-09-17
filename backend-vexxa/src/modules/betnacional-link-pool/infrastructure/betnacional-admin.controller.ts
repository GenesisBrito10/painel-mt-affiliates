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
import { BETNACIONAL_SLUG, PoolStatus } from '../domain/betnacional.types.js';
import { BetnacionalSchedulerService } from '../application/betnacional-scheduler.service.js';
import { BetnacionalSheetService } from '../application/betnacional-sheet.service.js';
import { BetnacionalMetricsSyncService } from '../application/betnacional-metrics-sync.service.js';

@ApiTags('Betnacional Auto-Assign')
@ApiBearerAuth()
@Controller({ path: 'admin/betnacional', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class BetnacionalAdminController {
  private readonly logger = new Logger(BetnacionalAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetService: BetnacionalSheetService,
    private readonly schedulerService: BetnacionalSchedulerService,
    private readonly metricsSyncService: BetnacionalMetricsSyncService,
  ) {}

  @Post('assign-pending')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger backfill of pending Betnacional link requests',
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
      'Manually trigger Betnacional metrics sync from "Historico" sheet tab',
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
    summary: 'Get Betnacional link pool status',
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
        where: { campaignId: row.id, bettingHouse: BETNACIONAL_SLUG },
        select: { id: true },
      });
      if (exists) inconsistencies++;
    }

    return { total, available, used, inconsistencies };
  }
}
