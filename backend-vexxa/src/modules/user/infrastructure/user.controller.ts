import {
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  ParseUUIDPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { LinkRequestStatus, UserRole } from '@prisma/client';
import { UserService } from '../application/user.service.js';
import { AffiliateExportService } from '../application/affiliate-export.service.js';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
} from '../../auth/index.js';
import type { JwtPayload } from '../../auth/index.js';
import {
  UpdateBalanceBlockDto,
  GrantWithdrawalReleaseDto,
  UpdateExclusiveDealsDto,
  UpdateApiAccessDto,
  UpdateUserAdminDto,
  UpdateStatusDto,
  UpdateUserPasswordDto,
  UpsertBalanceAdjustmentDto,
} from '../application/dto/update-user.dto.js';
import { UpdateProfileDto } from '../application/dto/update-profile.dto.js';
import { CompleteOnboardingDto } from '../application/dto/complete-onboarding.dto.js';
import { ListUsersDto } from '../application/dto/list-users.dto.js';
import { ListAffiliatesQueryDto } from '../application/dto/list-affiliates-query.dto.js';
import { ExportAffiliatesQueryDto } from '../application/dto/export-affiliates-query.dto.js';
import {
  UserResponseDto,
  PaginatedResponse,
} from '../application/dto/user-response.dto.js';
import {
  AffiliateLinkResponseDto,
  CreateAffiliateLinkDto,
  UpdateAffiliateLinkDto,
} from '../application/dto/affiliate-link.dto.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  DashboardBalanceService,
  DashboardService,
} from '../../dashboard/index.js';
import { buildDateRange } from '../../dashboard/application/dashboard.service.js';
import {
  DashboardQueryDto,
  type FraudDetailDto,
} from '../../dashboard/application/dto/dashboard.dto.js';
import { NetworkService } from '../../network/index.js';
import { NetworkTreeQueryDto } from '../../network/application/dto/network.dto.js';
import { clampPagination } from '../../../common/pagination/index.js';
import { filterLinksForActiveAgreements } from '../application/membership-visibility.js';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller({ version: '1' })
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly affiliateExportService: AffiliateExportService,
    private readonly prisma: PrismaService,
    private readonly dashboardService: DashboardService,
    private readonly balanceService: DashboardBalanceService,
    private readonly networkService: NetworkService,
  ) {}

  // ─── Self-service endpoints ───────────────────────────────────────────────

  @Get('users/me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  getMe(@CurrentUser() user: JwtPayload): Promise<UserResponseDto> {
    return this.userService.findById(user.sub);
  }

  @Patch('users/me')
  @ApiOperation({ summary: 'Update own profile (name, payment info)' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  updateMe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return this.userService.updateProfile(user.sub, dto);
  }

  /**
   * GET /users/me/onboarding/check-cpf?cpf=XXXXXXXXXXX
   * Validates CPF format (Módulo 11) and checks uniqueness in DB.
   * Used for real-time feedback in the frontend before submission.
   */
  @Get('users/me/onboarding/check-cpf')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check CPF validity and availability before onboarding',
  })
  @ApiResponse({ status: 200, schema: { example: { available: true } } })
  checkCpf(
    @Query('cpf') cpf: string,
  ): Promise<{ available: boolean; reason?: string }> {
    return this.userService.checkCpfAvailability(cpf ?? '');
  }

  /**
   * POST /users/me/onboarding
   * Mandatory KYC completion — must be called once after first login.
   * CPF and birthDate are immutable after submission.
   * Underage users (< 18) are auto-blocked.
   */
  @Post('users/me/onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Complete mandatory KYC onboarding (CPF, birth date, WhatsApp, PIX)',
  })
  @ApiResponse({
    status: 200,
    type: UserResponseDto,
    description: 'Onboarding completed',
  })
  @ApiResponse({ status: 400, description: 'Invalid CPF' })
  @ApiResponse({ status: 403, description: 'User is underage (auto-blocked)' })
  @ApiResponse({
    status: 409,
    description: 'Onboarding already completed or CPF already in use',
  })
  completeOnboarding(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CompleteOnboardingDto,
  ): Promise<UserResponseDto> {
    return this.userService.completeOnboarding(user.sub, dto);
  }

  // ─── Memberships (alias sobre affiliate_links, 1 por casa) ───────────────

  /**
   * GET /memberships/mine
   * Returns the current user's affiliate links as "memberships".
   * Each affiliate_link per house = 1 membership object.
   * Used by affiliate profile view.
   */
  @Get('memberships/mine')
  @ApiOperation({
    summary: "Get current user's memberships (affiliate links per house)",
  })
  async getMemberships(@CurrentUser() user: JwtPayload) {
    const [links, fulfilledRequests] = await Promise.all([
      this.prisma.affiliateLink.findMany({
        where: { userId: user.sub },
        select: {
          id: true,
          bettingHouse: true,
          campaignId: true,
          cpa: true,
          revshare: true,
          createdAt: true,
          user: { select: { referralCode: true } },
        },
      }),
      this.prisma.linkRequest.findMany({
        where: {
          userId: user.sub,
          status: LinkRequestStatus.FULFILLED,
        },
        select: {
          bettingHouseSlug: true,
          dealId: true,
          status: true,
          links: true,
          deal: { select: { active: true } },
        },
      }),
    ]);

    const visibleLinks = filterLinksForActiveAgreements(
      links,
      fulfilledRequests,
    );
    const data = visibleLinks.map((l) => ({
      id: l.id,
      bettingHouse: l.bettingHouse,
      campaignId: l.campaignId,
      commissionCpa: l.cpa?.toNumber() ?? 0,
      commissionRevshare: l.revshare?.toNumber() ?? 0,
      referralCode: l.user.referralCode ?? null,
      status: 'approved',
      createdAt: l.createdAt,
    }));

    return { data };
  }

  /**
   * GET /memberships/:id/affiliate-links
   * Returns the affiliate links for a specific membership (= single link record).
   */
  @Get('memberships/:id/affiliate-links')
  @ApiOperation({ summary: 'Get affiliate links for a membership' })
  async getMembershipLinks(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const link = await this.prisma.affiliateLink.findFirst({
      where: { id, userId: user.sub },
      select: {
        id: true,
        bettingHouse: true,
        campaignId: true,
        cpa: true,
        revshare: true,
      },
    });

    if (!link) return { data: [] };

    return {
      data: [
        {
          id: link.id,
          bettingHouse: link.bettingHouse,
          campaignId: link.campaignId,
          cpa: link.cpa?.toNumber() ?? 0,
          revshare: link.revshare?.toNumber() ?? 0,
        },
      ],
    };
  }

  // ─── Admin endpoints ──────────────────────────────────────────────────────

  @Get('admin/users')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List users with filters and cursor pagination' })
  findAll(
    @Query() dto: ListUsersDto,
  ): Promise<PaginatedResponse<UserResponseDto>> {
    return this.userService.findAll(dto);
  }

  /**
   * GET /admin/affiliates?page=1&limit=20&search=...&status=...&bettingHouseId=...
   * Admin paginated affiliates list — alias of /admin/users with affiliate-focused shape.
   * Mirrors legacy GET /users used by useAdminAffiliates composable.
   */
  @Get('admin/affiliates')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: list affiliates with memberships (paginated)',
  })
  async listAffiliates(@Query() query: ListAffiliatesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // ── Build WHERE clause + recursive CTE (shared with export) ──────
    const { depthsCte, whereClause, params, nextParamIdx } =
      this.userService.buildAffiliatesQueryBase(query);
    const paramIdx = nextParamIdx;

    // ── Count (lightweight) ──────────────────────────────────────────
    const countSql = `${depthsCte}
      SELECT COUNT(*)::int AS total
      FROM users u
      LEFT JOIN referral_depths rd ON rd.id = u.id
      WHERE ${whereClause}`;
    const [{ total }] = await this.prisma.$queryRawUnsafe<[{ total: number }]>(
      countSql,
      ...params,
    );

    // ── Single raw SQL: data with LEFT JOIN (no N+1) ─────────────────
    const dataSql = `${depthsCte}
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.status,
        u."ageVerified"    AS "ageVerified",
        u."createdAt"      AS "createdAt",
        COALESCE(rd.depth, CASE WHEN u."referredById" IS NULL THEN 0 ELSE NULL END) AS "referralDepth",
        -- referrer basic info (single LEFT JOIN)
        CASE WHEN r.id IS NOT NULL
             THEN jsonb_build_object('id', r.id, 'name', r.name, 'email', r.email)
             ELSE NULL
        END AS "referredBy",
        -- affiliate links aggregated as JSON array (no N+1)
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'id',            al.id,
            'bettingHouse',  al."bettingHouse",
            'campaignId',    al."campaignId",
            'cpa',           al.cpa,
            'revshare',      al.revshare
          )) FROM affiliate_links al WHERE al."userId" = u.id),
          '[]'::jsonb
        ) AS "links",
        -- referrer's affiliate links (for approval modal — eliminates separate API call)
        COALESCE(
          (SELECT jsonb_agg(jsonb_build_object(
            'bettingHouse',  ral."bettingHouse",
            'houseName',     COALESCE(rbh.name, ral."bettingHouse"),
            'cpa',           ral.cpa,
            'revshare',      ral.revshare
          ))
          FROM affiliate_links ral
          LEFT JOIN betting_houses rbh ON rbh.slug = ral."bettingHouse"
          WHERE ral."userId" = u."referredById"),
          '[]'::jsonb
        ) AS "referrerLinks"
      FROM users u
      LEFT JOIN referral_depths rd ON rd.id = u.id
      LEFT JOIN users r ON r.id = u."referredById"
      WHERE ${whereClause}
      ORDER BY u."createdAt" DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        name: string;
        email: string;
        role: string;
        status: string;
        ageVerified: boolean;
        createdAt: Date;
        referredBy: { id: string; name: string; email: string } | null;
        links: Array<{
          id: string;
          bettingHouse: string;
          campaignId: string;
          cpa: number | null;
          revshare: number | null;
        }>;
        referrerLinks: Array<{
          bettingHouse: string;
          houseName: string;
          cpa: number | null;
          revshare: number | null;
        }>;
        referralDepth: number | null;
      }>
    >(dataSql, ...params, limit, skip);

    const data = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      ageVerified: u.ageVerified,
      createdAt: u.createdAt,
      referredBy: u.referredBy,
      referralDepth: u.referralDepth,
      referralOriginLabel: this.userService.referralOriginLabel(
        u.referralDepth,
      ),
      // referrerLinks: pre-fetched for the approval modal — no extra API call needed
      referrerLinks: (u.referrerLinks ?? []).map((rl) => ({
        bettingHouse: rl.bettingHouse,
        houseName: rl.houseName,
        cpa: Number(rl.cpa ?? 0),
        revshare: Number(rl.revshare ?? 0),
      })),
      memberships: (u.links ?? []).map((l) => ({
        id: l.id,
        bettingHouse: l.bettingHouse,
        campaignId: l.campaignId,
        commissionCpa: Number(l.cpa ?? 0),
        commissionRevshare: Number(l.revshare ?? 0),
        status: 'approved',
      })),
    }));

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * GET /admin/affiliates/export?format=csv|pdf&search=&status=&role=&referralDepth=&bettingHouseId=&noLink=
   * Exports the affiliates matching the active filters as CSV or PDF.
   * Same filters as `listAffiliates` (minus pagination); default format `csv`.
   */
  @Get('admin/affiliates/export')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: export filtered affiliates as CSV or PDF' })
  async exportAffiliates(
    @Query() query: ExportAffiliatesQueryDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<StreamableFile> {
    const format = query.format ?? 'csv';
    const file = await this.affiliateExportService.export(
      {
        search: query.search,
        role: query.role,
        status: query.status,
        bettingHouseId: query.bettingHouseId,
        noLink: query.noLink,
        referralDepth: query.referralDepth,
      },
      format,
    );

    const baseName = AffiliateExportService.fileBaseName();
    if (format === 'pdf') {
      res.header('Content-Type', 'application/pdf');
      res.header(
        'Content-Disposition',
        `attachment; filename="${baseName}.pdf"`,
      );
    } else {
      res.header('Content-Type', 'text/csv');
      res.header(
        'Content-Disposition',
        `attachment; filename="${baseName}.csv"`,
      );
    }
    return file;
  }

  /**
   * GET /admin/affiliates/kpis
   * Returns aggregate counters used by the admin dashboard.
   *
   * Existing fields (preserved for backward compatibility):
   *   total, pending, approved, noLink — user counts.
   *
   * Additional read-only aggregates (do NOT modify any balance/commission formula):
   *   ftdsMonth — sum of `ftds` from AffiliateData since the start of the current month.
   *   withdrawalVolumeMonth — sum of `amount` from WithdrawalRequest since the start of the current month.
   *   withdrawalsPendingCount — count of pending withdrawal requests (UI alert badge).
   *   linkRequestsPendingCount — count of pending link requests.
   */
  @Get('admin/affiliates/kpis')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: affiliate KPI counters' })
  async affiliateKpis() {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // Single query for all user counts (avoids 4 separate round-trips)
    const [userCounts] = await this.prisma.$queryRaw<
      Array<{
        total: bigint;
        pending: bigint;
        approved: bigint;
        with_link: bigint;
      }>
    >`
      SELECT
        COUNT(*)                                                       AS total,
        COUNT(*) FILTER (WHERE u.status = 'PENDING')                  AS pending,
        COUNT(*) FILTER (WHERE u.status = 'APPROVED')                 AS approved,
        COUNT(DISTINCT al."userId")                                    AS with_link
      FROM users u
      LEFT JOIN affiliate_links al ON al."userId" = u.id
      WHERE u."deletedAt" IS NULL
    `;

    const [
      ftdsAgg,
      withdrawalVolumeAgg,
      withdrawalsPendingCount,
      linkRequestsPendingCount,
    ] = await Promise.all([
      this.prisma.affiliateData.aggregate({
        _sum: { ftds: true },
        where: { date: { gte: monthStart } },
      }),
      this.prisma.withdrawalRequest.aggregate({
        _sum: { amount: true },
        where: { createdAt: { gte: monthStart } },
      }),
      this.prisma.withdrawalRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.linkRequest.count({ where: { status: 'PENDING' } }),
    ]);

    const total = Number(userCounts.total);
    const pending = Number(userCounts.pending);
    const approved = Number(userCounts.approved);
    const noLink = total - Number(userCounts.with_link);

    return {
      data: {
        total,
        pending,
        approved,
        noLink,
        ftdsMonth: ftdsAgg._sum.ftds ?? 0,
        withdrawalVolumeMonth: withdrawalVolumeAgg._sum.amount?.toNumber() ?? 0,
        withdrawalsPendingCount,
        linkRequestsPendingCount,
      },
    };
  }

  /**
   * GET /admin/affiliates/chart
   * Returns 30-day daily breakdown of FTDs and withdrawal volume.
   * Used by the admin dashboard dual-axis chart.
   */
  @Get('admin/affiliates/chart')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: 30-day daily FTDs and withdrawal volume' })
  async affiliateChart() {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const from = new Date();
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);

    // Build a map of date → { ftds, withdrawalVolume }
    const dayMap = new Map<
      string,
      { ftds: number; withdrawalVolume: number }
    >();
    for (let d = new Date(from); d <= today; d.setDate(d.getDate() + 1)) {
      dayMap.set(d.toISOString().slice(0, 10), {
        ftds: 0,
        withdrawalVolume: 0,
      });
    }

    const [ftdRows, withdrawalRows] = await Promise.all([
      // affiliate_data.date is @db.Date — groupBy works correctly
      this.prisma.affiliateData.groupBy({
        by: ['date'],
        _sum: { ftds: true },
        where: { date: { gte: from, lte: today } },
        orderBy: { date: 'asc' },
      }),
      // withdrawal_requests.createdAt is DateTime — use raw SQL for day truncation
      this.prisma.$queryRaw<Array<{ day: Date; total: string }>>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, SUM(amount) AS total
        FROM withdrawal_requests
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${today}
          AND status = 'APPROVED'
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    for (const row of ftdRows) {
      const key = new Date(row.date).toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      if (entry) entry.ftds = row._sum.ftds ?? 0;
    }
    for (const row of withdrawalRows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      if (entry)
        entry.withdrawalVolume = Math.round(parseFloat(row.total) * 100) / 100;
    }

    const data = Array.from(dayMap.entries()).map(([date, v]) => ({
      date,
      ftds: v.ftds,
      withdrawalVolume: v.withdrawalVolume,
    }));

    return { data };
  }

  /**
   * GET /admin/dashboard
   * Consolidated endpoint — returns ALL data the admin dashboard needs in a
   * single HTTP round-trip. Queries are serialized in phases to avoid
   * saturating the PostgreSQL connection pool (which caused cascading
   * timeouts when 7 parallel requests each ran their own Promise.all).
   */
  @Get('admin/dashboard')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: full dashboard payload (consolidated)' })
  async adminDashboard(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    // Intervalo custom (De/Até) opcional; ausente ⇒ comportamento padrão.
    const custom = this.parseAdminDateRange(startDate, endDate);

    // Todos os limites são âncoras em UTC (00:00) com fronteira superior
    // EXCLUSIVA (< dia seguinte). Isso evita o off-by-one ao comparar a coluna
    // `date` (sem fuso) com um timestamp de fim-de-dia local.
    const now = new Date();
    const todayUtc = new Date(
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
    );
    const nextDay = (d: Date): Date => {
      const x = new Date(d);
      x.setUTCDate(x.getUTCDate() + 1);
      return x;
    };

    // Janela dos KPIs de período e do gráfico.
    let kpiFrom: Date;
    let kpiEndIncl: Date;
    let chartFrom: Date;
    let chartEndIncl: Date;
    if (custom) {
      // Custom: KPIs e gráfico usam o mesmo intervalo.
      kpiFrom = chartFrom = new Date(`${custom.lo}T00:00:00.000Z`);
      kpiEndIncl = chartEndIncl = new Date(`${custom.hi}T00:00:00.000Z`);
    } else {
      // Default: KPIs = mês corrente; gráfico = últimos 30 dias.
      kpiFrom = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      kpiEndIncl = todayUtc;
      chartFrom = new Date(todayUtc);
      chartFrom.setUTCDate(chartFrom.getUTCDate() - 29);
      chartEndIncl = todayUtc;
    }
    const kpiEndExcl = nextDay(kpiEndIncl);
    const chartEndExcl = nextDay(chartEndIncl);
    // Alias mantidos para as queries do gráfico (loop usa o fim inclusivo).
    const chartTo = chartEndIncl;

    // ── Phase 1: Single raw SQL for all KPIs + pending counts ──────────────
    const [kpiRow] = await this.prisma.$queryRaw<
      Array<{
        total_users: bigint;
        pending_users: bigint;
        approved_users: bigint;
        users_with_link: bigint;
        cpa_month: string;
        cpa_count_month: bigint;
        withdrawal_volume_month: string;
        withdrawals_pending: bigint;
        link_requests_pending: bigint;
      }>
    >`
      SELECT
        COUNT(*)                                       AS total_users,
        COUNT(*) FILTER (WHERE u.status = 'PENDING')  AS pending_users,
        COUNT(*) FILTER (WHERE u.status = 'APPROVED') AS approved_users,
        COUNT(DISTINCT al."userId")                    AS users_with_link,
        (SELECT COALESCE(SUM("cpaValue"), 0) FROM affiliate_data  WHERE date >= ${kpiFrom} AND date < ${kpiEndExcl})       AS cpa_month,
        (SELECT COALESCE(SUM("cpaQualified"), 0) FROM affiliate_data WHERE date >= ${kpiFrom} AND date < ${kpiEndExcl})     AS cpa_count_month,
        (SELECT COALESCE(SUM(amount), 0) FROM withdrawal_requests WHERE "createdAt" >= ${kpiFrom} AND "createdAt" < ${kpiEndExcl})  AS withdrawal_volume_month,
        (SELECT COUNT(*)                 FROM withdrawal_requests WHERE status = 'PENDING')            AS withdrawals_pending,
        (SELECT COUNT(*)                 FROM link_requests       WHERE status = 'PENDING')            AS link_requests_pending
      FROM users u
      LEFT JOIN affiliate_links al ON al."userId" = u.id
      WHERE u."deletedAt" IS NULL
    `;

    const totalUsers = Number(kpiRow.total_users);
    const kpis = {
      total: totalUsers,
      pending: Number(kpiRow.pending_users),
      approved: Number(kpiRow.approved_users),
      noLink: totalUsers - Number(kpiRow.users_with_link),
      cpaMonth: Math.round(parseFloat(kpiRow.cpa_month) * 100) / 100,
      cpaCountMonth: Number(kpiRow.cpa_count_month),
      withdrawalVolumeMonth:
        Math.round(parseFloat(kpiRow.withdrawal_volume_month) * 100) / 100,
      withdrawalsPendingCount: Number(kpiRow.withdrawals_pending),
      linkRequestsPendingCount: Number(kpiRow.link_requests_pending),
    };

    // ── Phase 2: List queries (serialized — 1 Promise.all, small batch) ────
    const [
      pendingWithdrawals,
      pendingByHouseRaw,
      auditRows,
      syncRows,
      cpaByHouseRaw,
    ] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where: { status: 'PENDING' },
        include: {
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.linkRequest.groupBy({
        by: ['bettingHouseSlug'],
        where: { status: 'PENDING' },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.syncLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      // CPA por casa (mês corrente) — valor monetário somado por casa.
      this.prisma.affiliateData.groupBy({
        by: ['bettingHouse'],
        _sum: { cpaValue: true },
        where: { date: { gte: kpiFrom, lt: kpiEndExcl } },
        orderBy: { _sum: { cpaValue: 'desc' } },
      }),
    ]);

    // Resolve house names/logos for pending-by-house
    let pendingByHouse: Array<{
      slug: string;
      houseName: string;
      logoUrl: string | null;
      pendingCount: number;
    }> = [];
    if (pendingByHouseRaw.length) {
      const slugs = pendingByHouseRaw.map((g) => g.bettingHouseSlug);
      const houses = await this.prisma.bettingHouse.findMany({
        where: { slug: { in: slugs } },
        select: { slug: true, name: true, logoUrl: true },
      });
      const houseMap = new Map(houses.map((h) => [h.slug, h]));
      pendingByHouse = pendingByHouseRaw.map((g) => {
        const house = houseMap.get(g.bettingHouseSlug);
        return {
          slug: g.bettingHouseSlug,
          houseName: house?.name ?? g.bettingHouseSlug,
          logoUrl: house?.logoUrl ?? null,
          pendingCount: g._count.id,
        };
      });
    }

    // CPA por casa (mês corrente) — resolve nomes/logos das casas.
    let cpaByHouse: Array<{
      slug: string;
      houseName: string;
      logoUrl: string | null;
      cpa: number;
    }> = [];
    if (cpaByHouseRaw.length) {
      const slugs = cpaByHouseRaw.map((g) => g.bettingHouse);
      const houses = await this.prisma.bettingHouse.findMany({
        where: { slug: { in: slugs } },
        select: { slug: true, name: true, logoUrl: true },
      });
      const houseMap = new Map(houses.map((h) => [h.slug, h]));
      cpaByHouse = cpaByHouseRaw
        .map((g) => {
          const house = houseMap.get(g.bettingHouse);
          return {
            slug: g.bettingHouse,
            houseName: house?.name ?? g.bettingHouse,
            logoUrl: house?.logoUrl ?? null,
            cpa: Math.round((g._sum.cpaValue?.toNumber() ?? 0) * 100) / 100,
          };
        })
        .filter((h) => h.cpa > 0);
    }

    // ── Phase 3: Chart data (30-day, 2 queries) ───────────────────────────
    const [ftdRows, withdrawalRows] = await Promise.all([
      this.prisma.affiliateData.groupBy({
        by: ['date'],
        _sum: { cpaValue: true },
        where: { date: { gte: chartFrom, lt: chartEndExcl } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; total: string }>>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, SUM(amount) AS total
        FROM withdrawal_requests
        WHERE "createdAt" >= ${chartFrom} AND "createdAt" < ${chartEndExcl}
          AND status = 'APPROVED'
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    // Build chart day-map
    const dayMap = new Map<string, { cpa: number; withdrawalVolume: number }>();
    for (
      let d = new Date(chartFrom);
      d <= chartTo;
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      dayMap.set(d.toISOString().slice(0, 10), {
        cpa: 0,
        withdrawalVolume: 0,
      });
    }
    for (const row of ftdRows) {
      const key = new Date(row.date).toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      if (entry) entry.cpa = row._sum.cpaValue?.toNumber() ?? 0;
    }
    for (const row of withdrawalRows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      const entry = dayMap.get(key);
      if (entry)
        entry.withdrawalVolume = Math.round(parseFloat(row.total) * 100) / 100;
    }
    const chart = Array.from(dayMap.entries()).map(([date, v]) => ({
      date,
      cpa: v.cpa,
      withdrawalVolume: v.withdrawalVolume,
    }));

    // ── Response ────────────────────────────────────────────────────────────
    return {
      kpis,
      withdrawals: pendingWithdrawals.map((w) => ({
        id: w.id,
        userName: w.user.name,
        userEmail: w.user.email,
        amount: w.amount.toNumber(),
        originalAmount: w.originalAmount.toNumber(),
        status: w.status,
        createdAt: w.createdAt,
      })),
      pendingByHouse,
      cpaByHouse,
      auditLogs: auditRows,
      syncLogs: syncRows,
      chart,
    };
  }

  /**
   * Parses `startDate`/`endDate` (YYYY-MM-DD) into a day-bounded range for the
   * admin dashboard. Returns null when absent or malformed (⇒ default window).
   * Swaps the bounds if the client sends them inverted.
   */
  private parseAdminDateRange(
    startDate?: string,
    endDate?: string,
  ): { lo: string; hi: string } | null {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!startDate || !endDate || !re.test(startDate) || !re.test(endDate)) {
      return null;
    }
    // Rejeita datas sintaticamente válidas mas inexistentes (ex.: 2026-02-31).
    if (
      Number.isNaN(Date.parse(`${startDate}T00:00:00Z`)) ||
      Number.isNaN(Date.parse(`${endDate}T00:00:00Z`))
    ) {
      return null;
    }
    // Ordena (troca se vier invertido).
    const [lo, hi] =
      startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
    return { lo, hi };
  }

  @Get('admin/affiliates/:id/profile')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: get affiliate profile with sensitive personal data',
  })
  getAffiliateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.userService.getAdminAffiliateProfile(id, admin.sub);
  }

  @Patch('admin/affiliates/:id/balance-block')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: block or unblock withdrawals for one affiliate',
  })
  updateAffiliateBalanceBlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBalanceBlockDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.userService.updateBalanceBlock(id, admin.sub, dto);
  }

  @Post('admin/affiliates/:id/withdrawal-release')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: libera 1 saque extra por casa no dia atual',
  })
  grantAffiliateWithdrawalRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantWithdrawalReleaseDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.userService.grantWithdrawalRelease(id, admin.sub, dto);
  }

  @Patch('admin/affiliates/:id/exclusive-deals')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: liga/desliga acesso a deals exclusivas para um afiliado',
  })
  updateAffiliateExclusiveDeals(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExclusiveDealsDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.userService.updateExclusiveDealsAccess(id, admin.sub, dto);
  }

  @Patch('admin/affiliates/:id/api-access')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: libera/bloqueia acesso às features de API e Webhook',
  })
  updateAffiliateApiAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApiAccessDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.userService.updateApiAccess(id, admin.sub, dto);
  }

  @Get('admin/affiliates/:id/balance-adjustments')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: lista os ajustes de saldo (por casa) de um afiliado',
  })
  listAffiliateBalanceAdjustments(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.listBalanceAdjustments(id);
  }

  @Put('admin/affiliates/:id/balance-adjustments')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Admin: define o ajuste de saldo por casa (SET; negativo abate do saldo)',
  })
  upsertAffiliateBalanceAdjustment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertBalanceAdjustmentDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    return this.userService.upsertBalanceAdjustment(id, admin.sub, dto);
  }

  @Get('admin/affiliates/:id/dashboard/filters')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getAffiliateDashboardFilters(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: Pick<DashboardQueryDto, 'bettingHouse' | 'affiliateName'>,
  ) {
    return this.dashboardService.getFilters(this.asAffiliatePayload(id), query);
  }

  @Get('admin/affiliates/:id/dashboard/summary')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getAffiliateDashboardSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getSummary(this.asAffiliatePayload(id), query);
  }

  @Get('admin/affiliates/:id/dashboard/daily')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getAffiliateDashboardDaily(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getDaily(this.asAffiliatePayload(id), query);
  }

  @Get('admin/affiliates/:id/dashboard/balance')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getAffiliateDashboardBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query()
    query: Pick<DashboardQueryDto, 'startDate' | 'endDate' | 'bettingHouse'>,
  ) {
    return this.balanceService.getBalance(this.asAffiliatePayload(id), query);
  }

  @Get('admin/affiliates/:id/dashboard/campaigns')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getAffiliateDashboardCampaigns(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getCampaigns(
      this.asAffiliatePayload(id),
      query,
    );
  }

  @Get('admin/affiliates/:id/dashboard/daily-per-house')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getAffiliateDailyPerHouse(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getDailyPerHouse(
      this.asAffiliatePayload(id),
      query,
    );
  }

  @Get('admin/affiliates/:id/dashboard/links-performance')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getAffiliateLinksPerformance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DashboardQueryDto,
  ) {
    return this.getLinksPerformanceForAffiliate(id, query);
  }

  @Get('admin/affiliates/:id/dashboard/fraud-details')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAffiliateFraudDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @Query()
    query: Pick<DashboardQueryDto, 'startDate' | 'endDate' | 'bettingHouse'>,
  ) {
    const balance = await this.balanceService.getBalance(
      this.asAffiliatePayload(id),
      query,
    );
    const directFrauds = balance.fraudDetails.filter(
      (f: FraudDetailDto) => f.source === 'direct',
    );
    const networkFrauds = balance.fraudDetails.filter(
      (f: FraudDetailDto) => f.source === 'network',
    );
    return {
      directFrauds,
      networkFrauds,
      totalDirect: directFrauds.reduce(
        (s: number, f: FraudDetailDto) => s + f.deduction,
        0,
      ),
      totalNetwork: networkFrauds.reduce(
        (s: number, f: FraudDetailDto) => s + f.deduction,
        0,
      ),
      totalDeduction: balance.totalFraudDeduction,
    };
  }

  @Get('admin/affiliates/:id/network')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getAffiliateNetwork(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: NetworkTreeQueryDto,
  ) {
    return this.networkService.getTree(id, query);
  }

  @Get('admin/affiliates/:id/referral-origin')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: referral upline chain and depth from panel root',
  })
  getAffiliateReferralOrigin(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.getAdminAffiliateReferralOrigin(id);
  }

  @Get('admin/affiliates/:id/fraud-logs')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'List fraud logs and current counts for an affiliate',
  })
  async getAffiliateFraudLogs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('bettingHouse') bettingHouse?: string,
  ) {
    const {
      page: p,
      limit: take,
      skip,
    } = clampPagination(
      { page: parseInt(page, 10) || 1, limit: parseInt(limit, 10) || 10 },
      { defaultLimit: 10, maxLimit: 100 },
    );

    // Get full fraud breakdown (direct + network) via balance service.
    // This mirrors how the dashboard computes fraudDeduction.
    const balance = await this.balanceService.getBalance(
      this.asAffiliatePayload(id),
      bettingHouse ? { bettingHouse } : {},
    );
    const directFrauds = balance.fraudDetails.filter(
      (f: FraudDetailDto) => f.source === 'direct',
    );
    const networkFrauds = balance.fraudDetails.filter(
      (f: FraudDetailDto) => f.source === 'network',
    );

    // Collect all referred user IDs (L1 → L3) so logs include network changes.
    const l1 = await this.prisma.user.findMany({
      where: { referredById: id },
      select: { id: true },
    });
    const l1Ids = l1.map((u) => u.id);
    const l2 = l1Ids.length
      ? await this.prisma.user.findMany({
          where: { referredById: { in: l1Ids } },
          select: { id: true },
        })
      : [];
    const l2Ids = l2.map((u) => u.id);
    const l3 = l2Ids.length
      ? await this.prisma.user.findMany({
          where: { referredById: { in: l2Ids } },
          select: { id: true },
        })
      : [];
    const l3Ids = l3.map((u) => u.id);
    const networkIds = [...l1Ids, ...l2Ids, ...l3Ids];
    const allUserIds = [id, ...networkIds];

    const logsWhere: Record<string, any> = { userId: { in: allUserIds } };
    if (bettingHouse) logsWhere.bettingHouse = bettingHouse;

    const [logs, logsTotal] = await Promise.all([
      this.prisma.fraudLog.findMany({
        where: logsWhere,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          userId: true,
          bettingHouse: true,
          oldCount: true,
          newCount: true,
          reason: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          changedBy: { select: { name: true, email: true } },
        },
      }),
      this.prisma.fraudLog.count({ where: logsWhere }),
    ]);

    return {
      directFrauds,
      networkFrauds,
      totalDirectDeduction: balance.fraudDeduction,
      totalNetworkDeduction: balance.networkFraudDeduction,
      totalDeduction: balance.totalFraudDeduction,
      logs,
      logsTotal,
      logsPage: p,
      logsLimit: take,
    };
  }

  @Get('admin/users/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.userService.findById(id);
  }

  @Patch('admin/users/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update user (admin fields)' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserAdminDto,
  ): Promise<UserResponseDto> {
    return this.userService.update(id, dto);
  }

  @Patch('admin/users/:id/password')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Admin: change user password and revoke active refresh tokens',
  })
  @ApiResponse({ status: 204, description: 'Password changed' })
  updatePassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserPasswordDto,
    @CurrentUser() admin: JwtPayload,
  ): Promise<void> {
    return this.userService.updatePassword(id, admin.sub, dto);
  }

  @Patch('admin/users/:id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update user status (generates AuditLog)' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() admin: JwtPayload,
  ): Promise<UserResponseDto> {
    return this.userService.updateStatus(id, dto, admin.sub);
  }

  /**
   * GET /admin/users/:id/referrer-links
   * Returns affiliate links of the user's referrer (the person who invited them).
   * Used by the approval modal to show which agreements can be inherited.
   */
  @Get('admin/users/:id/referrer-links')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Get referrer's affiliate links for approval modal",
  })
  getReferrerLinks(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.getReferrerLinks(id);
  }

  /**
   * PATCH /users/:id/approve
   * Allows the referrer (non-admin affiliate) to approve/reject their direct invitees.
   * Also supports admin usage. Validates referrer ceiling on CPA/RevShare.
   */
  @Patch('users/:id/approve')
  @ApiOperation({
    summary: 'Approve or reject a direct invitee (referrer or admin)',
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  approveByReferrer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<UserResponseDto> {
    // If admin, delegate to the admin updateStatus path
    if (user.role === 'ADMIN') {
      return this.userService.updateStatus(id, dto, user.sub);
    }
    return this.userService.approveByReferrer(id, user.sub, dto);
  }

  /**
   * GET /users/:id/referrer-links
   * Returns the referrer's affiliate links for the approval modal (affiliate view).
   * F3: Only the target user or their direct referrer may call this.
   */
  @Get('users/:id/referrer-links')
  @ApiOperation({ summary: "Get referrer's affiliate links (affiliate view)" })
  async getReferrerLinksPublic(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: JwtPayload,
  ) {
    // Admins pass through freely
    if (caller.role === 'ADMIN') return this.userService.getReferrerLinks(id);

    // For affiliates: only the target user or their direct referrer may read this
    await this.userService.assertReferrerLinksAccess(id, caller.sub);
    return this.userService.getReferrerLinks(id);
  }

  /**
   * POST /users/:id/block
   * Blocks a user from the platform, preventing login.
   * Callable by admin (any user) or by the user's direct referrer.
   */
  @Post('users/:id/block')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block a user (admin or direct referrer)' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 403, description: 'Not the direct referrer' })
  @ApiResponse({ status: 409, description: 'User is already blocked' })
  blockUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: JwtPayload,
  ): Promise<UserResponseDto> {
    return this.userService.blockUser(id, caller.sub, caller.role === 'ADMIN');
  }

  /**
   * POST /admin/users/:id/block
   * Admin-only shortcut — same semantics as /users/:id/block with isAdmin=true.
   */
  @Post('admin/users/:id/block')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: block any user' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 409, description: 'User is already blocked' })
  blockUserAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: JwtPayload,
  ): Promise<UserResponseDto> {
    return this.userService.blockUser(id, admin.sub, true);
  }

  /**
   * POST /admin/users/:id/unblock
   * Admin-only — restores a blocked user to APPROVED + active.
   */
  @Post('admin/users/:id/unblock')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: unblock a previously blocked user' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 409, description: 'User is not blocked' })
  unblockUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: JwtPayload,
  ): Promise<UserResponseDto> {
    return this.userService.unblockUser(id, admin.sub);
  }

  // ─── AffiliateLink sub-resource (admin) ───────────────────────────────────

  @Get('admin/users/:id/affiliate-links')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "List user's affiliate links (per-house commission rates)",
  })
  getAffiliateLinks(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AffiliateLinkResponseDto[]> {
    return this.userService.getAffiliateLinks(id); // fix H05: mapping moved to service
  }

  @Post('admin/users/:id/affiliate-links')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create affiliate link for a house' })
  @ApiResponse({ status: 201, type: AffiliateLinkResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Campaign already registered for this house',
  })
  createAffiliateLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAffiliateLinkDto,
  ): Promise<AffiliateLinkResponseDto> {
    return this.userService.createAffiliateLink(id, dto);
  }

  @Patch('admin/users/:id/affiliate-links/:linkId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update affiliate link rates' })
  @ApiResponse({ status: 200, type: AffiliateLinkResponseDto })
  updateAffiliateLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() dto: UpdateAffiliateLinkDto,
  ): Promise<AffiliateLinkResponseDto> {
    return this.userService.updateAffiliateLink(id, linkId, dto);
  }

  @Delete('admin/users/:id/affiliate-links/:linkId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove affiliate link' })
  deleteAffiliateLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ): Promise<void> {
    return this.userService.deleteAffiliateLink(id, linkId);
  }

  private asAffiliatePayload(id: string): JwtPayload {
    return { sub: id, email: '', role: UserRole.AFFILIATE };
  }

  private async getLinksPerformanceForAffiliate(
    id: string,
    query: DashboardQueryDto,
  ) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id },
      select: {
        affiliateLinks: {
          where: { deletedAt: null },
          select: {
            campaignId: true,
            bettingHouse: true,
            cpa: true,
            revshare: true,
          },
        },
      },
    });

    if (!dbUser || dbUser.affiliateLinks.length === 0) return { data: [] };

    const links = dbUser.affiliateLinks.filter((l) => {
      if (query.bettingHouse && l.bettingHouse !== query.bettingHouse)
        return false;
      return true;
    });
    if (links.length === 0) return { data: [] };

    const { startDate, endDate } = buildDateRange(
      query.startDate,
      query.endDate,
    );
    const auditExclusion = await this.dashboardService.loadAuditExclusion();

    const agg = await this.prisma.affiliateData.groupBy({
      by: ['campaignId', 'bettingHouse'],
      where: {
        campaignId: { in: links.map((l) => l.campaignId) },
        date: { gte: startDate, lte: endDate },
        ...(query.bettingHouse ? { bettingHouse: query.bettingHouse } : {}),
        ...(query.campaignName ? { campaignName: query.campaignName } : {}),
        ...(query.utmCampaign ? { utmCampaign: query.utmCampaign } : {}),
        ...(auditExclusion
          ? {
              NOT: {
                date: {
                  gte: auditExclusion.startDate,
                  lt: auditExclusion.endDate,
                },
              },
            }
          : {}),
      },
      _sum: {
        clicks: true,
        registrations: true,
        ftds: true,
        qftd: true,
        deposit: true,
        volume: true,
        revShare: true,
        cpaValue: true,
        cpaQualified: true,
        totalCommission: true,
      },
    });

    const aggMap = new Map(
      agg.map((r) => [`${r.campaignId}__${r.bettingHouse}`, r]),
    );
    const data = links.map((link) => {
      const row = aggMap.get(`${link.campaignId}__${link.bettingHouse}`);
      const cpaRate = link.cpa?.toNumber() ?? 0;
      const revRate = link.revshare?.toNumber() ?? 0;
      const qftd = row?._sum.cpaQualified ?? 0;
      const revShare = row?._sum.revShare?.toNumber() ?? 0;
      const myCpa = cpaRate * qftd;
      const myRev = (revRate / 100) * revShare;

      return {
        key: `${link.bettingHouse}||${link.campaignId}`,
        bettingHouse: link.bettingHouse,
        campaignId: link.campaignId,
        cpaRate,
        revRate,
        myCpa,
        myRev,
        myCommission: myCpa + myRev,
        clicks: row?._sum.clicks ?? 0,
        registrations: row?._sum.registrations ?? 0,
        ftds: row?._sum.ftds ?? 0,
        qftd,
        deposit: row?._sum.deposit?.toNumber() ?? 0,
        volume: row?._sum.volume?.toNumber() ?? 0,
        revShare,
        cpaValue: row?._sum.cpaValue?.toNumber() ?? 0,
        cpaQualified: qftd,
        totalCommission: row?._sum.totalCommission?.toNumber() ?? 0,
      };
    });

    return { data: data.sort((a, b) => b.myCommission - a.myCommission) };
  }
}
