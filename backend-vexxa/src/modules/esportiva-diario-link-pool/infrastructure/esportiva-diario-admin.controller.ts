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
  ESPORTIVA_FAMILY_SLUGS,
  buildEsportivaCampaignId,
} from '../domain/esportiva-diario.types.js';
import { EsportivaDiarioSchedulerService } from '../application/esportiva-diario-scheduler.service.js';
import { EsportivaDiarioSheetService } from '../application/esportiva-diario-sheet.service.js';

@ApiTags('Esportiva Diário Auto-Assign')
@ApiBearerAuth()
@Controller({ path: 'admin/esportiva-diario', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class EsportivaDiarioAdminController {
  private readonly logger = new Logger(EsportivaDiarioAdminController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetService: EsportivaDiarioSheetService,
    private readonly schedulerService: EsportivaDiarioSchedulerService,
  ) {}

  @Post('assign-pending')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger backfill of pending Esportiva Diário requests',
  })
  async assignPending(): Promise<{ triggered: true }> {
    void this.schedulerService.backfillPending().catch((err) => {
      this.logger.error(`Manual backfill failed: ${(err as Error).message}`);
    });
    return { triggered: true };
  }

  @Get('pool-status')
  @ApiOperation({
    summary:
      'Get Esportiva Diário link pool status (available/used/inconsistencies)',
  })
  async poolStatus(): Promise<PoolStatus> {
    const rows = await this.sheetService.readPool();
    const total = rows.length;
    const used = rows.filter((r) => r.status || r.email).length;
    const available = total - used;

    let inconsistencies = 0;
    for (const row of rows) {
      if (row.status || row.email || !row.id) continue;
      const campaignId = buildEsportivaCampaignId(row.id);
      const exists = await this.prisma.affiliateLink.findFirst({
        where: { campaignId, bettingHouse: { in: ESPORTIVA_FAMILY_SLUGS } },
        select: { id: true },
      });
      if (exists) inconsistencies++;
    }

    return { total, available, used, inconsistencies };
  }
}
