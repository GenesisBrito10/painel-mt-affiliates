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
  buildSportingbetCampaignId,
  PoolStatus,
  selectAssignableSportingbetRows,
} from '../../sportingbet-link-pool/domain/sportingbet.types.js';
import { SportingbetDiarioSchedulerService } from '../application/sportingbet-diario-scheduler.service.js';
import { SportingbetDiarioSheetService } from '../application/sportingbet-diario-sheet.service.js';
import { SPORTINGBET_DIARIO_SLUG } from '../domain/sportingbet-diario.types.js';

@ApiTags('SportingBet Diário Auto-Assign')
@ApiBearerAuth()
@Controller({ path: 'admin/sportingbet-diario', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SportingbetDiarioAdminController {
  private readonly logger = new Logger(SportingbetDiarioAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetService: SportingbetDiarioSheetService,
    private readonly schedulerService: SportingbetDiarioSchedulerService,
  ) {}

  @Post('assign-pending')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger backfill of pending SportingBet Diário requests',
  })
  assignPending(): { triggered: true } {
    void this.schedulerService.backfillPending().catch((err) => {
      this.logger.error(
        `Manual daily backfill failed: ${(err as Error).message}`,
      );
    });
    return { triggered: true };
  }

  @Get('pool-status')
  @ApiOperation({ summary: 'Get SportingBet Diário link pool status' })
  async poolStatus(): Promise<PoolStatus> {
    const rows = await this.sheetService.readPool();
    const total = rows.length;
    const used = rows.filter((row) => row.status || row.email).length;
    const availableRows = selectAssignableSportingbetRows(rows);
    let inconsistencies = 0;

    for (const row of availableRows) {
      const campaignId = buildSportingbetCampaignId(
        row.affiliate,
        row.linkType,
      );
      const exists = await this.prisma.affiliateLink.findFirst({
        where: {
          campaignId,
          bettingHouse: SPORTINGBET_DIARIO_SLUG,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (exists) inconsistencies++;
    }

    return {
      total,
      available: availableRows.length,
      used,
      inconsistencies,
    };
  }
}
