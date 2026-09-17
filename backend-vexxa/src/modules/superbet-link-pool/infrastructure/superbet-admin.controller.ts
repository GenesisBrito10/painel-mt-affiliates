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
  SUPERBET_SLUG,
  extractSuperbetCampaignId,
} from '../domain/superbet.types.js';
import { SuperbetSchedulerService } from '../application/superbet-scheduler.service.js';
import { SuperbetSheetService } from '../application/superbet-sheet.service.js';

@ApiTags('Superbet Auto-Assign')
@ApiBearerAuth()
@Controller({ path: 'admin/superbet', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class SuperbetAdminController {
  private readonly logger = new Logger(SuperbetAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetService: SuperbetSheetService,
    private readonly schedulerService: SuperbetSchedulerService,
  ) {}

  @Post('assign-pending')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger backfill of pending Superbet link requests',
  })
  async assignPending(): Promise<{ triggered: true }> {
    void this.schedulerService.backfillPending().catch((err) => {
      this.logger.error(`Manual backfill failed: ${(err as Error).message}`);
    });
    return { triggered: true };
  }

  @Get('pool-status')
  @ApiOperation({
    summary: 'Get Superbet link pool status (available/used/inconsistencies)',
  })
  async poolStatus(): Promise<PoolStatus> {
    const rows = await this.sheetService.readPool();
    const total = rows.length;
    const used = rows.filter((r) => r.status || r.email).length;
    const available = total - used;

    let inconsistencies = 0;
    for (const row of rows) {
      if (row.status || row.email) continue;
      const parsed = extractSuperbetCampaignId(row.link);
      if (!parsed) continue;
      const campaignId = `${parsed.siteid}-${parsed.c}`;
      const exists = await this.prisma.affiliateLink.findFirst({
        where: { campaignId, bettingHouse: SUPERBET_SLUG },
        select: { id: true },
      });
      if (exists) inconsistencies++;
    }

    return { total, available, used, inconsistencies };
  }
}
