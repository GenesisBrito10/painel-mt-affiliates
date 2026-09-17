import { Controller, Get, Query, UseGuards, Req, Res, StreamableFile } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/infrastructure/guards/jwt-auth.guard.js';
import { EarningsOverviewService } from '../application/earnings-overview.service.js';
import { EarningsNetworkService } from '../application/earnings-network.service.js';
import { EarningsLedgerService } from '../application/earnings-ledger.service.js';
import { EarningsLedgerQueryDto } from '../application/dto/earnings.dto.js';


@Controller({ path: 'earnings', version: '1' })
@UseGuards(JwtAuthGuard)
export class EarningsController {
  constructor(
    private readonly overviewService: EarningsOverviewService,
    private readonly networkService: EarningsNetworkService,
    private readonly ledgerService: EarningsLedgerService,
  ) {}

  @Get('overview')
  async getOverview(@Req() req: any, @Query() query: EarningsLedgerQueryDto) {
    return this.overviewService.getOverview(req.user, query);
  }

  @Get('network')
  async getNetwork(@Req() req: any, @Query() query: EarningsLedgerQueryDto) {
    return this.networkService.getNetworkBreakdown(req.user, query);
  }

  @Get('ledger')
  async getLedger(@Req() req: any, @Query() query: EarningsLedgerQueryDto) {
    return this.ledgerService.getLedgerPage(req.user, query);
  }

  @Get('ledger/export')
  async exportLedger(
    @Req() req: any,
    @Query() query: EarningsLedgerQueryDto,
    @Res({ passthrough: true }) res: any,
  ): Promise<StreamableFile> {
    const file = await this.ledgerService.exportCsv(req.user, query);
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', 'attachment; filename="financial_ledger_export.csv"');
    return file;
  }
}
