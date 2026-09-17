import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Prisma, UserRole } from '@prisma/client';
import { clampPagination } from '../../../common/pagination/index.js';
import { JwtAuthGuard, RolesGuard, Roles } from '../../auth/index.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LinkWebhookService } from '../../link-webhook/index.js';

@ApiTags('Admin Ops')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminOpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkWebhook: LinkWebhookService,
  ) {}

  // ─── Betting Houses CRUD ──────────────────────────────────────────────────

  // Cutover POR CASA fica em settings (`ledger_cutover_date_<slug>`), não em
  // betting_houses. Expomos/gravamos junto da casa para o admin configurar.
  private cutoverKey(slug: string): string {
    return `ledger_cutover_date_${slug}`;
  }

  // Cutover de SALDO por casa (`balance_cutover_date_<slug>`) — independente do
  // cutover de sync. Vazio = sem cutover (conta o ano todo).
  private balanceCutoverKey(slug: string): string {
    return `balance_cutover_date_${slug}`;
  }

  @Get('houses')
  @ApiOperation({ summary: 'List all betting houses' })
  async listHouses() {
    const houses = await this.prisma.bettingHouse.findMany({
      orderBy: { name: 'asc' },
    });
    const cutRows = await this.prisma.setting.findMany({
      where: {
        OR: [
          { key: { startsWith: 'ledger_cutover_date_' } },
          { key: { startsWith: 'balance_cutover_date_' } },
        ],
      },
      select: { key: true, value: true },
    });
    const syncMap = new Map<string, string>();
    const balMap = new Map<string, string>();
    for (const r of cutRows) {
      if (r.key.startsWith('ledger_cutover_date_'))
        syncMap.set(r.key.slice('ledger_cutover_date_'.length), r.value);
      else if (r.key.startsWith('balance_cutover_date_'))
        balMap.set(r.key.slice('balance_cutover_date_'.length), r.value);
    }
    return {
      data: houses.map((h) => ({
        ...h,
        cutoverDate: syncMap.get(h.slug) ?? null,
        balanceCutoverDate: balMap.get(h.slug) ?? null,
      })),
    };
  }

  @Get('houses/:id')
  @ApiOperation({ summary: 'Get betting house by ID' })
  async getHouse(@Param('id') id: string) {
    const house = await this.prisma.bettingHouse.findUnique({ where: { id } });
    if (!house) throw new NotFoundException('Casa não encontrada.');
    const [cut, balCut] = await Promise.all([
      this.prisma.setting.findUnique({
        where: { key: this.cutoverKey(house.slug) },
        select: { value: true },
      }),
      this.prisma.setting.findUnique({
        where: { key: this.balanceCutoverKey(house.slug) },
        select: { value: true },
      }),
    ]);
    return {
      ...house,
      cutoverDate: cut?.value ?? null,
      balanceCutoverDate: balCut?.value ?? null,
    };
  }

  @Post('houses')
  @ApiOperation({ summary: 'Create betting house' })
  async createHouse(
    @Body()
    body: {
      name: string;
      slug: string;
      apiBaseURL?: string;
      apiBasePath?: string;
      apiKey?: string;
      logoUrl?: string;
      syncSchedule?: string;
      syncMode?: string;
      withdrawalDay?: number;
      withdrawalDayEnd?: number;
      withdrawalDay2?: number;
      withdrawalDay2End?: number;
      withdrawalWeekday?: number;
      minCpaToWithdraw?: number;
      minAvgDepositPerCpa?: number;
      minWithdrawalAmount?: number;
      withdrawalEnabled?: boolean;
    },
  ) {
    const house = await this.prisma.bettingHouse.create({
      data: {
        name: body.name,
        slug: body.slug.toLowerCase(),
        apiBaseURL: body.apiBaseURL ?? '',
        apiBasePath: body.apiBasePath ?? '/api/v1',
        apiKey: body.apiKey ?? '',
        logoUrl: body.logoUrl ?? '',
        syncSchedule: body.syncSchedule ?? '0 */2 * * *',
        syncMode: (body.syncMode as any) ?? 'AUTO',
        withdrawalDay: body.withdrawalDay ?? null,
        withdrawalDayEnd: body.withdrawalDayEnd ?? null,
        withdrawalDay2: body.withdrawalDay2 ?? null,
        withdrawalDay2End: body.withdrawalDay2End ?? null,
        withdrawalWeekday: body.withdrawalWeekday ?? null,
        minCpaToWithdraw: body.minCpaToWithdraw ?? 0,
        ...(body.minAvgDepositPerCpa !== undefined
          ? { minAvgDepositPerCpa: body.minAvgDepositPerCpa }
          : {}),
        ...(body.minWithdrawalAmount !== undefined
          ? { minWithdrawalAmount: body.minWithdrawalAmount }
          : {}),
        withdrawalEnabled: body.withdrawalEnabled ?? true,
      },
    });
    return house;
  }

  @Put('houses/:id')
  @ApiOperation({ summary: 'Update betting house' })
  async updateHouse(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const existing = await this.prisma.bettingHouse.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Casa não encontrada.');

    const {
      name,
      slug,
      apiBaseURL,
      apiBasePath,
      apiKey,
      logoUrl,
      syncSchedule,
      syncMode,
      withdrawalDay,
      withdrawalDayEnd,
      withdrawalDay2,
      withdrawalDay2End,
      withdrawalWeekday,
      minCpaToWithdraw,
      minAvgDepositPerCpa,
      minWithdrawalAmount,
      active,
      withdrawalEnabled,
    } = body as any;
    const house = await this.prisma.bettingHouse.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(slug !== undefined ? { slug: (slug as string).toLowerCase() } : {}),
        ...(apiBaseURL !== undefined ? { apiBaseURL } : {}),
        ...(apiBasePath !== undefined ? { apiBasePath } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(logoUrl !== undefined ? { logoUrl } : {}),
        ...(syncSchedule !== undefined ? { syncSchedule } : {}),
        ...(syncMode !== undefined ? { syncMode } : {}),
        ...(withdrawalDay !== undefined ? { withdrawalDay } : {}),
        ...(withdrawalDayEnd !== undefined ? { withdrawalDayEnd } : {}),
        ...(withdrawalDay2 !== undefined ? { withdrawalDay2 } : {}),
        ...(withdrawalDay2End !== undefined ? { withdrawalDay2End } : {}),
        ...(withdrawalWeekday !== undefined ? { withdrawalWeekday } : {}),
        ...(minCpaToWithdraw !== undefined ? { minCpaToWithdraw } : {}),
        ...(minAvgDepositPerCpa !== undefined ? { minAvgDepositPerCpa } : {}),
        ...(minWithdrawalAmount !== undefined ? { minWithdrawalAmount } : {}),
        ...(active !== undefined ? { active } : {}),
        ...(withdrawalEnabled !== undefined ? { withdrawalEnabled } : {}),
      },
    });
    // Cutover por casa: grava/remove o setting `ledger_cutover_date_<slug>`.
    // '' ou null remove (casa volta a usar só o cutover global).
    let cutoverDate: string | null = null;
    if ('cutoverDate' in body) {
      const key = this.cutoverKey(house.slug);
      const val = body.cutoverDate;
      if (val === null || val === '') {
        await this.prisma.setting.deleteMany({ where: { key } });
        cutoverDate = null;
      } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        await this.prisma.setting.upsert({
          where: { key },
          update: { value: val },
          create: { key, value: val, label: 'Cutover por casa (ledger)' },
        });
        cutoverDate = val;
      } else {
        throw new BadRequestException(
          'cutoverDate inválido — use YYYY-MM-DD ou vazio para remover.',
        );
      }
    } else {
      const cut = await this.prisma.setting.findUnique({
        where: { key: this.cutoverKey(house.slug) },
        select: { value: true },
      });
      cutoverDate = cut?.value ?? null;
    }

    // Cutover de SALDO por casa: grava/remove `balance_cutover_date_<slug>`.
    // '' ou null remove (conta o ano todo / cai no cutover global).
    let balanceCutoverDate: string | null = null;
    if ('balanceCutoverDate' in body) {
      const key = this.balanceCutoverKey(house.slug);
      const val = body.balanceCutoverDate;
      if (val === null || val === '') {
        await this.prisma.setting.deleteMany({ where: { key } });
        balanceCutoverDate = null;
      } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
        await this.prisma.setting.upsert({
          where: { key },
          update: { value: val },
          create: { key, value: val, label: 'Cutover de saldo por casa' },
        });
        balanceCutoverDate = val;
      } else {
        throw new BadRequestException(
          'balanceCutoverDate inválido — use YYYY-MM-DD ou vazio para remover.',
        );
      }
    } else {
      const bc = await this.prisma.setting.findUnique({
        where: { key: this.balanceCutoverKey(house.slug) },
        select: { value: true },
      });
      balanceCutoverDate = bc?.value ?? null;
    }

    void this.linkWebhook
      .emitHouseUpdated({
        slug: house.slug,
        name: house.name,
        active: house.active,
        updatedAt: house.updatedAt.toISOString(),
      })
      .catch(() => undefined);
    return { ...house, cutoverDate, balanceCutoverDate };
  }

  @Delete('houses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete betting house' })
  async deleteHouse(@Param('id') id: string) {
    const existing = await this.prisma.bettingHouse.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Casa não encontrada.');
    await this.prisma.bettingHouse.delete({ where: { id } });
  }

  // ─── Deals CRUD ────────────────────────────────────────────────────────────

  @Get('deals')
  @ApiOperation({ summary: 'List deals with optional filters' })
  async listDeals(
    @Query('house') house?: string,
    @Query('active') active?: string,
    @Query('search') search?: string,
  ) {
    const where: Record<string, any> = {};
    if (house) where.bettingHouseSlug = house;
    if (active !== undefined) where.active = active === 'true';
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const deals = await this.prisma.deal.findMany({
      where,
      include: { bettingHouse: { select: { name: true, slug: true } } },
      orderBy: [
        { bettingHouseSlug: 'asc' },
        { sortOrder: 'desc' },
        { name: 'asc' },
      ],
    });
    return { data: deals };
  }

  @Get('deals/:id')
  @ApiOperation({ summary: 'Get deal by ID' })
  async getDeal(@Param('id') id: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id },
      include: { bettingHouse: { select: { name: true, slug: true } } },
    });
    if (!deal) throw new NotFoundException('Deal não encontrado.');
    return deal;
  }

  @Post('deals')
  @ApiOperation({ summary: 'Create deal' })
  async createDeal(
    @Body()
    body: {
      bettingHouseSlug: string;
      name: string;
      cpa?: number;
      revshare?: number;
      baseline?: number;
      minAvgDepositPerFtd?: number;
      minQualifiedFtd?: number;
      exclusive?: boolean;
      featured?: boolean;
      newArrival?: boolean;
      sortOrder?: number;
      paymentCpaLabel?: string;
      paymentRevshareLabel?: string;
      revenueType?: string;
      revNegativeAccumulates?: boolean;
      revNegativeOffsetsCpa?: boolean;
      withdrawalIndicators?: string[];
      trafficSources?: string[];
      conditionsText?: string;
      paymentNotes?: string;
      logoUrl?: string;
      active?: boolean;
      legacyKey?: string;
      kind?: 'LINK' | 'FORM';
      formSchema?: unknown;
    },
  ) {
    const kind = body.kind ?? 'LINK';
    this.assertFormSchema(kind, body.formSchema);
    const deal = await this.prisma.deal.create({
      data: {
        bettingHouseSlug: body.bettingHouseSlug,
        name: body.name,
        kind,
        formSchema:
          body.formSchema === undefined
            ? undefined
            : (body.formSchema as Prisma.InputJsonValue),
        cpa: body.cpa ?? 0,
        revshare: body.revshare ?? 0,
        baseline: body.baseline ?? 0,
        minAvgDepositPerFtd: body.minAvgDepositPerFtd ?? 80,
        minQualifiedFtd: body.minQualifiedFtd ?? 15,
        exclusive: body.exclusive ?? false,
        featured: body.featured ?? false,
        newArrival: body.newArrival ?? false,
        sortOrder: body.sortOrder ?? 0,
        paymentCpaLabel: body.paymentCpaLabel ?? '',
        paymentRevshareLabel: body.paymentRevshareLabel ?? '',
        revenueType: body.revenueType ?? '',
        revNegativeAccumulates: body.revNegativeAccumulates ?? false,
        revNegativeOffsetsCpa: body.revNegativeOffsetsCpa ?? false,
        withdrawalIndicators: body.withdrawalIndicators ?? [],
        trafficSources: body.trafficSources ?? [],
        conditionsText: body.conditionsText ?? '',
        paymentNotes: body.paymentNotes ?? '',
        logoUrl: body.logoUrl ?? '',
        active: body.active ?? true,
        legacyKey: body.legacyKey || null,
      },
      include: { bettingHouse: { select: { name: true, slug: true } } },
    });
    return deal;
  }

  @Put('deals/:id')
  @ApiOperation({ summary: 'Update deal' })
  async updateDeal(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const existing = await this.prisma.deal.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Deal não encontrado.');

    const allowed = [
      'name',
      'cpa',
      'revshare',
      'baseline',
      'minAvgDepositPerFtd',
      'minQualifiedFtd',
      'exclusive',
      'featured',
      'newArrival',
      'sortOrder',
      'paymentCpaLabel',
      'paymentRevshareLabel',
      'revenueType',
      'revNegativeAccumulates',
      'revNegativeOffsetsCpa',
      'withdrawalIndicators',
      'trafficSources',
      'conditionsText',
      'paymentNotes',
      'logoUrl',
      'active',
      'legacyKey',
      'kind',
      'formSchema',
    ];
    // Valida o formSchema contra o kind efetivo (novo ou o já persistido).
    const effectiveKind = (body.kind ?? existing.kind) as 'LINK' | 'FORM';
    if ('formSchema' in body || 'kind' in body) {
      this.assertFormSchema(
        effectiveKind,
        'formSchema' in body ? body.formSchema : existing.formSchema,
      );
    }
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body)
        data[key] = key === 'legacyKey' && body[key] === '' ? null : body[key];
    }

    const deal = await this.prisma.deal.update({
      where: { id },
      data,
      include: { bettingHouse: { select: { name: true, slug: true } } },
    });
    void this.linkWebhook
      .emitDealUpdated({
        id: deal.id,
        name: deal.name,
        bettingHouseSlug: deal.bettingHouseSlug,
        cpa: deal.cpa?.toNumber() ?? null,
        revshare: deal.revshare?.toNumber() ?? null,
        updatedAt: deal.updatedAt.toISOString(),
      })
      .catch(() => undefined);
    return deal;
  }

  @Delete('deals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete deal' })
  async deleteDeal(@Param('id') id: string) {
    const existing = await this.prisma.deal.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Deal não encontrado.');
    await this.prisma.deal.delete({ where: { id } });
  }

  /**
   * Valida a estrutura do formSchema de deals kind=FORM: precisa ser um array
   * não-vazio de campos { key, type } com keys únicas e types conhecidos. Mantém
   * o construtor de formulário do admin honesto sem travar novos tipos de campo.
   */
  private assertFormSchema(kind: 'LINK' | 'FORM', formSchema: unknown): void {
    if (kind !== 'FORM') return;
    if (!Array.isArray(formSchema) || formSchema.length === 0) {
      throw new BadRequestException(
        'Deals do tipo FORM exigem um formSchema (lista de campos) não-vazio.',
      );
    }
    const allowedTypes = new Set([
      'text',
      'email',
      'tel',
      'password',
      'select',
      'multiselect',
      'textarea',
    ]);
    const seen = new Set<string>();
    for (const raw of formSchema as unknown[]) {
      const f = raw as { key?: unknown; type?: unknown };
      if (!f || typeof f.key !== 'string' || !f.key.trim()) {
        throw new BadRequestException(
          'Cada campo do formSchema precisa de "key".',
        );
      }
      if (typeof f.type !== 'string' || !allowedTypes.has(f.type)) {
        throw new BadRequestException(
          `Campo "${f.key}" tem type inválido. Use: ${[...allowedTypes].join(', ')}.`,
        );
      }
      if (seen.has(f.key)) {
        throw new BadRequestException(
          `Key duplicada no formSchema: "${f.key}".`,
        );
      }
      seen.add(f.key);
    }
  }

  // ─── Audit Logs ────────────────────────────────────────────────────────────

  @Get('audit-logs')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'List audit logs with pagination and filters' })
  async listAuditLogs(
    @Query('page') page = '1',
    @Query('limit') limit = '30',
    @Query('search') search?: string,
    @Query('method') method?: string,
    @Query('resource') resource?: string,
  ) {
    const {
      page: p,
      limit: take,
      skip,
    } = clampPagination(
      { page: parseInt(page, 10) || 1, limit: parseInt(limit, 10) || 30 },
      { defaultLimit: 30, maxLimit: 100 },
    );

    const where: Record<string, any> = {};
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { resource: { contains: search, mode: 'insensitive' } },
        { userEmail: { contains: search, mode: 'insensitive' } },
        { userName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (method) where.method = method.toUpperCase();
    if (resource) where.resource = { contains: resource, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data: rows, total, page: p, limit: take };
  }
}
