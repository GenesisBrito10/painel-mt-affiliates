import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, CurrentUser } from '../../auth/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { NetworkService } from '../application/network.service.js';
import { NetworkTreeQueryDto, ReferralsQueryDto } from '../application/dto/network.dto.js';

@ApiTags('network')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'network', version: '1' })
export class NetworkController {
  constructor(private readonly networkService: NetworkService) {}

  /**
   * GET /v1/network/tree
   * Returns the BFS 3-level referral tree with enriched stats and spread model earnings.
   * Supports optional ?house=slug filter and server-side pagination (?page=1&limit=20).
   */
  @Get('tree')
  getTree(
    @CurrentUser() user: JwtPayload,
    @Query() query: NetworkTreeQueryDto,
  ) {
    return this.networkService.getTree(user.sub, query);
  }

  /**
   * GET /v1/network/fraud-report
   * Returns fraud logs for all members in the authenticated user's 3-level network.
   * Grouped by member with totalFraudCpa accumulation.
   */
  @Get('fraud-report')
  getFraudReport(@CurrentUser() user: JwtPayload) {
    return this.networkService.getFraudReport(user.sub);
  }

  /**
   * GET /v1/network/referrals
   * Returns direct referrals (L1 only) of the authenticated user.
   * Supports optional ?house=slug filter.
   */
  @Get('referrals')
  getReferrals(
    @CurrentUser() user: JwtPayload,
    @Query() query: ReferralsQueryDto,
  ) {
    return this.networkService.getReferrals(user.sub, query);
  }
}
