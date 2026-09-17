import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LinkRequestService } from '../../link-request/index.js';
import { WithdrawalService } from '../../withdrawal/index.js';
import { DashboardBalanceService } from '../../dashboard/application/dashboard-balance.service.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import type {
  AffiliateApiCreateLinkRequestDto,
  AffiliateApiCreateWithdrawalDto,
  AffiliateApiEnvironment,
  AffiliateApiListWithdrawalsQueryDto,
  AffiliateApiMetricsQueryDto,
  AffiliateApiTokenOwner,
  AffiliateApiUpdateWithdrawalStatusDto,
  AffiliateApiUserQueryDto,
  IAffiliateApiOps,
} from './dto/affiliate-api.dto.js';

type MetricSummary = {
  clicks: number;
  registrations: number;
  ftds: number;
  deposits: number;
  depositAmount: number;
  revShare: number;
  qualifiedCpa: number;
  cpaAmount: number;
  totalCommission: number;
};

type MetricRecord = MetricSummary & {
  date: string;
  houseSlug: string;
  houseName: string;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  level: number;
};

type NetworkAffiliate = {
  id: string;
  name: string;
  email: string;
  level: number;
};

const EMPTY_SUMMARY: MetricSummary = {
  clicks: 0,
  registrations: 0,
  ftds: 0,
  deposits: 0,
  depositAmount: 0,
  revShare: 0,
  qualifiedCpa: 0,
  cpaAmount: 0,
  totalCommission: 0,
};

@Injectable()
export class AffiliateApiService implements IAffiliateApiOps {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkRequest: LinkRequestService,
    private readonly withdrawal: WithdrawalService,
    private readonly balance: DashboardBalanceService,
  ) {}

  async getTokenStatus(userId: string) {
    await this.assertAffiliate(userId);

    const tokens = await this.prisma.affiliateApiToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tokenHint: true,
        createdAt: true,
        lastUsedAt: true,
        environment: true,
      },
    });

    const pick = (environment: AffiliateApiEnvironment) => {
      const token = tokens.find((t) => t.environment === environment);
      return {
        active: Boolean(token),
        token: token
          ? {
              id: token.id,
              hint: token.tokenHint,
              createdAt: token.createdAt,
              lastUsedAt: token.lastUsedAt,
            }
          : null,
      };
    };

    return { live: pick('live'), test: pick('test') };
  }

  async generateToken(
    userId: string,
    environment: AffiliateApiEnvironment = 'live',
  ) {
    await this.assertAffiliate(userId);

    const prefix = environment === 'test' ? 'vex_test_' : 'vex_live_';
    const token = `${prefix}${randomBytes(32).toString('base64url')}`;
    const tokenHash = this.hashToken(token);
    const tokenHint = token.slice(-6);

    await this.prisma.$transaction([
      // Revoke only the previous token of the SAME environment — live and test
      // tokens coexist (one active each).
      this.prisma.affiliateApiToken.updateMany({
        where: { userId, environment, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.affiliateApiToken.create({
        data: { userId, tokenHash, tokenHint, environment },
      }),
    ]);

    return { token, hint: tokenHint, environment };
  }

  async revokeToken(
    userId: string,
    environment: AffiliateApiEnvironment = 'live',
  ) {
    await this.assertAffiliate(userId);

    await this.prisma.affiliateApiToken.updateMany({
      where: { userId, environment, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { success: true, environment };
  }

  async validateApiToken(token: string): Promise<AffiliateApiTokenOwner> {
    let environment: AffiliateApiEnvironment;
    if (token.startsWith('vex_live_')) environment = 'live';
    else if (token.startsWith('vex_test_')) environment = 'test';
    else throw new UnauthorizedException('Token da API inválido');

    const tokenHash = this.hashToken(token);
    const row = await this.prisma.affiliateApiToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            active: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!row || row.revokedAt || !row.user.active || row.user.deletedAt) {
      throw new UnauthorizedException('Token da API inválido ou revogado');
    }

    // The stored environment must match the token's prefix — defends against a
    // token whose prefix was tampered to flip live/test.
    if (row.environment !== environment) {
      throw new UnauthorizedException('Token da API inválido');
    }

    if (row.user.role !== UserRole.AFFILIATE) {
      throw new ForbiddenException(
        'Token da API permitido apenas para afiliados',
      );
    }

    if (!this.safeEqual(tokenHash, row.tokenHash)) {
      throw new UnauthorizedException('Token da API inválido');
    }

    await this.prisma.affiliateApiToken.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      userId: row.userId,
      email: row.user.email,
      tokenId: row.id,
      environment,
    };
  }

  async listAllowedAffiliates(ownerUserId: string) {
    await this.assertAffiliate(ownerUserId);

    const affiliates = await this.loadAllowedAffiliates(ownerUserId);
    return {
      data: affiliates.map((affiliate) => ({
        id: affiliate.id,
        name: affiliate.name,
        email: affiliate.email,
        level: affiliate.level,
        isOwner: affiliate.id === ownerUserId,
      })),
    };
  }

  async getMetrics(ownerUserId: string, query: AffiliateApiMetricsQueryDto) {
    const { startDate, endDate } = this.resolveDateRange(query);
    const affiliates = await this.loadAllowedAffiliates(ownerUserId);
    const allowedIds = new Set(affiliates.map((affiliate) => affiliate.id));
    const requestedAffiliateId = this.resolveRequestedAffiliateId(
      ownerUserId,
      query.affiliateId,
    );

    if (requestedAffiliateId && !allowedIds.has(requestedAffiliateId)) {
      throw new ForbiddenException('Afiliado fora da sua rede');
    }

    const targetAffiliateIds = requestedAffiliateId
      ? [requestedAffiliateId]
      : affiliates.map((affiliate) => affiliate.id);

    const links = await this.prisma.affiliateLink.findMany({
      where: {
        userId: { in: targetAffiliateIds },
        ...(query.houseSlug ? { bettingHouse: query.houseSlug } : {}),
      },
      select: {
        userId: true,
        campaignId: true,
        bettingHouse: true,
      },
    });

    const linkKeyToUserId = new Map<string, string>();
    for (const link of links) {
      linkKeyToUserId.set(
        this.linkKey(link.campaignId, link.bettingHouse),
        link.userId,
      );
    }

    const campaignIds = Array.from(
      new Set(links.map((link) => link.campaignId).filter(Boolean)),
    );
    if (campaignIds.length === 0) {
      return this.formatMetricsResponse(
        query,
        startDate,
        endDate,
        ownerUserId,
        affiliates,
        targetAffiliateIds,
      );
    }

    const houses = await this.prisma.bettingHouse.findMany({
      where: {
        slug: {
          in: Array.from(new Set(links.map((link) => link.bettingHouse))),
        },
      },
      select: { slug: true, name: true },
    });
    const houseNameBySlug = new Map(
      houses.map((house) => [house.slug, house.name]),
    );

    const rows = await this.prisma.affiliateData.groupBy({
      by: ['campaignId', 'bettingHouse', 'date'],
      where: {
        campaignId: { in: campaignIds },
        ...(query.houseSlug ? { bettingHouse: query.houseSlug } : {}),
        date: { gte: startDate, lte: endDate },
      },
      _sum: {
        clicks: true,
        registrations: true,
        ftds: true,
        qftd: true,
        deposit: true,
        revShare: true,
        cpaQualified: true,
        cpaValue: true,
        totalCommission: true,
      },
      orderBy: [{ date: 'asc' }],
    });

    const affiliateMap = new Map(
      affiliates.map((affiliate) => [affiliate.id, affiliate]),
    );
    const summary = this.createSummary();
    const byHouse = new Map<string, MetricSummary>();
    const byDay = new Map<string, MetricSummary>();
    const byAffiliate = new Map<string, MetricSummary>();
    const records = new Map<string, MetricRecord>();

    for (const row of rows) {
      const userId = linkKeyToUserId.get(
        this.linkKey(row.campaignId, row.bettingHouse),
      );
      if (!userId || !targetAffiliateIds.includes(userId)) continue;

      const affiliate = affiliateMap.get(userId);
      const date = row.date.toISOString().slice(0, 10);
      const metric = this.metricFromRow(row._sum);
      this.addSummary(summary, metric);
      this.addSummary(this.ensureSummary(byHouse, row.bettingHouse), metric);
      this.addSummary(this.ensureSummary(byAffiliate, userId), metric);
      this.addSummary(this.ensureSummary(byDay, date), metric);

      const recordKey = `${date}::${row.bettingHouse}::${userId}`;
      const record = records.get(recordKey);
      if (record) {
        this.addSummary(record, metric);
      } else {
        records.set(recordKey, {
          date,
          houseSlug: row.bettingHouse,
          houseName: houseNameBySlug.get(row.bettingHouse) ?? row.bettingHouse,
          affiliateId: userId,
          affiliateName: affiliate?.name ?? '',
          affiliateEmail: affiliate?.email ?? '',
          level: affiliate?.level ?? 0,
          ...metric,
        });
      }
    }

    this.assertMetricsScope({
      allowedIds,
      targetAffiliateIds,
      recordAffiliateIds: Array.from(records.values()).map(
        (record) => record.affiliateId,
      ),
      groupedAffiliateIds: Array.from(byAffiliate.keys()),
    });

    return {
      filters: {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        houseSlug: query.houseSlug ?? null,
        affiliateId: requestedAffiliateId,
      },
      scope: {
        ownerUserId,
        includedAffiliateIds: targetAffiliateIds,
      },
      summary,
      records: Array.from(records.values()).sort((left, right) => {
        const byDate = left.date.localeCompare(right.date);
        if (byDate !== 0) return byDate;
        const byHouse = left.houseSlug.localeCompare(right.houseSlug);
        if (byHouse !== 0) return byHouse;
        return left.affiliateEmail.localeCompare(right.affiliateEmail);
      }),
      byHouse: Array.from(byHouse.entries()).map(([houseSlug, metrics]) => ({
        houseSlug,
        houseName: houseNameBySlug.get(houseSlug) ?? houseSlug,
        ...metrics,
      })),
      byDay: Array.from(byDay.entries()).map(([date, metrics]) => ({
        date,
        ...metrics,
      })),
      byAffiliate: Array.from(byAffiliate.entries()).map(
        ([affiliateId, metrics]) => {
          const affiliate = affiliateMap.get(affiliateId);
          return {
            affiliateId,
            affiliateName: affiliate?.name ?? '',
            affiliateEmail: affiliate?.email ?? '',
            level: affiliate?.level ?? 0,
            ...metrics,
          };
        },
      ),
    };
  }

  async createLinkRequestFromApi(
    ownerUserId: string,
    dto: AffiliateApiCreateLinkRequestDto,
  ) {
    await this.assertAffiliate(ownerUserId);

    const externalId = dto.externalUserId.trim();
    if (!externalId)
      throw new BadRequestException('externalUserId é obrigatório');

    const userEmail = dto.userEmail.trim().toLowerCase();
    const userName = dto.userName.trim();
    const bettingHouseSlug = dto.bettingHouseSlug.trim().toLowerCase();
    if (!userEmail) throw new BadRequestException('userEmail é obrigatório');
    if (!userName) throw new BadRequestException('userName é obrigatório');
    if (!bettingHouseSlug)
      throw new BadRequestException('bettingHouseSlug é obrigatório');

    const requester = await this.ensureExternalRequester({
      ownerUserId,
      externalId,
      userEmail,
      userName,
    });

    // Persist the RAW payload (esp. the received userEmail) so it is never lost,
    // even when ensureExternalRequester falls back to a synthetic address on an
    // e-mail clash. Awaited — the received e-mail must be captured before we
    // return. Keyed by externalId for later search/metrics/backfill.
    const emailSynthetic = requester.email !== userEmail;
    await this.prisma.affiliateApiLinkRequestLog.create({
      data: {
        ownerUserId,
        externalId,
        userEmail,
        userName,
        bettingHouseSlug,
        dealId: dto.dealId ?? null,
        message: dto.message ?? null,
        requesterId: requester.id,
        emailSynthetic,
        payload: {
          externalUserId: externalId,
          userEmail,
          userName,
          bettingHouseSlug,
          dealId: dto.dealId ?? null,
          message: dto.message ?? null,
        },
      },
    });

    const item = await this.linkRequest.create(
      requester.id,
      {
        dealId: dto.dealId,
        bettingHouseSlug,
        message: dto.message,
      },
      { skipEligibility: true },
    );

    return {
      ...item,
      requester,
    };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Withdrawals (acting on behalf of the partner's external sub-users)
  // ───────────────────────────────────────────────────────────────────────

  /** Consult a sub-user: profile fields + balance (per-house + total). */
  async getExternalUser(
    ownerUserId: string,
    externalUserId: string,
    query: AffiliateApiUserQueryDto,
  ) {
    await this.assertAffiliate(ownerUserId);
    const subUser = await this.resolveExternalSubUser(
      ownerUserId,
      externalUserId,
    );
    const balance = await this.balance.getBalance(
      this.subUserJwt(subUser.id),
      query.bettingHouse ? { bettingHouse: query.bettingHouse } : {},
    );
    return {
      user: {
        externalUserId: subUser.externalId,
        name: subUser.name,
        // Show the real e-mail; the synthetic address is never surfaced.
        email: subUser.externalEmail ?? subUser.email,
        status: subUser.status,
        createdAt: subUser.createdAt,
      },
      balance,
    };
  }

  /** Create a withdrawal (full house balance) for a sub-user + return balance. */
  async createWithdrawalFromApi(
    ownerUserId: string,
    dto: AffiliateApiCreateWithdrawalDto,
  ) {
    await this.assertAffiliate(ownerUserId);

    const externalId = dto.externalUserId.trim();
    if (!externalId) {
      throw new BadRequestException('externalUserId é obrigatório');
    }

    const requester = await this.ensureExternalRequester({
      ownerUserId,
      externalId,
    });

    const withdrawal = await this.withdrawal.createForExternal(
      { id: requester.id, name: requester.name, externalId },
      { bettingHouse: dto.bettingHouse, requestNote: dto.requestNote },
    );

    const balance = await this.balance.getBalance(
      this.subUserJwt(requester.id),
      {},
    );

    return { withdrawal, balance };
  }

  /** List the partner's withdrawal history (scoped to its sub-users). */
  async listWithdrawalsFromApi(
    ownerUserId: string,
    query: AffiliateApiListWithdrawalsQueryDto,
  ) {
    await this.assertAffiliate(ownerUserId);

    const externalIds = await this.loadOwnerExternalIds(
      ownerUserId,
      query.externalUserId,
    );

    return this.withdrawal.listForExternal(externalIds, {
      status: query.status,
      bettingHouse: query.bettingHouse,
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page,
      limit: query.limit,
    });
  }

  /** Fetch a single withdrawal (scoped to the partner's sub-users). */
  async getWithdrawalFromApi(ownerUserId: string, withdrawalId: string) {
    await this.assertAffiliate(ownerUserId);
    const externalIds = await this.loadOwnerExternalIds(ownerUserId);
    return this.withdrawal.getForExternal(withdrawalId, externalIds);
  }

  /** Partner sets a withdrawal status (processing/completed/rejected). */
  async setWithdrawalStatusFromApi(
    ownerUserId: string,
    withdrawalId: string,
    dto: AffiliateApiUpdateWithdrawalStatusDto,
  ) {
    await this.assertAffiliate(ownerUserId);
    const externalIds = await this.loadOwnerExternalIds(ownerUserId);
    return this.withdrawal.setStatusForExternal(withdrawalId, externalIds, {
      status: dto.status,
      note: dto.note,
    });
  }

  private subUserJwt(subUserId: string): JwtPayload {
    return { sub: subUserId, email: '', role: UserRole.AFFILIATE };
  }

  /** Resolve a sub-user that belongs to this partner, or 404. */
  private async resolveExternalSubUser(
    ownerUserId: string,
    externalId: string,
  ) {
    const subUser = await this.prisma.user.findFirst({
      where: {
        referredById: ownerUserId,
        externalId: externalId.trim(),
        isExternal: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        externalEmail: true,
        externalId: true,
        status: true,
        createdAt: true,
      },
    });
    if (!subUser) {
      throw new NotFoundException('Usuário externo não encontrado');
    }
    return subUser;
  }

  /**
   * IDs of the partner's external sub-users (optionally narrowed to one
   * externalUserId). Used to scope withdrawal reads/writes — a foreign id
   * simply isn't in the set, so it can never be touched.
   */
  private async loadOwnerExternalIds(
    ownerUserId: string,
    externalUserId?: string,
  ): Promise<string[]> {
    if (externalUserId) {
      const subUser = await this.resolveExternalSubUser(
        ownerUserId,
        externalUserId,
      );
      return [subUser.id];
    }
    const subUsers = await this.prisma.user.findMany({
      where: { referredById: ownerUserId, isExternal: true },
      select: { id: true },
    });
    return subUsers.map((u) => u.id);
  }

  private async assertAffiliate(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, active: true, deletedAt: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.role !== UserRole.AFFILIATE || !user.active || user.deletedAt) {
      throw new ForbiddenException('Apenas afiliados podem gerar token da API');
    }
  }

  private async loadAllowedAffiliates(
    ownerUserId: string,
  ): Promise<NetworkAffiliate[]> {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { id: true, name: true, email: true },
    });
    if (!owner) throw new NotFoundException('Afiliado não encontrado');

    const result: NetworkAffiliate[] = [{ ...owner, level: 0 }];
    let currentIds = [ownerUserId];
    let level = 1;

    while (currentIds.length > 0 && level <= 10) {
      const children = await this.prisma.user.findMany({
        where: {
          referredById: { in: currentIds },
          role: UserRole.AFFILIATE,
          active: true,
          deletedAt: null,
        },
        select: { id: true, name: true, email: true },
      });

      if (children.length === 0) break;
      result.push(...children.map((child) => ({ ...child, level })));
      currentIds = children.map((child) => child.id);
      level += 1;
    }

    return result;
  }

  /**
   * Resolve (or lazily create) the third party's panel user as a shadow
   * "external" user in our system, keyed by (ownerUserId, externalId). External
   * users cannot log in (blocked in auth) and are excluded from affiliate
   * counts/rankings.
   */
  private async ensureExternalRequester(input: {
    ownerUserId: string;
    externalId: string;
    userEmail?: string;
    userName?: string;
  }) {
    // Real e-mail received from the partner — stored in externalEmail (NON-unique)
    // so a clash never hijacks an account; the synthetic `email` stays the unique key.
    const externalEmail = input.userEmail?.trim().toLowerCase() || null;

    const existing = await this.prisma.user.findFirst({
      where: { referredById: input.ownerUserId, externalId: input.externalId },
      select: {
        id: true,
        email: true,
        name: true,
        referredById: true,
        externalEmail: true,
      },
    });
    if (existing) {
      // Backfill externalEmail on reuse if it's still missing and we now have one.
      if (!existing.externalEmail && externalEmail) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { externalEmail },
        });
        existing.externalEmail = externalEmail;
      }
      return existing;
    }

    // Prefer the provided email, but never hijack an existing account: fall
    // back to a deterministic synthetic address when it clashes or is absent.
    let email = input.userEmail;
    if (email) {
      const clash = await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (clash) email = undefined;
    }
    if (!email) {
      email = `ext.${input.externalId}.${input.ownerUserId}@external.vallex.local`;
    }

    const name = input.userName || `External ${input.externalId}`;
    const password = randomBytes(32).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 12);

    const created = await this.prisma.user.create({
      data: {
        name,
        email,
        externalEmail,
        password: passwordHash,
        role: UserRole.AFFILIATE,
        status: UserStatus.APPROVED,
        active: true,
        ageVerified: true,
        isExternal: true,
        externalId: input.externalId,
        referredById: input.ownerUserId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        referredById: true,
        externalEmail: true,
      },
    });

    return created;
  }

  private resolveRequestedAffiliateId(
    ownerUserId: string,
    affiliateId: string | undefined,
  ) {
    if (!affiliateId) return null;
    return affiliateId === 'me' ? ownerUserId : affiliateId;
  }

  private resolveDateRange(query: AffiliateApiMetricsQueryDto) {
    const now = new Date();
    const defaultStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const defaultEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const startDate = query.startDate
      ? this.parseDate(query.startDate, 'startDate')
      : defaultStart;
    const endDate = query.endDate
      ? this.parseDate(query.endDate, 'endDate')
      : defaultEnd;

    if (startDate > endDate)
      throw new BadRequestException('startDate não pode ser maior que endDate');

    const days =
      Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
    if (days > 90)
      throw new BadRequestException('O intervalo máximo é de 90 dias');

    return { startDate, endDate };
  }

  private parseDate(value: string, field: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(
        `${field} deve estar no formato YYYY-MM-DD`,
      );
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} inválida`);
    }
    return date;
  }

  private formatMetricsResponse(
    query: AffiliateApiMetricsQueryDto,
    startDate: Date,
    endDate: Date,
    ownerUserId: string,
    affiliates: NetworkAffiliate[],
    targetAffiliateIds: string[],
  ) {
    return {
      filters: {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        houseSlug: query.houseSlug ?? null,
        affiliateId: this.resolveRequestedAffiliateId(
          ownerUserId,
          query.affiliateId,
        ),
      },
      scope: { ownerUserId, includedAffiliateIds: targetAffiliateIds },
      summary: this.createSummary(),
      records: [],
      byHouse: [],
      byDay: [],
      byAffiliate: affiliates
        .filter((affiliate) => targetAffiliateIds.includes(affiliate.id))
        .map((affiliate) => ({
          affiliateId: affiliate.id,
          affiliateName: affiliate.name,
          affiliateEmail: affiliate.email,
          level: affiliate.level,
          ...this.createSummary(),
        })),
    };
  }

  private metricFromRow(sum: {
    clicks: number | null;
    registrations: number | null;
    ftds: number | null;
    qftd: number | null;
    deposit: { toNumber(): number } | null;
    revShare: { toNumber(): number } | null;
    cpaQualified: number | null;
    cpaValue: { toNumber(): number } | null;
    totalCommission: { toNumber(): number } | null;
  }): MetricSummary {
    return {
      clicks: sum.clicks ?? 0,
      registrations: sum.registrations ?? 0,
      ftds: sum.ftds ?? 0,
      deposits: sum.qftd ?? sum.ftds ?? 0,
      depositAmount: sum.deposit?.toNumber() ?? 0,
      revShare: sum.revShare?.toNumber() ?? 0,
      qualifiedCpa: sum.cpaQualified ?? 0,
      cpaAmount: sum.cpaValue?.toNumber() ?? 0,
      totalCommission: sum.totalCommission?.toNumber() ?? 0,
    };
  }

  private createSummary(): MetricSummary {
    return { ...EMPTY_SUMMARY };
  }

  private ensureSummary(map: Map<string, MetricSummary>, key: string) {
    const existing = map.get(key);
    if (existing) return existing;
    const summary = this.createSummary();
    map.set(key, summary);
    return summary;
  }

  private addSummary(target: MetricSummary, source: MetricSummary) {
    target.clicks += source.clicks;
    target.registrations += source.registrations;
    target.ftds += source.ftds;
    target.deposits += source.deposits;
    target.depositAmount += source.depositAmount;
    target.revShare += source.revShare;
    target.qualifiedCpa += source.qualifiedCpa;
    target.cpaAmount += source.cpaAmount;
    target.totalCommission += source.totalCommission;
  }

  private assertMetricsScope(input: {
    allowedIds: Set<string>;
    targetAffiliateIds: string[];
    recordAffiliateIds: string[];
    groupedAffiliateIds: string[];
  }) {
    const targetIds = new Set(input.targetAffiliateIds);
    const leakedScopeId = input.targetAffiliateIds.find(
      (id) => !input.allowedIds.has(id),
    );
    const leakedRecordId = input.recordAffiliateIds.find(
      (id) => !targetIds.has(id),
    );
    const leakedGroupedId = input.groupedAffiliateIds.find(
      (id) => !targetIds.has(id),
    );

    if (leakedScopeId || leakedRecordId || leakedGroupedId) {
      throw new ForbiddenException(
        'A consulta tentou retornar dados fora da sua rede',
      );
    }
  }

  private linkKey(campaignId: string, house: string) {
    return `${campaignId}::${house}`;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }
}
