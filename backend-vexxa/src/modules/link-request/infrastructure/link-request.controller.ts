import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
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
import { LinkRequestService } from '../application/link-request.service.js';
import { LinkBackfillService } from '../application/link-backfill.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CreateLinkRequestDto,
  ListLinkRequestsQueryDto,
  UpdateLinkRequestDto,
  SetLinkRequestCpaDto,
  ListDealRequestsQueryDto,
  ApproveDealRequestDto,
} from '../application/dto/link-request.dto.js';
import { ReprocessRequestDto } from '../application/dto/house-link-rule.dto.js';

@ApiTags('link-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ version: '1' })
export class LinkRequestController {
  constructor(
    private readonly linkRequestService: LinkRequestService,
    private readonly backfillService: LinkBackfillService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * POST /v1/link-requests/:id/reprocess  [ADMIN]
   * Reprocessa uma solicitação: recalcula CPA (opcional) e tenta atribuir.
   * Exige motivo. ADMIN_REPROCESS com auditoria.
   */
  @Post('link-requests/:id/reprocess')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: reprocess a link request (reason required)',
  })
  reprocess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReprocessRequestDto,
  ) {
    return this.backfillService.reprocessRequest(id, {
      reason: dto.reason,
      recalculateSnapshot: dto.recalculateSnapshot ?? false,
      adminName: user.email,
    });
  }

  /**
   * GET /v1/admin/link-requests/pending-by-house
   * Admin only — returns PENDING deal/link request counts grouped by betting house.
   * Used by the admin dashboard urgency alerts panel.
   */
  @Get('admin/link-requests/pending-by-house')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: pending link request counts per betting house',
  })
  async pendingByHouse() {
    // Group pending requests by bettingHouseSlug
    const grouped = await this.prisma.linkRequest.groupBy({
      by: ['bettingHouseSlug'],
      where: { status: 'PENDING' },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    if (!grouped.length) return { data: [] };

    // Fetch house names + logos in one query
    const slugs = grouped.map((g) => g.bettingHouseSlug);
    const houses = await this.prisma.bettingHouse.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, name: true, logoUrl: true },
    });
    const houseMap = new Map(houses.map((h) => [h.slug, h]));

    const data = grouped.map((g) => {
      const house = houseMap.get(g.bettingHouseSlug);
      return {
        slug: g.bettingHouseSlug,
        houseName: house?.name ?? g.bettingHouseSlug,
        logoUrl: house?.logoUrl ?? null,
        pendingCount: g._count.id,
      };
    });

    return { data };
  }

  /**
   * GET /v1/link-requests/houses
   * Active betting houses for affiliate dropdowns.
   * Migrated from UserController — no auth change needed.
   */
  @Get('link-requests/houses')
  @ApiOperation({ summary: 'List active betting houses for link requests' })
  listHouses() {
    return this.linkRequestService.listHouses();
  }

  /**
   * GET /v1/link-requests/deals
   * Active deals the affiliate can request a link for.
   */
  @Get('link-requests/deals')
  @ApiOperation({
    summary: 'Marketplace — active deals with user request status',
  })
  listDeals(@CurrentUser() user: JwtPayload) {
    return this.linkRequestService.listDeals(user.sub);
  }

  /**
   * GET /v1/link-requests
   * Admin: all requests.
   * Affiliate: own + direct invitees (referredById = currentUser.id).
   */
  @Get('link-requests')
  @ApiOperation({ summary: 'List link requests (role-aware)' })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListLinkRequestsQueryDto,
  ) {
    return this.linkRequestService.list(user, query);
  }

  /**
   * POST /v1/link-requests
   * Create a link request for a Deal. Validates eligibility and duplicates.
   */
  @Post('link-requests')
  @ApiOperation({ summary: 'Request a link for a deal' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLinkRequestDto) {
    return this.linkRequestService.create(user.sub, dto);
  }

  /**
   * GET /v1/link-requests/:id/referrer-ceiling
   * Admin OR network leader — returns the referrer's CPA/RevShare ceiling.
   * Used by the affiliate approve modal to enforce commission limits.
   */
  @Get('link-requests/:id/referrer-ceiling')
  @ApiOperation({
    summary: 'Referrer ceiling for a link request (admin or network leader)',
  })
  getReferrerCeiling(@Param('id', ParseUUIDPipe) id: string) {
    return this.linkRequestService.getReferrerCeiling(id);
  }

  /**
   * PUT /v1/link-requests/:id/set-cpa
   * CPA MANUAL (esportiva-diario): admin OU o convidante define o CPA → request
   * entra na fila do scheduler. Autenticado; o service autoriza admin/convidante.
   */
  @Put('link-requests/:id/set-cpa')
  @ApiOperation({
    summary: 'Set manual CPA (admin or inviter) — esportiva-diario',
  })
  setCpa(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetLinkRequestCpaDto,
  ) {
    return this.linkRequestService.setManualCpa(user, id, dto);
  }

  /**
   * PUT /v1/link-requests/:id  [ADMIN]
   * Approve (fulfilled) or reject a link request.
   * Approval requires at least one link; triggers AffiliateLink sync.
   */
  @Put('link-requests/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: approve or reject a link request' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateLinkRequestDto,
  ) {
    return this.linkRequestService.update(id, user.sub, user.email, dto);
  }

  /**
   * GET /v1/deal-requests
   * Link requests that have a deal associated (dealId NOT NULL).
   * Admin: all. Affiliate: own + direct invitees with a Superbet link.
   */
  @Get('deal-requests')
  @ApiOperation({ summary: 'List deal requests (role-aware)' })
  listDealRequests(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListDealRequestsQueryDto,
  ) {
    return this.linkRequestService.listDealRequests(user, query);
  }

  /**
   * PUT /v1/deal-requests/:id/approve
   * Admin OR the network leader (user who referred the requester).
   * Sets CPA/RevShare on AffiliateLink. Leader limited to their own ceiling.
   */
  @Put('deal-requests/:id/approve')
  @ApiOperation({
    summary: 'Approve or reject a deal request (admin or network leader)',
  })
  approveDealRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ApproveDealRequestDto,
  ) {
    return this.linkRequestService.approveDealRequest(id, user, dto);
  }
}
