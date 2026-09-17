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
  PINBET_FAMILY_SLUGS,
  resolvePinbetCampaignId,
} from '../domain/pinbet-diario.types.js';
import { PinbetDiarioSchedulerService } from '../application/pinbet-diario-scheduler.service.js';
import { PinbetDiarioSheetService } from '../application/pinbet-diario-sheet.service.js';

@ApiTags('Pinbet Diário Auto-Assign')
@ApiBearerAuth()
@Controller({ path: 'admin/pinbet-diario', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PinbetDiarioAdminController {
  private readonly logger = new Logger(PinbetDiarioAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetService: PinbetDiarioSheetService,
    private readonly schedulerService: PinbetDiarioSchedulerService,
  ) {}

  @Post('assign-pending')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger backfill of pending Pinbet Diário link requests',
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
      'Get Pinbet Diário link pool status (available/used/inconsistencies)',
  })
  async poolStatus(): Promise<PoolStatus> {
    const rows = await this.sheetService.readPool();
    const total = rows.length;
    const used = rows.filter((r) => r.status || r.email).length;
    const available = total - used;

    let inconsistencies = 0;
    for (const row of rows) {
      if (row.status || row.email) continue;
      const campaignId = resolvePinbetCampaignId(row);
      if (!campaignId) continue;
      const exists = await this.prisma.affiliateLink.findFirst({
        // Linha "livre" cujo afp1 já é link em qualquer casa da família
        // (pinbet-diario/pinbet-mensal) é inconsistência.
        where: { campaignId, bettingHouse: { in: PINBET_FAMILY_SLUGS } },
        select: { id: true },
      });
      if (exists) inconsistencies++;
    }

    return { total, available, used, inconsistencies };
  }
}
