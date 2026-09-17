import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
} from '../../auth/index.js';
import type { JwtPayload } from '../../auth/index.js';
import { CpaPrizeAdminService } from '../application/cpa-prize-admin.service.js';
import {
  CreateCpaPrizeRuleDto,
  UpdateCpaPrizeRuleDto,
  ListCpaPrizeRulesQueryDto,
  RejectRedemptionDto,
  CancelAwardDto,
} from '../application/dto/cpa-prize.dto.js';

type ReqMeta = { ip: string; headers: Record<string, string> };
const ip = (req: ReqMeta) => req.ip ?? '';
const ua = (req: ReqMeta) => req.headers?.['user-agent'] ?? '';

@ApiTags('admin/cpa-prizes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/cpa-prizes', version: '1' })
export class CpaPrizeAdminController {
  constructor(private readonly admin: CpaPrizeAdminService) {}

  // ── Rules ────────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Admin: listar regras de premiação por CPA' })
  listRules(@Query() query: ListCpaPrizeRulesQueryDto) {
    return this.admin.listRules(query);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Admin: métricas da feature' })
  metrics() {
    return this.admin.metrics();
  }

  @Get('logs')
  @ApiOperation({ summary: 'Admin: logs (filtro opcional por ruleId)' })
  logs(@Query('ruleId') ruleId?: string) {
    return this.admin.getLogs(ruleId);
  }

  @Get('awards')
  @ApiOperation({
    summary: 'Admin: listar prêmios gerados (filtro por status)',
  })
  listAwards(@Query('status') status?: string) {
    return this.admin.listAwards(status);
  }

  @Get('redemptions')
  @ApiOperation({ summary: 'Admin: fila de resgates pendentes' })
  redemptions() {
    return this.admin.listRedemptionRequests();
  }

  @Get('users/:userId/history')
  @ApiOperation({ summary: 'Admin: histórico de premiação por usuário' })
  userHistory(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.admin.userHistory(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Admin: detalhe de uma regra + versões' })
  getRule(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getRule(id);
  }

  @Post()
  @ApiOperation({ summary: 'Admin: criar regra' })
  createRule(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCpaPrizeRuleDto,
    @Req() req: ReqMeta,
  ) {
    return this.admin.createRule(user.sub, user.email, dto, ip(req), ua(req));
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Admin: atualizar regra (estrutural cria nova versão)',
  })
  updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateCpaPrizeRuleDto,
    @Req() req: ReqMeta,
  ) {
    return this.admin.updateRule(
      user.sub,
      user.email,
      id,
      dto,
      ip(req),
      ua(req),
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Admin: remover regra (arquiva se houver histórico)',
  })
  removeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: ReqMeta,
  ) {
    return this.admin.removeRule(user.sub, user.email, id, ip(req), ua(req));
  }

  @Post(':id/recalculate')
  @ApiOperation({ summary: 'Admin: recalcular regra agora' })
  recalculate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: ReqMeta,
  ) {
    return this.admin.recalculate(user.sub, user.email, id, ip(req), ua(req));
  }

  // ── Redemption / award lifecycle ──────────────────────────────────────────

  @Post('awards/:awardId/approve')
  @ApiOperation({ summary: 'Admin: aprovar resgate' })
  approve(
    @Param('awardId', ParseUUIDPipe) awardId: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: ReqMeta,
  ) {
    return this.admin.approveRedemption(
      user.sub,
      user.email,
      awardId,
      ip(req),
      ua(req),
    );
  }

  @Post('awards/:awardId/reject')
  @ApiOperation({ summary: 'Admin: rejeitar resgate' })
  reject(
    @Param('awardId', ParseUUIDPipe) awardId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RejectRedemptionDto,
    @Req() req: ReqMeta,
  ) {
    return this.admin.rejectRedemption(
      user.sub,
      user.email,
      awardId,
      dto.reason,
      ip(req),
      ua(req),
    );
  }

  @Post('awards/:awardId/cancel')
  @ApiOperation({ summary: 'Admin: cancelar prêmio (motivo obrigatório)' })
  cancel(
    @Param('awardId', ParseUUIDPipe) awardId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CancelAwardDto,
    @Req() req: ReqMeta,
  ) {
    return this.admin.cancelAward(
      user.sub,
      user.email,
      awardId,
      dto.reason,
      ip(req),
      ua(req),
    );
  }
}
