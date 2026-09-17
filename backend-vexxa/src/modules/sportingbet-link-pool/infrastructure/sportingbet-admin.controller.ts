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
  SPORTINGBET_SLUG,
  buildSportingbetCampaignId,
  selectAssignableSportingbetRows,
} from '../domain/sportingbet.types.js';
import { SportingbetSchedulerService } from '../application/sportingbet-scheduler.service.js';
import { SportingbetSheetService } from '../application/sportingbet-sheet.service.js';

@ApiTags('SportingBet Auto-Assign')
@ApiBearerAuth()
@Controller({ path: 'admin/sportingbet', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SportingbetAdminController {
  private readonly logger = new Logger(SportingbetAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetService: SportingbetSheetService,
    private readonly schedulerService: SportingbetSchedulerService,
  ) {}

  @Post('assign-pending')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger backfill of pending SportingBet link requests',
  })
  assignPending(): { triggered: true } {
    void this.schedulerService.backfillPending().catch((err) => {
      this.logger.error(`Manual backfill failed: ${(err as Error).message}`);
    });
    return { triggered: true };
  }

  @Get('pool-status')
  @ApiOperation({
    summary:
      'Get SportingBet link pool status (available/used/inconsistencies)',
  })
  async poolStatus(): Promise<PoolStatus> {
    const rows = await this.sheetService.readPool();
    const total = rows.length;
    const used = rows.filter((r) => r.status || r.email).length;
    const availableRows = selectAssignableSportingbetRows(rows);
    const available = availableRows.length;

    let inconsistencies = 0;
    for (const row of availableRows) {
      const campaignId = buildSportingbetCampaignId(
        row.affiliate,
        row.linkType,
      );
      const exists = await this.prisma.affiliateLink.findFirst({
        where: { campaignId, bettingHouse: SPORTINGBET_SLUG },
        select: { id: true },
      });
      if (exists) inconsistencies++;
    }

    return { total, available, used, inconsistencies };
  }
}
