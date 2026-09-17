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
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser } from '../../auth/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { RankingAdminService } from '../application/ranking-admin.service.js';
import {
  ListPrizesQueryDto,
  CreatePrizeDto,
  UpdatePrizeDto,
  FinalizePrizeDto,
} from '../application/dto/ranking.dto.js';

@ApiTags('admin/prizes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/prizes', version: '1' })
export class RankingAdminController {
  constructor(private readonly adminService: RankingAdminService) {}

  /**
   * GET /v1/admin/prizes
   * List all prizes with optional status filter.
   */
  @Get()
  @ApiOperation({ summary: 'Admin: list all prizes' })
  listPrizes(@Query() query: ListPrizesQueryDto) {
    return this.adminService.listPrizes(query);
  }

  /**
   * POST /v1/admin/prizes
   * Create a new prize contest.
   */
  @Post()
  @ApiOperation({ summary: 'Admin: create a new prize' })
  createPrize(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePrizeDto,
    @Req() req: { ip: string; headers: Record<string, string> },
  ) {
    return this.adminService.createPrize(
      user.sub,
      user.email,
      dto,
      req.ip ?? '',
      req.headers?.['user-agent'] ?? '',
    );
  }

  /**
   * PUT /v1/admin/prizes/:id
   * Edit a prize (only if ACTIVE).
   */
  @Put(':id')
  @ApiOperation({ summary: 'Admin: update a prize' })
  updatePrize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePrizeDto,
  ) {
    return this.adminService.updatePrize(id, dto);
  }

  /**
   * DELETE /v1/admin/prizes/:id
   * Delete a prize (blocks if finalized with redeemed prizes).
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Admin: delete a prize' })
  deletePrize(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deletePrize(id);
  }

  /**
   * POST /v1/admin/prizes/:id/preview-winners
   * Preview: calculate winners WITHOUT saving.
   */
  @Post(':id/preview-winners')
  @ApiOperation({ summary: 'Admin: preview prize winners (dry run)' })
  previewWinners(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.previewWinners(id);
  }

  /**
   * POST /v1/admin/prizes/:id/finalize
   * Finalize: calculate winners, save, and notify.
   */
  @Post(':id/finalize')
  @ApiOperation({ summary: 'Admin: finalize prize and assign winners' })
  finalizePrize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: FinalizePrizeDto,
    @Req() req: { ip: string; headers: Record<string, string> },
  ) {
    return this.adminService.finalizePrize(
      user.sub,
      user.email,
      id,
      dto,
      req.ip ?? '',
      req.headers?.['user-agent'] ?? '',
    );
  }

  /**
   * POST /v1/admin/prizes/:id/revert
   * Revert finalization (blocks if any prize was redeemed).
   */
  @Post(':id/revert')
  @ApiOperation({ summary: 'Admin: revert prize finalization' })
  revertPrize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: { ip: string; headers: Record<string, string> },
  ) {
    return this.adminService.revertPrize(
      user.sub,
      user.email,
      id,
      req.ip ?? '',
      req.headers?.['user-agent'] ?? '',
    );
  }

  /**
   * POST /v1/admin/prizes/:id/end
   * Manually end a prize (ACTIVE → ENDED without finalization).
   */
  @Post(':id/end')
  @ApiOperation({ summary: 'Admin: manually end a prize' })
  endPrize(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.endPrize(id);
  }

  /**
   * GET /v1/admin/prizes/:id/winners
   * List saved winners of a ENDED or FINALIZED prize with redeemed status.
   */
  @Get(':id/winners')
  @ApiOperation({ summary: 'Admin: list prize winners with redeemed status' })
  getWinners(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getWinners(id);
  }

  /**
   * GET /v1/admin/prizes/:id/audit
   * Audit trail for a specific prize.
   */
  @Get(':id/audit')
  @ApiOperation({ summary: 'Admin: prize audit trail' })
  getAudit(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getAudit(id);
  }
}
