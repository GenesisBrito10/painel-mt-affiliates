import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard, CurrentUser } from '../../auth/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { RankingService } from '../application/ranking.service.js';
import {
  RedeemPrizeDto,
  LeaderboardQueryDto,
} from '../application/dto/ranking.dto.js';

@ApiTags('prizes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'prizes', version: '1' })
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  /**
   * GET /v1/prizes/leaderboard
   * Public leaderboard — top 50 affiliates by CPA for the current period.
   */
  @Get('leaderboard')
  @ApiOperation({ summary: 'Leaderboard — top affiliates by CPA' })
  getLeaderboard(
    @CurrentUser() user: JwtPayload,
    @Query() query: LeaderboardQueryDto,
  ) {
    return this.rankingService.getLeaderboard(user.sub, {
      prizeId: query.prizeId,
      period: query.period ?? 'month',
      bettingHouse: query.bettingHouse,
    });
  }

  /**
   * GET /v1/prizes/active
   * Active prizes for banner/modal display.
   */
  @Get('active')
  @ApiOperation({ summary: 'List active prizes for display' })
  getActivePrizes() {
    return this.rankingService.getActivePrizes();
  }

  /**
   * GET /v1/prizes/showcase
   * Premiações ativas + encerradas com os usuários que estão ganhando (ao vivo)
   * ou que ganharam (vencedores, quando finalizado) embutidos em cada card.
   */
  @Get('showcase')
  @ApiOperation({ summary: 'Prizes with live leaders / final winners' })
  getPrizeShowcase(@CurrentUser() user: JwtPayload) {
    return this.rankingService.getPrizeShowcase(user.sub);
  }

  /**
   * GET /v1/prizes/my-rewards
   * Current user's pending/redeemed rewards.
   */
  @Get('my-rewards')
  @ApiOperation({ summary: 'List my prizes (pending and redeemed)' })
  getMyRewards(@CurrentUser() user: JwtPayload) {
    return this.rankingService.getMyRewards(user.sub);
  }

  /**
   * POST /v1/prizes/:id/redeem
   * Redeem a prize. Credits bonusBalance if type = BALANCE.
   */
  @Post(':id/redeem')
  @ApiOperation({ summary: 'Redeem a prize' })
  redeemPrize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RedeemPrizeDto,
    @Req() req: { ip: string; headers: Record<string, string> },
  ) {
    return this.rankingService.redeemPrize(
      user.sub,
      user.email,
      id,
      dto,
      req.ip ?? '',
      req.headers?.['user-agent'] ?? '',
    );
  }
}
