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
import {
  PoolStatus,
  BETANO_FAMILY_SLUGS,
  extractBetanoCampaignId,
} from '../domain/betano-diario.types.js';
import { BetanoDiarioSchedulerService } from '../application/betano-diario-scheduler.service.js';
import { BetanoDiarioSheetService } from '../application/betano-diario-sheet.service.js';
import { BetanoDiarioMetricsSyncService } from '../application/betano-diario-metrics-sync.service.js';

@ApiTags('Betano Diário Auto-Assign')
@ApiBearerAuth()
@Controller({ path: 'admin/betano-diario', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class BetanoDiarioAdminController {
  private readonly logger = new Logger(BetanoDiarioAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetService: BetanoDiarioSheetService,
    private readonly schedulerService: BetanoDiarioSchedulerService,
    private readonly metricsSyncService: BetanoDiarioMetricsSyncService,
  ) {}

  @Post('assign-pending')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger backfill of pending Betano Diário link requests',
  })
  assignPending(): { triggered: true } {
    void this.schedulerService.backfillPending().catch((err) => {
      this.logger.error(`Manual backfill failed: ${(err as Error).message}`);
    });
    return { triggered: true };
  }

  @Post('sync-metrics')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger Betano Diario metrics sync from dated tabs',
  })
  syncMetrics(): { triggered: true } {
    void this.metricsSyncService.sync('admin').catch((err) => {
      this.logger.error(
        `Manual metrics sync failed: ${(err as Error).message}`,
      );
    });
    return { triggered: true };
  }

  @Get('pool-status')
  @ApiOperation({
    summary:
      'Get Betano Diário link pool status (available/used/inconsistencies)',
  })
  async poolStatus(): Promise<PoolStatus> {
    const rows = await this.sheetService.readPool();
    const total = rows.length;
    const used = rows.filter((r) => r.status || r.email).length;
    const available = total - used;

    let inconsistencies = 0;
    for (const row of rows) {
      if (row.status || row.email) continue;
      const parsed = extractBetanoCampaignId(row.link);
      if (!parsed) continue;
      const campaignId = `${parsed.siteid}-${parsed.c}`;
      const exists = await this.prisma.affiliateLink.findFirst({
        // O pool físico é próprio, mas a campanha não pode ficar ativa ao
        // mesmo tempo em Betano e Betano Diário.
        where: {
          campaignId,
          bettingHouse: { in: BETANO_FAMILY_SLUGS },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (exists) inconsistencies++;
    }

    return { total, available, used, inconsistencies };
  }
}
