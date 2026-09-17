import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard, CurrentUser } from '../../auth/index.js';
import type { JwtPayload } from '../../auth/index.js';
import { CpaPrizeService } from '../application/cpa-prize.service.js';

@ApiTags('cpa-prizes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'cpa-prizes', version: '1' })
export class CpaPrizeController {
  constructor(private readonly service: CpaPrizeService) {}

  @Get('progress')
  @ApiOperation({
    summary: 'Progresso de CPA até a próxima premiação (por regra ativa)',
  })
  getProgress(@CurrentUser() user: JwtPayload) {
    return this.service.getProgress(user.sub);
  }

  @Get('my-awards')
  @ApiOperation({ summary: 'Minhas premiações (histórico + status)' })
  getMyAwards(@CurrentUser() user: JwtPayload) {
    return this.service.getMyAwards(user.sub);
  }

  @Post('awards/:awardId/redeem')
  @ApiOperation({ summary: 'Solicitar resgate de uma premiação disponível' })
  redeem(
    @Param('awardId', ParseUUIDPipe) awardId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.requestRedemption(user.sub, awardId);
  }
}
