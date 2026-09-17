import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LinkRequestStatus, type HouseLinkRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  SuperbetAssignmentService,
  SUPERBET_SLUG,
} from '../../superbet-link-pool/index.js';
import {
  BetnacionalAssignmentService,
  BETNACIONAL_SLUG,
} from '../../betnacional-link-pool/index.js';
import {
  HiperbetAssignmentService,
  HIPERBET_SLUG,
} from '../../hiperbet-link-pool/index.js';
import {
  BetanoAssignmentService,
  BETANO_SLUG,
} from '../../betano-link-pool/index.js';
import {
  EsportivaAssignmentService,
  ESPORTIVA_SLUG,
} from '../../esportiva-link-pool/index.js';
import { HouseLinkRuleService } from './house-link-rule.service.js';
import { CpaResolutionService } from './cpa-resolution.service.js';
import { type CpaResolution } from '../domain/types/house-link-rule.types.js';
import { LinkDependencyService } from './link-dependency.service.js';
import { LinkAssignmentLogService } from './link-assignment-log.service.js';
import { realActiveLinkWhere } from './link-active.util.js';

const STALE_RUN_MS = 15 * 60 * 1000; // RUNNING > 15min = travado

interface PoolAssignment {
  tryAssign: (
    userId: string,
    reqId: string,
    opts: { defaultCommission?: { cpa: number; revshare: number } },
  ) => Promise<{ assigned: boolean; campaignId?: string; reason?: string }>;
}

export interface BackfillItemPreview {
  requestId: string;
  userId: string;
  hasSnapshot: boolean;
  savedCpa: number | null;
  computedCpa: number | null;
  diff: number | null;
  wouldOutcome: string;
  missingHouses: string[];
}

export interface BackfillSummary {
  houseSlug: string;
  dryRun: boolean;
  forceRecalculate: boolean;
  evaluated: number;
  processed: number;
  skipped: number;
  blocked: number;
  waitingPool: number;
  waitingSnapshot: number;
  errors: number;
  preview?: BackfillItemPreview[];
}

/**
 * Reprocessa solicitações antigas PENDING com as regras atuais (idempotente).
 * Lock por casa (advisory lock), dry-run sem writes, snapshot preservado por
 * padrão (forceRecalculate só com motivo e só em PENDING). Ver §6/§10/§16/§17.
 */
@Injectable()
export class LinkBackfillService {
  private readonly logger = new Logger(LinkBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly houseLinkRule: HouseLinkRuleService,
    private readonly cpaResolution: CpaResolutionService,
    private readonly linkDependency: LinkDependencyService,
    private readonly assignmentLog: LinkAssignmentLogService,
    private readonly superbetAssignment: SuperbetAssignmentService,
    private readonly betnacionalAssignment: BetnacionalAssignmentService,
    private readonly hiperbetAssignment: HiperbetAssignmentService,
    private readonly betanoAssignment: BetanoAssignmentService,
    private readonly esportivaAssignment: EsportivaAssignmentService,
  ) {}

  async runBackfill(opts: {
    houseSlug: string;
    dryRun: boolean;
    forceRecalculate: boolean;
    adminName: string;
    reason?: string;
  }): Promise<BackfillSummary> {
    const slug = opts.houseSlug.toLowerCase();
    if (opts.forceRecalculate && !opts.reason?.trim()) {
      throw new BadRequestException(
        'forceRecalculate exige um motivo (reason).',
      );
    }

    const rule = await this.houseLinkRule.getRule(slug);
    if (!rule)
      throw new NotFoundException(`Casa "${slug}" sem regra configurada.`);

    const house = await this.prisma.bettingHouse.findUnique({
      where: { slug },
      select: { active: true },
    });
    if (!house?.active)
      throw new BadRequestException(`Casa "${slug}" inativa.`);

    const locked = await this.acquireLock(slug);
    if (!locked) {
      throw new ConflictException(
        `Já existe um backfill em andamento para "${slug}".`,
      );
    }

    const summary: BackfillSummary = {
      houseSlug: slug,
      dryRun: opts.dryRun,
      forceRecalculate: opts.forceRecalculate,
      evaluated: 0,
      processed: 0,
      skipped: 0,
      blocked: 0,
      waitingPool: 0,
      waitingSnapshot: 0,
      errors: 0,
      preview: opts.dryRun ? [] : undefined,
    };

    let runId: string | null = null;
    try {
      await this.markStaleRuns(slug);
      if (!opts.dryRun) {
        const run = await this.prisma.backfillRun.create({
          data: {
            houseSlug: slug,
            status: 'RUNNING',
            dryRun: false,
            adminName: opts.adminName,
            reason: opts.reason ?? null,
          },
          select: { id: true },
        });
        runId = run.id;
      }

      const candidates = await this.prisma.linkRequest.findMany({
        where: {
          bettingHouseSlug: slug,
          status: LinkRequestStatus.PENDING,
          user: { active: true, deletedAt: null },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: {
          id: true,
          userId: true,
          dealId: true,
          resolvedCpa: true,
          resolvedRevshare: true,
          inviterId: true,
          user: { select: { name: true, referredById: true } },
        },
      });

      for (const req of candidates) {
        summary.evaluated++;
        try {
          await this.processCandidate(req, rule, opts, summary);
        } catch (err) {
          summary.errors++;
          this.logger.error(
            `Backfill item ${req.id} failed: ${(err as Error).message}`,
          );
        }
      }

      if (runId) {
        await this.prisma.backfillRun.update({
          where: { id: runId },
          data: {
            status: 'DONE',
            finishedAt: new Date(),
            evaluated: summary.evaluated,
            processed: summary.processed,
            skipped: summary.skipped,
            blocked: summary.blocked,
            waitingPool: summary.waitingPool,
            waitingSnapshot: summary.waitingSnapshot,
            errors: summary.errors,
          },
        });
      }
    } finally {
      await this.releaseLock(slug);
    }

    return summary;
  }

  private async processCandidate(
    req: {
      id: string;
      userId: string;
      dealId: string | null;
      resolvedCpa: { toNumber(): number } | null;
      resolvedRevshare: { toNumber(): number } | null;
      inviterId: string | null;
      user: { name: string; referredById: string | null };
    },
    rule: HouseLinkRule,
    opts: {
      dryRun: boolean;
      forceRecalculate: boolean;
      adminName: string;
      reason?: string;
    },
    summary: BackfillSummary,
  ): Promise<void> {
    const slug = rule.houseSlug;

    // Já possui link real ativo → pula (idempotência §10).
    const realLink = await this.prisma.affiliateLink.findFirst({
      where: realActiveLinkWhere(req.userId, slug),
      select: { id: true },
    });
    if (realLink) {
      summary.skipped++;
      if (!opts.dryRun) {
        await this.assignmentLog.record({
          linkRequestId: req.id,
          userId: req.userId,
          userName: req.user.name,
          houseSlug: slug,
          outcome: 'SKIPPED',
          ruleApplied: 'ALREADY_HAS_LINK',
          origin: 'BACKFILL_OLD_REQUESTS',
          message: 'Usuário já possui link real ativo.',
        });
      }
      return;
    }

    const hasSnapshot = req.resolvedCpa !== null;
    let cpa: number;
    let revshare: number;
    let computedCpa: number | null = null;

    if (hasSnapshot && !opts.forceRecalculate) {
      cpa = req.resolvedCpa!.toNumber();
      revshare = req.resolvedRevshare?.toNumber() ?? 0;
    } else {
      const inviterId = req.inviterId ?? req.user.referredById ?? null;
      // forceRecalculate ignora CPA existente e recalcula pela regra;
      // caso contrário preserva o CPA já definido pelo convidante (se houver).
      const snap = opts.forceRecalculate
        ? this.wrapResolution(
            await this.cpaResolution.resolveCpa({
              houseSlug: slug,
              dealId: req.dealId,
              userId: req.userId,
              inviterId,
              rule,
            }),
          )
        : await this.resolveOrPreserve(req.userId, inviterId, rule, req.dealId);
      cpa = snap.cpa;
      revshare = snap.revshare;
      computedCpa = snap.hold ? null : snap.cpa;
      if (!opts.dryRun) {
        await this.prisma.linkRequest.update({
          where: { id: req.id },
          data: {
            // Em espera: convidante sem CPA na casa → resolvedCpa=null (aguarda).
            resolvedCpa: snap.hold ? null : snap.cpa,
            resolvedRevshare: snap.hold ? null : snap.revshare,
            resolvedRuleApplied: snap.hold ? null : snap.ruleApplied,
            houseRuleId: rule.id,
            houseRuleUpdatedAt: rule.updatedAt,
            resolvedAt: snap.hold ? null : new Date(),
            inviterId: snap.inviterId,
            inviterCpa: snap.inviterCpa,
            rangeReferenceHouse: snap.rangeReferenceHouse,
            rangeReferenceCpa: snap.rangeReferenceCpa,
          },
        });
      }
      // Em espera: não segue p/ dependência/atribuição — fica PENDING até o
      // convidante ter link+CPA (o cron re-resolve).
      if (snap.hold) {
        summary.waitingPool++;
        if (opts.dryRun) {
          summary.preview!.push({
            requestId: req.id,
            userId: req.userId,
            hasSnapshot,
            savedCpa: hasSnapshot ? req.resolvedCpa!.toNumber() : null,
            computedCpa: null,
            diff: null,
            wouldOutcome: 'WAITING_SNAPSHOT',
            missingHouses: [],
          });
        } else {
          await this.assignmentLog.record({
            linkRequestId: req.id,
            userId: req.userId,
            userName: req.user.name,
            houseSlug: slug,
            assignedCpa: 0,
            outcome: 'WAITING_SNAPSHOT',
            origin: 'BACKFILL_OLD_REQUESTS',
            adminName: opts.adminName,
            reason: opts.reason ?? null,
            message:
              'Em espera: convidante ainda sem CPA na casa — aguardando link+CPA.',
          });
        }
        return;
      }
    }

    // Dependência entre casas.
    const dep = await this.linkDependency.checkRequiredLinks(req.userId, rule);
    if (!dep.ok) {
      summary.blocked++;
      if (opts.dryRun) {
        summary.preview!.push({
          requestId: req.id,
          userId: req.userId,
          hasSnapshot,
          savedCpa: hasSnapshot ? req.resolvedCpa!.toNumber() : null,
          computedCpa,
          diff: null,
          wouldOutcome: 'BLOCKED',
          missingHouses: dep.missingHouses,
        });
        return;
      }
      const block = rule.blockOnRequiredFail;
      await this.prisma.linkRequest.update({
        where: { id: req.id },
        data: {
          status: block
            ? LinkRequestStatus.REJECTED
            : LinkRequestStatus.PENDING,
          requiredHouseSlugs: dep.requiredHouses,
          missingHouseSlugs: dep.missingHouses,
          blockedReason:
            rule.blockMessage ||
            `Faltam links ativos em: ${dep.missingHouses.join(', ')}.`,
          blockedMetadata: { missingHouseSlugs: dep.missingHouses },
        },
      });
      await this.assignmentLog.record({
        linkRequestId: req.id,
        userId: req.userId,
        userName: req.user.name,
        houseSlug: slug,
        ruleApplied: 'BLOCKED',
        outcome: block ? 'BLOCKED' : 'WAITING_MANUAL_REVIEW',
        origin: 'BACKFILL_OLD_REQUESTS',
        requiredHouses: dep.requiredHouses,
        missingHouses: dep.missingHouses,
      });
      return;
    }

    // Dry-run: não atribui, só prevê.
    if (opts.dryRun) {
      const assignment = this.poolAssignmentFor(slug);
      summary.preview!.push({
        requestId: req.id,
        userId: req.userId,
        hasSnapshot,
        savedCpa: hasSnapshot ? req.resolvedCpa!.toNumber() : null,
        computedCpa,
        diff:
          hasSnapshot && computedCpa !== null
            ? computedCpa - req.resolvedCpa!.toNumber()
            : null,
        wouldOutcome: assignment
          ? 'LINK_ASSIGNED|WAITING_POOL_LINK'
          : 'WAITING_POOL_LINK',
        missingHouses: [],
      });
      return;
    }

    // Atribui via pool usando o snapshot.
    const assignment = this.poolAssignmentFor(slug);
    let outcome: 'LINK_ASSIGNED' | 'WAITING_POOL_LINK' = 'WAITING_POOL_LINK';
    if (assignment) {
      const result = await assignment.tryAssign(req.userId, req.id, {
        defaultCommission: { cpa, revshare },
      });
      if (result.assigned) {
        outcome = 'LINK_ASSIGNED';
        summary.processed++;
      } else {
        summary.waitingPool++;
      }
    } else {
      summary.waitingPool++;
    }

    await this.assignmentLog.record({
      linkRequestId: req.id,
      userId: req.userId,
      userName: req.user.name,
      houseSlug: slug,
      assignedCpa: cpa,
      outcome,
      origin: 'BACKFILL_OLD_REQUESTS',
      adminName: opts.adminName,
      reason: opts.reason ?? null,
      message:
        computedCpa !== null
          ? `CPA recalculado R$${cpa} (forceRecalculate=${opts.forceRecalculate})`
          : `CPA do snapshot R$${cpa}`,
    });
  }

  /** Reprocessamento manual de uma solicitação (§11/§34/§35). */
  async reprocessRequest(
    requestId: string,
    opts: { reason: string; recalculateSnapshot: boolean; adminName: string },
  ): Promise<{ status: string; outcome: string }> {
    if (!opts.reason?.trim()) {
      throw new BadRequestException('reason é obrigatório.');
    }
    const req = await this.prisma.linkRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        userId: true,
        dealId: true,
        status: true,
        bettingHouseSlug: true,
        resolvedCpa: true,
        resolvedRevshare: true,
        resolvedRuleApplied: true,
        inviterId: true,
        user: { select: { name: true, referredById: true } },
      },
    });
    if (!req) throw new NotFoundException('Solicitação não encontrada.');

    // FULFILLED não recalcula nem troca link por padrão (§35).
    if (req.status === LinkRequestStatus.FULFILLED) {
      throw new BadRequestException(
        'Solicitação já FULFILLED — ajuste de CPA exige fluxo administrativo específico.',
      );
    }

    const slug = req.bettingHouseSlug;
    const rule = await this.houseLinkRule.getRule(slug);
    if (!rule) throw new NotFoundException(`Casa "${slug}" sem regra.`);

    let cpa = req.resolvedCpa?.toNumber() ?? 0;
    let revshare = req.resolvedRevshare?.toNumber() ?? 0;
    const oldCpa = req.resolvedCpa?.toNumber() ?? null;
    const oldRule = req.resolvedRuleApplied;
    let newRule = req.resolvedRuleApplied;

    if (opts.recalculateSnapshot || req.resolvedCpa === null) {
      const inviterId = req.inviterId ?? req.user.referredById ?? null;
      const resolution = await this.cpaResolution.resolveCpa({
        houseSlug: slug,
        dealId: req.dealId,
        userId: req.userId,
        inviterId,
        rule,
      });
      if (resolution.hold) {
        await this.prisma.linkRequest.update({
          where: { id: requestId },
          data: {
            status: LinkRequestStatus.PENDING,
            resolvedCpa: null,
            resolvedRevshare: null,
            resolvedRuleApplied: null,
            houseRuleId: rule.id,
            houseRuleUpdatedAt: rule.updatedAt,
            resolvedAt: null,
            inviterId: resolution.inviterId,
            inviterCpa: null,
            rangeReferenceHouse: resolution.rangeReferenceHouse,
            rangeReferenceCpa: resolution.rangeReferenceCpa,
            blockedReason: '',
            missingHouseSlugs: [],
          },
        });
        await this.assignmentLog.record({
          linkRequestId: req.id,
          userId: req.userId,
          userName: req.user.name,
          houseSlug: slug,
          inviterId: resolution.inviterId,
          inviterCpa: null,
          assignedCpa: 0,
          outcome: 'WAITING_SNAPSHOT',
          origin: 'ADMIN_REPROCESS',
          adminName: opts.adminName,
          reason: opts.reason,
          statusBefore: req.status,
          statusAfter: LinkRequestStatus.PENDING,
          message:
            'Em espera: convidante ainda não possui CPA FULFILLED nesta deal.',
        });
        return {
          status: LinkRequestStatus.PENDING,
          outcome: 'WAITING_SNAPSHOT',
        };
      }
      cpa = resolution.cpa;
      revshare = resolution.revshare;
      newRule = resolution.ruleApplied;
      await this.prisma.linkRequest.update({
        where: { id: requestId },
        data: {
          resolvedCpa: resolution.cpa,
          resolvedRevshare: resolution.revshare,
          resolvedRuleApplied: resolution.ruleApplied,
          houseRuleId: rule.id,
          houseRuleUpdatedAt: rule.updatedAt,
          resolvedAt: new Date(),
          inviterId: resolution.inviterId,
          inviterCpa: resolution.inviterCpa,
          rangeReferenceHouse: resolution.rangeReferenceHouse,
          rangeReferenceCpa: resolution.rangeReferenceCpa,
        },
      });
    }

    // Dependência entre casas (ex.: esportiva exige superbet real ativo).
    // Sem isso o reprocess de uma solicitação REJECTED ficava silencioso.
    const dep = await this.linkDependency.checkRequiredLinks(req.userId, rule);
    if (!dep.ok) {
      const blockedStatus = rule.blockOnRequiredFail
        ? LinkRequestStatus.REJECTED
        : LinkRequestStatus.PENDING;
      await this.prisma.linkRequest.update({
        where: { id: req.id },
        data: {
          status: blockedStatus,
          requiredHouseSlugs: dep.requiredHouses,
          missingHouseSlugs: dep.missingHouses,
          blockedReason:
            rule.blockMessage ||
            `Faltam links ativos em: ${dep.missingHouses.join(', ')}.`,
          blockedMetadata: { missingHouseSlugs: dep.missingHouses },
        },
      });
      await this.assignmentLog.record({
        linkRequestId: req.id,
        userId: req.userId,
        userName: req.user.name,
        houseSlug: slug,
        assignedCpa: cpa,
        ruleApplied: newRule,
        outcome: 'BLOCKED',
        origin: 'ADMIN_REPROCESS',
        adminName: opts.adminName,
        reason: opts.reason,
        requiredHouses: dep.requiredHouses,
        missingHouses: dep.missingHouses,
        statusBefore: req.status,
        statusAfter: blockedStatus,
        message: `Reprocesso manual bloqueado: faltam ${dep.missingHouses.join(', ')}.`,
      });
      return { status: blockedStatus, outcome: 'BLOCKED' };
    }

    // Dependência OK: se estava REJECTED, reabre p/ PENDING — senão o tryAssign
    // das casas (que exige PENDING) vira no-op e "nada acontece".
    if (req.status === LinkRequestStatus.REJECTED) {
      await this.prisma.linkRequest.update({
        where: { id: req.id },
        data: {
          status: LinkRequestStatus.PENDING,
          blockedReason: '',
          missingHouseSlugs: [],
        },
      });
    }

    const assignment = this.poolAssignmentFor(slug);
    let outcome: 'LINK_ASSIGNED' | 'WAITING_POOL_LINK' | 'BLOCKED' =
      'WAITING_POOL_LINK';
    let status: LinkRequestStatus =
      req.status === LinkRequestStatus.REJECTED
        ? LinkRequestStatus.PENDING
        : req.status;
    if (assignment) {
      const result = await assignment.tryAssign(req.userId, req.id, {
        defaultCommission: { cpa, revshare },
      });
      if (result.assigned) {
        outcome = 'LINK_ASSIGNED';
        status = LinkRequestStatus.FULFILLED;
      }
    }

    await this.assignmentLog.record({
      linkRequestId: req.id,
      userId: req.userId,
      userName: req.user.name,
      houseSlug: slug,
      assignedCpa: cpa,
      ruleApplied: newRule,
      outcome,
      origin: 'ADMIN_REPROCESS',
      adminName: opts.adminName,
      reason: opts.reason,
      statusBefore: req.status,
      statusAfter: status,
      message: `Reprocesso manual. CPA ${oldCpa ?? '—'}→${cpa}, regra ${oldRule ?? '—'}→${newRule ?? '—'}.`,
    });

    return { status, outcome };
  }

  // ─── Cron: snapshot automático de solicitações antigas (oldest-first) ───────
  // Casas com processOldRequests=true: resolve CPA + dependência das PENDING
  // SEM snapshot (DB-only, sem planilha) → o scheduler do pool atribui depois,
  // também oldest-first. Origem BACKFILL_OLD_REQUESTS (auditável, não silencioso).
  @Cron('*/1 * * * *', {
    timeZone: 'America/Sao_Paulo',
    name: 'auto-snapshot-old-requests',
  })
  async autoSnapshotOldRequests(): Promise<void> {
    const rules = await this.prisma.houseLinkRule.findMany({
      where: { autoAssignEnabled: true, processOldRequests: true },
    });
    for (const rule of rules) {
      const slug = rule.houseSlug;
      const locked = await this.acquireLock(slug);
      if (!locked) continue; // backfill manual em andamento p/ esta casa
      try {
        const pend = await this.prisma.linkRequest.findMany({
          where: {
            bettingHouseSlug: slug,
            status: LinkRequestStatus.PENDING,
            resolvedCpa: null,
            user: { active: true, deletedAt: null },
          },
          orderBy: { createdAt: 'asc' },
          take: 300,
          select: {
            id: true,
            userId: true,
            dealId: true,
            inviterId: true,
            user: { select: { name: true, referredById: true } },
          },
        });
        if (pend.length === 0) continue;
        let done = 0;
        for (const req of pend) {
          try {
            await this.snapshotOne(req, rule);
            done++;
          } catch (err) {
            this.logger.error(
              `auto-snapshot ${req.id}: ${(err as Error).message}`,
            );
          }
        }
        this.logger.log(
          `[${slug}] auto-snapshot: ${done}/${pend.length} solicitações antigas snapshotadas`,
        );
      } finally {
        await this.releaseLock(slug);
      }
    }
  }

  /** Resolve CPA + dependência e grava snapshot (DB-only, NÃO atribui link). */
  private async snapshotOne(
    req: {
      id: string;
      userId: string;
      dealId: string | null;
      inviterId: string | null;
      user: { name: string; referredById: string | null };
    },
    rule: HouseLinkRule,
  ): Promise<void> {
    const dep = await this.linkDependency.checkRequiredLinks(req.userId, rule);
    if (!dep.ok) {
      const block = rule.blockOnRequiredFail;
      await this.prisma.linkRequest.update({
        where: { id: req.id },
        data: {
          status: block
            ? LinkRequestStatus.REJECTED
            : LinkRequestStatus.PENDING,
          requiredHouseSlugs: dep.requiredHouses,
          missingHouseSlugs: dep.missingHouses,
          blockedReason:
            rule.blockMessage ||
            `Faltam links ativos em: ${dep.missingHouses.join(', ')}.`,
          blockedMetadata: { missingHouseSlugs: dep.missingHouses },
        },
      });
      await this.assignmentLog.record({
        linkRequestId: req.id,
        userId: req.userId,
        userName: req.user.name,
        houseSlug: rule.houseSlug,
        ruleApplied: 'BLOCKED',
        outcome: block ? 'BLOCKED' : 'WAITING_MANUAL_REVIEW',
        origin: 'BACKFILL_OLD_REQUESTS',
        requiredHouses: dep.requiredHouses,
        missingHouses: dep.missingHouses,
      });
      return;
    }
    const snap = await this.resolveOrPreserve(
      req.userId,
      req.inviterId ?? req.user.referredById ?? null,
      rule,
      req.dealId,
    );
    // Em espera: convidante ainda sem CPA na casa → mantém resolvedCpa=null
    // (pedido continua PENDING, pool não atribui). O cron re-resolve na próxima
    // passada; quando o convidante tiver link+CPA, resolve de verdade.
    await this.prisma.linkRequest.update({
      where: { id: req.id },
      data: {
        resolvedCpa: snap.hold ? null : snap.cpa,
        resolvedRevshare: snap.hold ? null : snap.revshare,
        resolvedRuleApplied: snap.hold ? null : snap.ruleApplied,
        houseRuleId: rule.id,
        houseRuleUpdatedAt: rule.updatedAt,
        resolvedAt: snap.hold ? null : new Date(),
        inviterId: snap.inviterId,
        inviterCpa: snap.inviterCpa,
        rangeReferenceHouse: snap.rangeReferenceHouse,
        rangeReferenceCpa: snap.rangeReferenceCpa,
        requiredHouseSlugs: dep.requiredHouses,
        missingHouseSlugs: [],
      },
    });
    await this.assignmentLog.record({
      linkRequestId: req.id,
      userId: req.userId,
      userName: req.user.name,
      houseSlug: rule.houseSlug,
      inviterId: snap.inviterId,
      inviterCpa: snap.inviterCpa,
      assignedCpa: snap.hold ? 0 : snap.cpa,
      ruleApplied: snap.hold ? null : snap.ruleApplied,
      outcome: snap.hold ? 'WAITING_SNAPSHOT' : 'WAITING_POOL_LINK',
      origin: 'BACKFILL_OLD_REQUESTS',
      togglesApplied: snap.togglesApplied,
      requiredHouses: dep.requiredHouses,
      message: snap.hold
        ? 'Em espera: convidante ainda sem CPA na casa — aguardando link+CPA do convidante.'
        : snap.preserved
          ? `Snapshot automático: CPA preservado do convidante R$${snap.cpa}`
          : `Snapshot automático: CPA R$${snap.cpa} (${snap.ruleApplied})`,
    });
  }

  /**
   * Para solicitações antigas: se o convidado JÁ tem um CPA definido (pelo
   * convidante/fluxo antigo) numa AffiliateLink da casa, PRESERVA esse valor.
   * Caso contrário, resolve pela regra configurada.
   */
  private async resolveOrPreserve(
    userId: string,
    inviterId: string | null,
    rule: HouseLinkRule,
    dealId: string | null,
  ): Promise<{
    cpa: number;
    revshare: number;
    ruleApplied: import('@prisma/client').LinkAssignmentRuleApplied | null;
    inviterId: string | null;
    inviterCpa: number | null;
    rangeReferenceHouse: string | null;
    rangeReferenceCpa: number | null;
    togglesApplied: string[];
    preserved: boolean;
    hold: boolean;
  }> {
    if (rule.houseSlug === SUPERBET_SLUG && dealId) {
      return this.wrapResolution(
        await this.cpaResolution.resolveCpa({
          houseSlug: rule.houseSlug,
          dealId,
          userId,
          inviterId,
          rule,
        }),
      );
    }

    const existing = await this.prisma.affiliateLink.findFirst({
      where: {
        userId,
        bettingHouse: rule.houseSlug,
        deletedAt: null,
        cpa: { not: null },
      },
      select: { cpa: true, revshare: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing?.cpa != null) {
      return {
        cpa: existing.cpa.toNumber(),
        revshare: existing.revshare?.toNumber() ?? 0,
        ruleApplied: null,
        inviterId,
        inviterCpa: null,
        rangeReferenceHouse: null,
        rangeReferenceCpa: null,
        togglesApplied: ['preservedExistingCpa'],
        preserved: true,
        hold: false,
      };
    }
    const r = await this.cpaResolution.resolveCpa({
      houseSlug: rule.houseSlug,
      dealId,
      userId,
      inviterId,
      rule,
    });
    return {
      cpa: r.cpa,
      revshare: r.revshare,
      ruleApplied: r.ruleApplied,
      inviterId: r.inviterId,
      inviterCpa: r.inviterCpa,
      rangeReferenceHouse: r.rangeReferenceHouse,
      rangeReferenceCpa: r.rangeReferenceCpa,
      togglesApplied: r.togglesApplied,
      preserved: false,
      hold: r.hold ?? false,
    };
  }

  private wrapResolution(r: CpaResolution): {
    cpa: number;
    revshare: number;
    ruleApplied: import('@prisma/client').LinkAssignmentRuleApplied | null;
    inviterId: string | null;
    inviterCpa: number | null;
    rangeReferenceHouse: string | null;
    rangeReferenceCpa: number | null;
    togglesApplied: string[];
    preserved: boolean;
    hold: boolean;
  } {
    return {
      cpa: r.cpa,
      revshare: r.revshare,
      ruleApplied: r.ruleApplied,
      inviterId: r.inviterId,
      inviterCpa: r.inviterCpa,
      rangeReferenceHouse: r.rangeReferenceHouse,
      rangeReferenceCpa: r.rangeReferenceCpa,
      togglesApplied: r.togglesApplied,
      preserved: false,
      hold: r.hold ?? false,
    };
  }

  private poolAssignmentFor(houseSlug: string): PoolAssignment | null {
    switch (houseSlug) {
      case SUPERBET_SLUG:
        return this.superbetAssignment;
      case BETNACIONAL_SLUG:
        return this.betnacionalAssignment;
      case HIPERBET_SLUG:
        return this.hiperbetAssignment;
      case BETANO_SLUG:
        return this.betanoAssignment;
      case ESPORTIVA_SLUG:
        return this.esportivaAssignment;
      default:
        return null;
    }
  }

  // ─── concorrência: Postgres advisory lock por casa (§16) ───────────────────
  private async acquireLock(slug: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${`backfill:${slug}`})) AS locked
    `;
    return rows[0]?.locked === true;
  }

  private async releaseLock(slug: string): Promise<void> {
    await this.prisma.$queryRaw`
      SELECT pg_advisory_unlock(hashtext(${`backfill:${slug}`}))
    `;
  }

  private async markStaleRuns(slug: string): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_RUN_MS);
    await this.prisma.backfillRun.updateMany({
      where: { houseSlug: slug, status: 'RUNNING', startedAt: { lt: cutoff } },
      data: {
        status: 'FAILED_STALE',
        staleAt: new Date(),
        failedReason: 'stale timeout',
      },
    });
  }
}
