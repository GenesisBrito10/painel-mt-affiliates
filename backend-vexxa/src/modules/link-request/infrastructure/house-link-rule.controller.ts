import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
} from '../../auth/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { HouseLinkRuleService } from '../application/house-link-rule.service.js';
import { LinkBackfillService } from '../application/link-backfill.service.js';
import {
  UpsertHouseLinkRuleDto,
  BackfillDto,
} from '../application/dto/house-link-rule.dto.js';

@ApiTags('admin-link-rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/link-rules')
export class HouseLinkRuleController {
  constructor(
    private readonly rules: HouseLinkRuleService,
    private readonly backfill: LinkBackfillService,
  ) {}

  @Post('backfill')
  @ApiOperation({
    summary:
      'Admin: reprocessa solicitações antigas de uma casa (slug obrigatório)',
  })
  async runBackfill(
    @Query('slug') slug: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: BackfillDto,
  ) {
    const summary = await this.backfill.runBackfill({
      houseSlug: slug,
      dryRun: dto.dryRun ?? false,
      forceRecalculate: dto.forceRecalculate ?? false,
      adminName: user.email,
      reason: dto.reason,
    });
    return { data: summary };
  }

  @Get()
  @ApiOperation({ summary: 'Admin: list all house link rules' })
  async list() {
    return { data: await this.rules.listRules() };
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Admin: get one house link rule' })
  async get(@Param('slug') slug: string) {
    return { data: await this.rules.getRule(slug) };
  }

  @Get(':slug/history')
  @ApiOperation({ summary: 'Admin: rule change history' })
  async history(@Param('slug') slug: string) {
    return { data: await this.rules.getChangeHistory(slug) };
  }

  @Put(':slug')
  @ApiOperation({ summary: 'Admin: create/update a house link rule' })
  async upsert(
    @Param('slug') slug: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertHouseLinkRuleDto,
  ) {
    const rule = await this.rules.upsertRule(slug, dto, user.email);
    return { data: rule };
  }
}
