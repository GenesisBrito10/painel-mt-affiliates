import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { LinkWebhookDeliveryStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from '../../auth/index.js';
import type {
  ListLinkWebhookDeliveriesDto,
  AdminWebhookDeliveriesQueryDto,
  AdminWebhookOverviewQueryDto,
} from './dto/link-webhook.dto.js';
import {
  LinkWebhookSettingsService,
  type ResolvedWebhookTarget,
} from './link-webhook-settings.service.js';
import {
  LinkWebhookHttpService,
  WebhookHttpError,
} from './link-webhook-http.service.js';
import { LinkWebhookProducer } from '../infrastructure/queues/link-webhook.producer.js';
import {
  ALL_LINK_WEBHOOK_EVENTS,
  LINK_WEBHOOK_EVENTS,
  LINK_WEBHOOK_ORIGINS,
  type LinkWebhookEvent,
} from '../domain/types/link-webhook.types.js';

/** Payload of a withdrawal.* webhook event (owner-scoped). */
export interface WithdrawalEventPayload {
  withdrawalId: string;
  userId: string;
  externalUserId?: string | null;
  bettingHouse: string;
  amount: number;
  originalAmount: number;
  status: string;
  previousStatus?: string | null;
  createdAt: string;
}

interface DispatchOptions {
  /** Link request id for link_request.* events (null for global events). */
  linkRequestId?: string | null;
  /** User the event concerns — used for owner-network scoping. */
  subjectUserId?: string | null;
  /** Stable per-event suffix for the idempotency key. */
  idempotencySuffix: string;
}

@Injectable()
export class LinkWebhookService {
  private readonly logger = new Logger(LinkWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LinkWebhookSettingsService,
    private readonly http: LinkWebhookHttpService,
    private readonly producer: LinkWebhookProducer,
  ) {}

  // ─── Link request events ──────────────────────────────────────────────────

  async notifyApproved(linkRequestId: string, origin: string) {
    await this.notifyLink(linkRequestId, LINK_WEBHOOK_EVENTS.APPROVED, origin);
  }

  async notifyRejected(linkRequestId: string, origin: string) {
    await this.notifyLink(linkRequestId, LINK_WEBHOOK_EVENTS.REJECTED, origin);
  }

  async notifyCreated(linkRequestId: string, origin: string) {
    await this.notifyLink(linkRequestId, LINK_WEBHOOK_EVENTS.CREATED, origin);
  }

  // ─── Generic (cron / deal / house) events ─────────────────────────────────

  /** Emitted after a sync cycle persists a house's affiliate_data. */
  async emitAffiliateDataSynced(payload: {
    houseSlug: string;
    sourceHouseSlug?: string;
    houseName?: string | null;
    dates: string[];
    rowsUpserted: number;
    totals?: Record<string, number>;
    triggeredBy?: string;
  }) {
    const suffix = `${payload.houseSlug}:${payload.dates.join(',')}:${payload.rowsUpserted}`;
    await this.dispatch(
      LINK_WEBHOOK_EVENTS.AFFILIATE_DATA_SYNCED,
      LINK_WEBHOOK_ORIGINS.SYNC,
      { ...payload },
      { idempotencySuffix: suffix },
    );
  }

  async emitDealUpdated(payload: {
    id: string;
    name: string;
    bettingHouseSlug?: string | null;
    cpa: number | null;
    revshare: number | null;
    updatedAt: string;
  }) {
    await this.dispatch(
      LINK_WEBHOOK_EVENTS.DEAL_UPDATED,
      LINK_WEBHOOK_ORIGINS.DEAL,
      { ...payload },
      { idempotencySuffix: `${payload.id}:${payload.updatedAt}` },
    );
  }

  async emitHouseUpdated(payload: {
    slug: string;
    name: string;
    active: boolean;
    updatedAt: string;
  }) {
    await this.dispatch(
      LINK_WEBHOOK_EVENTS.HOUSE_UPDATED,
      LINK_WEBHOOK_ORIGINS.HOUSE,
      { ...payload },
      { idempotencySuffix: `${payload.slug}:${payload.updatedAt}` },
    );
  }

  // ─── History + redelivery ─────────────────────────────────────────────────

  async listDeliveries(actor: JwtPayload, query: ListLinkWebhookDeliveriesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const ownerUserId = this.settings.ownerIdForActor(actor);
    const where: Prisma.LinkWebhookDeliveryWhereInput = {
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(query.status
        ? { status: query.status as LinkWebhookDeliveryStatus }
        : {}),
      ...(query.event ? { event: query.event } : {}),
      ...this.dateRangeWhere(query.from, query.to),
      // Busca pelo usuário do linkRequest (nome/e-mail). Saques têm linkRequestId
      // null e não casam por aqui — destrava o 400 e cobre os eventos de link.
      ...(query.search
        ? {
            linkRequest: {
              user: {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { email: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.linkWebhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          linkRequestId: true,
          event: true,
          origin: true,
          status: true,
          httpStatus: true,
          responseBody: true,
          errorMessage: true,
          attempts: true,
          payload: true,
          deliveredAt: true,
          createdAt: true,
          linkRequest: {
            select: { user: { select: { name: true, email: true } } },
          },
        },
      }),
      this.prisma.linkWebhookDelivery.count({ where }),
    ]);

    return {
      data: items.map((item) => ({
        id: item.id,
        linkRequestId: item.linkRequestId,
        event: item.event,
        origin: item.origin,
        status: item.status,
        httpStatus: item.httpStatus,
        responseBody: item.responseBody,
        errorMessage: item.errorMessage,
        attempts: item.attempts,
        payload: item.payload,
        deliveredAt: item.deliveredAt,
        createdAt: item.createdAt,
        requesterName: item.linkRequest?.user.name ?? null,
        requesterEmail: item.linkRequest?.user.email ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /** Re-enqueue a past delivery as a new attempt (manual redelivery). */
  async redeliver(actor: JwtPayload, deliveryId: string) {
    const ownerUserId = this.settings.ownerIdForActor(actor);
    const original = await this.prisma.linkWebhookDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!original) throw new NotFoundException('Entrega não encontrada');

    // Network-scoped actors can only redeliver their own webhooks.
    if (ownerUserId && original.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('Entrega fora do seu escopo');
    }

    const clone = await this.prisma.linkWebhookDelivery.create({
      data: {
        linkRequestId: original.linkRequestId,
        ownerUserId: original.ownerUserId,
        event: original.event,
        origin: LINK_WEBHOOK_ORIGINS.REDELIVERY,
        idempotencyKey: `${original.idempotencyKey}:redeliver:${Date.now()}`,
        payload: original.payload as Prisma.InputJsonValue,
        status: LinkWebhookDeliveryStatus.PENDING,
        attempts: 0,
      },
      select: { id: true },
    });

    await this.producer.enqueueDelivery(clone.id);
    return { id: clone.id, status: LinkWebhookDeliveryStatus.PENDING };
  }

  /**
   * Send a NON-PERSISTED sample of `event` (default link_request.approved) to
   * the partner's configured webhook URL, signed exactly like a real delivery.
   * Returns the signed request (headers + signature + body) and the partner's
   * response so the integrator can verify their handler. Never creates a
   * LinkWebhookDelivery row → invisible to production stats/observability.
   */
  async sendTestWebhook(actor: JwtPayload, event?: string) {
    const resolvedEvent: LinkWebhookEvent = (
      ALL_LINK_WEBHOOK_EVENTS as string[]
    ).includes(event ?? '')
      ? (event as LinkWebhookEvent)
      : LINK_WEBHOOK_EVENTS.APPROVED;

    const ownerUserId = this.settings.ownerIdForActor(actor);
    const settings = await this.settings.getSettingsRow(ownerUserId);

    if (!settings.webhookUrl.trim()) {
      return {
        success: false,
        error: 'Configure a URL do webhook antes de testar.',
      };
    }

    const payload = this.buildTestPayload(actor, resolvedEvent);
    try {
      const result = await this.http.post(
        settings.webhookUrl,
        settings.webhookSecret,
        payload,
        'test',
      );
      return {
        success: true,
        event: resolvedEvent,
        httpStatus: result.httpStatus,
        request: result.request,
        responseBody: result.responseBody,
      };
    } catch (err) {
      const httpStatus =
        err instanceof WebhookHttpError ? err.httpStatus : null;
      return {
        success: false,
        event: resolvedEvent,
        httpStatus,
        error: err instanceof Error ? err.message : 'Falha ao enviar teste.',
      };
    }
  }

  // ─── Withdrawal events (owner-scoped, fire-and-forget from withdrawal flow) ─

  /** Emit withdrawal.created — scoped to the withdrawal owner's network. */
  async emitWithdrawalCreated(p: WithdrawalEventPayload) {
    await this.dispatch(
      LINK_WEBHOOK_EVENTS.WITHDRAWAL_CREATED,
      LINK_WEBHOOK_ORIGINS.WITHDRAWAL,
      { withdrawal: p },
      {
        subjectUserId: p.userId,
        idempotencySuffix: `${p.withdrawalId}:created`,
      },
    );
  }

  /** Emit withdrawal.status_changed — scoped to the withdrawal owner's network. */
  async emitWithdrawalStatusChanged(p: WithdrawalEventPayload) {
    await this.dispatch(
      LINK_WEBHOOK_EVENTS.WITHDRAWAL_STATUS_CHANGED,
      LINK_WEBHOOK_ORIGINS.WITHDRAWAL,
      { withdrawal: p },
      {
        // One delivery per (withdrawal, target status) — dedups repeats.
        subjectUserId: p.userId,
        idempotencySuffix: `${p.withdrawalId}:${p.status}`,
      },
    );
  }

  // ─── Admin observability (cross-owner) ────────────────────────────────────

  async adminOverview(query: AdminWebhookOverviewQueryDto) {
    const where = this.dateRangeWhere(query.from, query.to);

    const byStatus = await this.prisma.linkWebhookDelivery.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: { attempts: true },
    });
    const byEvent = await this.prisma.linkWebhookDelivery.groupBy({
      by: ['event'],
      where,
      _count: true,
    });

    const status = { SUCCESS: 0, FAILED: 0, PENDING: 0 };
    let totalAttempts = 0;
    for (const row of byStatus) {
      status[row.status] = row._count;
      totalAttempts += row._sum.attempts ?? 0;
    }
    const total = status.SUCCESS + status.FAILED + status.PENDING;

    const [retried, last24h] = await Promise.all([
      this.prisma.linkWebhookDelivery.count({
        where: { ...where, attempts: { gt: 1 } },
      }),
      this.prisma.linkWebhookDelivery.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      }),
    ]);

    return {
      total,
      success: status.SUCCESS,
      failed: status.FAILED,
      pending: status.PENDING,
      successRate: total ? status.SUCCESS / total : 0,
      totalAttempts,
      retried,
      last24h,
      byEvent: byEvent
        .map((e) => ({ event: e.event, count: e._count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async adminListEndpoints() {
    const rows = await this.prisma.linkWebhookSettings.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        ownerUserId: true,
        enabled: true,
        webhookUrl: true,
        events: true,
        updatedAt: true,
        owner: { select: { name: true, email: true } },
      },
    });

    const [counts, last] = await Promise.all([
      this.prisma.linkWebhookDelivery.groupBy({
        by: ['ownerUserId', 'status'],
        _count: true,
      }),
      this.prisma.linkWebhookDelivery.groupBy({
        by: ['ownerUserId'],
        _max: { createdAt: true },
      }),
    ]);

    const countMap = new Map<
      string,
      { success: number; failed: number; pending: number }
    >();
    for (const c of counts) {
      const key = c.ownerUserId ?? 'global';
      const entry = countMap.get(key) ?? { success: 0, failed: 0, pending: 0 };
      if (c.status === 'SUCCESS') entry.success = c._count;
      else if (c.status === 'FAILED') entry.failed = c._count;
      else entry.pending = c._count;
      countMap.set(key, entry);
    }
    const lastMap = new Map(
      last.map((l) => [l.ownerUserId ?? 'global', l._max.createdAt]),
    );

    return rows.map((r) => {
      const key = r.ownerUserId ?? 'global';
      return {
        id: r.id,
        ownerUserId: r.ownerUserId,
        ownerName: r.owner?.name ?? 'Global (admin)',
        ownerEmail: r.owner?.email ?? null,
        scope: r.ownerUserId ? 'network' : 'global',
        enabled: r.enabled,
        webhookUrl: r.webhookUrl,
        events: r.events,
        updatedAt: r.updatedAt,
        deliveries: countMap.get(key) ?? {
          success: 0,
          failed: 0,
          pending: 0,
        },
        lastDeliveryAt: lastMap.get(key) ?? null,
      };
    });
  }

  async adminListDeliveries(query: AdminWebhookDeliveriesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.LinkWebhookDeliveryWhereInput = {
      ...(query.status
        ? { status: query.status as LinkWebhookDeliveryStatus }
        : {}),
      ...(query.event ? { event: query.event } : {}),
      ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      ...this.dateRangeWhere(query.from, query.to),
      ...(query.search
        ? {
            owner: {
              OR: [
                { email: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.linkWebhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          linkRequestId: true,
          event: true,
          origin: true,
          status: true,
          httpStatus: true,
          responseBody: true,
          errorMessage: true,
          attempts: true,
          payload: true,
          deliveredAt: true,
          createdAt: true,
          ownerUserId: true,
          owner: { select: { name: true, email: true } },
          linkRequest: {
            select: { user: { select: { name: true, email: true } } },
          },
        },
      }),
      this.prisma.linkWebhookDelivery.count({ where }),
    ]);

    return {
      data: items.map((item) => ({
        id: item.id,
        linkRequestId: item.linkRequestId,
        event: item.event,
        origin: item.origin,
        status: item.status,
        httpStatus: item.httpStatus,
        responseBody: item.responseBody,
        errorMessage: item.errorMessage,
        attempts: item.attempts,
        payload: item.payload,
        deliveredAt: item.deliveredAt,
        createdAt: item.createdAt,
        ownerUserId: item.ownerUserId,
        ownerName: item.owner?.name ?? 'Global (admin)',
        ownerEmail: item.owner?.email ?? null,
        requesterName: item.linkRequest?.user.name ?? null,
        requesterEmail: item.linkRequest?.user.email ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  private dateRangeWhere(
    from?: string,
    to?: string,
  ): Prisma.LinkWebhookDeliveryWhereInput {
    if (!from && !to) return {};
    const gte = from ? new Date(`${from}T00:00:00.000Z`) : undefined;
    const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
    return {
      createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) },
    };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async notifyLink(
    linkRequestId: string,
    event: LinkWebhookEvent,
    origin: string,
  ) {
    const linkRequest = await this.prisma.linkRequest.findUnique({
      where: { id: linkRequestId },
      select: {
        id: true,
        userId: true,
        dealId: true,
        bettingHouseSlug: true,
        message: true,
        status: true,
        links: true,
        adminNote: true,
        fulfilledAt: true,
        fulfilledByName: true,
        createdAt: true,
        resolvedCpa: true,
        resolvedRevshare: true,
        resolvedRuleApplied: true,
        inviterId: true,
        inviterCpa: true,
        requiredHouseSlugs: true,
        missingHouseSlugs: true,
        blockedReason: true,
        user: {
          select: { id: true, name: true, email: true, referredById: true },
        },
        deal: {
          select: { id: true, name: true, cpa: true, revshare: true },
        },
      },
    });
    if (!linkRequest) return;

    const affiliateLink = await this.prisma.affiliateLink.findFirst({
      where: {
        userId: linkRequest.userId,
        bettingHouse: linkRequest.bettingHouseSlug,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        bettingHouse: true,
        campaignId: true,
        userLink: true,
        cpa: true,
        revshare: true,
      },
    });

    const payload = {
      linkRequest: {
        id: linkRequest.id,
        status: linkRequest.status,
        bettingHouseSlug: linkRequest.bettingHouseSlug,
        message: linkRequest.message,
        adminNote: linkRequest.adminNote,
        links: linkRequest.links,
        dealId: linkRequest.dealId,
        fulfilledAt: linkRequest.fulfilledAt?.toISOString() ?? null,
        fulfilledByName: linkRequest.fulfilledByName,
        createdAt: linkRequest.createdAt.toISOString(),
        resolvedCpa: this.decimalToNumber(linkRequest.resolvedCpa),
        resolvedRevshare: this.decimalToNumber(linkRequest.resolvedRevshare),
        resolvedRuleApplied: linkRequest.resolvedRuleApplied,
        inviterId: linkRequest.inviterId,
        inviterCpa: this.decimalToNumber(linkRequest.inviterCpa),
        requiredHouseSlugs: linkRequest.requiredHouseSlugs,
        missingHouseSlugs: linkRequest.missingHouseSlugs,
        blockedReason: linkRequest.blockedReason,
      },
      user: linkRequest.user,
      deal: linkRequest.deal
        ? {
            id: linkRequest.deal.id,
            name: linkRequest.deal.name,
            cpa: this.decimalToNumber(linkRequest.deal.cpa),
            revshare: this.decimalToNumber(linkRequest.deal.revshare),
          }
        : null,
      affiliateLink: affiliateLink
        ? {
            bettingHouse: affiliateLink.bettingHouse,
            campaignId: affiliateLink.campaignId,
            userLink: affiliateLink.userLink,
            cpa: this.decimalToNumber(affiliateLink.cpa),
            revshare: this.decimalToNumber(affiliateLink.revshare),
          }
        : null,
    };

    const fulfilledAt = linkRequest.fulfilledAt?.toISOString() ?? '';
    await this.dispatch(event, origin, payload, {
      linkRequestId: linkRequest.id,
      subjectUserId: linkRequest.userId,
      idempotencySuffix: `${linkRequest.id}:${fulfilledAt || event}`,
    });
  }

  /**
   * Resolve subscribed targets, persist a PENDING delivery per target, and
   * enqueue async delivery. Never performs HTTP inline.
   */
  private async dispatch(
    event: LinkWebhookEvent,
    origin: string,
    payloadBody: Record<string, unknown>,
    opts: DispatchOptions,
  ) {
    const targets = await this.settings.listTargetsForEvent(event);
    if (targets.length === 0) return;

    const scoped = await this.filterTargetsByScope(targets, opts.subjectUserId);
    if (scoped.length === 0) return;

    const payload: Prisma.InputJsonObject = {
      event,
      timestamp: new Date().toISOString(),
      origin,
      ...payloadBody,
    } as Prisma.InputJsonObject;

    for (const target of scoped) {
      const idempotencyKey = `${target.ownerUserId ?? 'global'}:${event}:${opts.idempotencySuffix}`;

      const existing = await this.prisma.linkWebhookDelivery.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) continue;

      let deliveryId: string;
      try {
        const delivery = await this.prisma.linkWebhookDelivery.create({
          data: {
            linkRequestId: opts.linkRequestId ?? null,
            ownerUserId: target.ownerUserId,
            event,
            origin,
            idempotencyKey,
            payload,
            status: LinkWebhookDeliveryStatus.PENDING,
            attempts: 0,
          },
          select: { id: true },
        });
        deliveryId = delivery.id;
      } catch (err) {
        // Unique race on idempotencyKey — another emit beat us; skip.
        this.logger.debug(
          `Skipped duplicate delivery ${idempotencyKey}: ${(err as Error).message}`,
        );
        continue;
      }

      await this.producer.enqueueDelivery(deliveryId);
    }
  }

  private async filterTargetsByScope(
    targets: ResolvedWebhookTarget[],
    subjectUserId: string | null | undefined,
  ): Promise<ResolvedWebhookTarget[]> {
    const result: ResolvedWebhookTarget[] = [];
    for (const target of targets) {
      if (!target.ownerUserId) {
        result.push(target); // global/admin subscriber
        continue;
      }
      if (!subjectUserId) {
        // Non-user-scoped events (sync/deal/house) go to all subscribers.
        result.push(target);
        continue;
      }
      if (await this.isInOwnerNetwork(target.ownerUserId, subjectUserId)) {
        result.push(target);
      }
    }
    return result;
  }

  private async isInOwnerNetwork(ownerUserId: string, userId: string) {
    let currentId: string | null = userId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      if (currentId === ownerUserId) return true;
      visited.add(currentId);
      const current: { referredById: string | null } | null =
        await this.prisma.user.findUnique({
          where: { id: currentId },
          select: { referredById: true },
        });
      currentId = current?.referredById ?? null;
    }
    return false;
  }

  /** Realistic, deterministic sample payload per event for the test sender. */
  private buildTestPayload(
    actor: JwtPayload,
    event: LinkWebhookEvent,
  ): Record<string, unknown> {
    const now = new Date().toISOString();
    const envelope = {
      event,
      timestamp: now,
      origin: LINK_WEBHOOK_ORIGINS.TEST,
    };

    switch (event) {
      case LINK_WEBHOOK_EVENTS.AFFILIATE_DATA_SYNCED:
        return {
          ...envelope,
          houseSlug: 'superbet',
          houseName: 'Superbet',
          dates: [now.slice(0, 10)],
          rowsUpserted: 12,
          totals: { cpaQualified: 3, deposit: 450, revShare: 0 },
          triggeredBy: 'cron',
        };
      case LINK_WEBHOOK_EVENTS.DEAL_UPDATED:
        return {
          ...envelope,
          id: 'test-deal',
          name: 'Deal de teste',
          bettingHouseSlug: 'superbet',
          cpa: 150,
          revshare: 35,
          updatedAt: now,
        };
      case LINK_WEBHOOK_EVENTS.HOUSE_UPDATED:
        return {
          ...envelope,
          slug: 'superbet',
          name: 'Superbet',
          active: true,
          updatedAt: now,
        };
      case LINK_WEBHOOK_EVENTS.WITHDRAWAL_CREATED:
        return {
          ...envelope,
          withdrawal: {
            withdrawalId: 'test-withdrawal',
            userId: 'test-user',
            externalUserId: 'panel-42',
            bettingHouse: 'superbet',
            amount: 250,
            originalAmount: 250,
            status: 'PENDING',
            previousStatus: null,
            createdAt: now,
          },
        };
      case LINK_WEBHOOK_EVENTS.WITHDRAWAL_STATUS_CHANGED:
        return {
          ...envelope,
          withdrawal: {
            withdrawalId: 'test-withdrawal',
            userId: 'test-user',
            externalUserId: 'panel-42',
            bettingHouse: 'superbet',
            amount: 250,
            originalAmount: 250,
            status: 'COMPLETED',
            previousStatus: 'PENDING',
            createdAt: now,
          },
        };
      case LINK_WEBHOOK_EVENTS.CREATED:
      case LINK_WEBHOOK_EVENTS.REJECTED:
      case LINK_WEBHOOK_EVENTS.APPROVED:
      default:
        return {
          ...envelope,
          linkRequest: {
            id: 'test-link-request',
            status:
              event === LINK_WEBHOOK_EVENTS.REJECTED
                ? 'REJECTED'
                : event === LINK_WEBHOOK_EVENTS.CREATED
                  ? 'PENDING'
                  : 'FULFILLED',
            bettingHouseSlug: 'superbet',
            message: 'Teste de webhook',
            adminNote: 'Payload de teste',
            links: [
              { label: 'Link principal', url: 'https://example.com/link' },
            ],
            dealId: 'test-deal',
            fulfilledAt: event === LINK_WEBHOOK_EVENTS.APPROVED ? now : null,
            fulfilledByName: actor.email,
            createdAt: now,
            resolvedCpa: 150,
            resolvedRevshare: 35,
            resolvedRuleApplied: 'DEFAULT',
            inviterId: actor.sub,
            inviterCpa: 100,
            requiredHouseSlugs: [],
            missingHouseSlugs: [],
            blockedReason:
              event === LINK_WEBHOOK_EVENTS.REJECTED ? 'RULE_BLOCKED' : null,
          },
          user: {
            id: 'test-user',
            name: 'Cliente do Parceiro',
            email: 'cliente@painel-do-parceiro.com',
            referredById: actor.sub,
          },
          deal: {
            id: 'test-deal',
            name: 'Deal de teste',
            cpa: 150,
            revshare: 35,
          },
          affiliateLink: {
            bettingHouse: 'superbet',
            campaignId: 'test-campaign',
            userLink: 'https://example.com/link',
            cpa: 150,
            revshare: 35,
          },
        };
    }
  }

  private decimalToNumber(value: { toNumber(): number } | null) {
    return value?.toNumber() ?? null;
  }
}
