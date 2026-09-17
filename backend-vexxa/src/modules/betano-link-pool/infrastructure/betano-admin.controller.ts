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
  BETANO_SLUG,
  extractBetanoCampaignId,
} from '../domain/betano.types.js';
import { BetanoSchedulerService } from '../application/betano-scheduler.service.js';
import { BetanoSheetService } from '../application/betano-sheet.service.js';

@ApiTags('Betano Auto-Assign')
@ApiBearerAuth()
@Controller({ path: 'admin/betano', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class BetanoAdminController {
  private readonly logger = new Logger(BetanoAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetService: BetanoSheetService,
    private readonly schedulerService: BetanoSchedulerService,
  ) {}

  @Post('assign-pending')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger backfill of pending Betano link requests',
  })
  async assignPending(): Promise<{ triggered: true }> {
    void this.schedulerService.backfillPending().catch((err) => {
      this.logger.error(`Manual backfill failed: ${(err as Error).message}`);
    });
    return { triggered: true };
  }

  @Get('pool-status')
  @ApiOperation({
    summary: 'Get Betano link pool status (available/used/inconsistencies)',
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
        where: { campaignId, bettingHouse: BETANO_SLUG },
        select: { id: true },
      });
      if (exists) inconsistencies++;
    }

    return { total, available, used, inconsistencies };
  }
}
