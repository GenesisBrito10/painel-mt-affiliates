import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  LinkRequestStatus,
  NotificationType,
  UserRole,
  type LinkAssignmentOutcome,
} from '@prisma/client';
import { CryptoService } from '../../shared/crypto.service.js';
import { NotificationService } from '../../notification/application/notification.service.js';
import {
  clampPagination,
  buildUserSearchWhere,
} from '../../../common/pagination/index.js';
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
  BetanoDiarioAssignmentService,
  BETANO_DIARIO_SLUG,
} from '../../betano-diario-link-pool/index.js';
import {
  EsportivaDiarioAssignmentService,
  ESPORTIVA_DIARIO_SLUG,
} from '../../esportiva-diario-link-pool/index.js';
import {
  EsportivaAssignmentService,
  ESPORTIVA_SLUG,
} from '../../esportiva-link-pool/index.js';
import {
  SportingbetAssignmentService,
  SPORTINGBET_SLUG,
} from '../../sportingbet-link-pool/index.js';
import {
  SportingbetDiarioAssignmentService,
  SPORTINGBET_DIARIO_SLUG,
} from '../../sportingbet-diario-link-pool/index.js';
import {
  PinbetDiarioAssignmentService,
  PINBET_DIARIO_SLUG,
} from '../../pinbet-diario-link-pool/index.js';
import {
  PinbetMensalAssignmentService,
  PINBET_MENSAL_SLUG,
} from '../../pinbet-mensal-link-pool/index.js';
import { DealEligibilityService } from './deal-eligibility.service.js';
import { HouseLinkRuleService } from './house-link-rule.service.js';
import { CpaResolutionService } from './cpa-resolution.service.js';
import { LinkDependencyService } from './link-dependency.service.js';
import { LinkAssignmentLogService } from './link-assignment-log.service.js';
import { LinkWebhookService } from '../../link-webhook/index.js';
import {
  isDealEligibilityRequired,
  MANUAL_CAMPAIGN_ID_HOUSES,
  ONE_REQUEST_PER_ACCOUNT_HOUSES,
  POOL_HOUSES,
  type LinkRequestCreateResult,
  type LinkRequestListItem,
  type LinkItem,
} from '../domain/types/link-request.types.js';
import type {
  CreateLinkRequestDto,
  ListLinkRequestsQueryDto,
  UpdateLinkRequestDto,
  SetLinkRequestCpaDto,
  ListDealRequestsQueryDto,
  ApproveDealRequestDto,
} from './dto/link-request.dto.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { REAL_ACTIVE_LINK_WHERE } from './link-active.util.js';
import { extractCampaignIdFromUrl } from '../domain/campaign-id.js';

/**
 * Prisma user select shared by every query whose row is mapped through
 * `toListItem`. Carries the request owner's identity plus `referredBy`
 * (quem indicou) so list items mirror the affiliates listing's "Indicador".
 */
const LIST_ITEM_USER_SELECT = {
  name: true,
  email: true,
  referredBy: { select: { id: true, name: true, email: true } },
} as const;

// ─── Form-deal (kind=FORM) schema ──────────────────────────────────────────
// Definição dinâmica de um campo do formulário (Deal.formSchema é FormField[]).
// Mantido propositalmente flexível — o admin edita/adiciona campos sem migração.
type FormFieldOption =
  | string
  | { value: string; label?: string; cpa?: number; revshare?: number };

interface FormField {
  key: string;
  label?: string;
  type: string; // text | email | tel | password | select | multiselect | textarea
  required?: boolean;
  readonly?: boolean;
  secret?: boolean; // true → valor criptografado antes de gravar em formData
  prefill?: string; // ex.: "user.email" (resolvido no front)
  group?: string;
  options?: FormFieldOption[];
}

@Injectable()
export class LinkRequestService {
  private readonly logger = new Logger(LinkRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: DealEligibilityService,
    private readonly superbetAssignment: SuperbetAssignmentService,
    private readonly betnacionalAssignment: BetnacionalAssignmentService,
    private readonly hiperbetAssignment: HiperbetAssignmentService,
    private readonly betanoAssignment: BetanoAssignmentService,
    private readonly betanoDiarioAssignment: BetanoDiarioAssignmentService,
    private readonly esportivaDiarioAssignment: EsportivaDiarioAssignmentService,
    private readonly esportivaAssignment: EsportivaAssignmentService,
    private readonly sportingbetAssignment: SportingbetAssignmentService,
    private readonly sportingbetDiarioAssignment: SportingbetDiarioAssignmentService,
    private readonly pinbetDiarioAssignment: PinbetDiarioAssignmentService,
    private readonly pinbetMensalAssignment: PinbetMensalAssignmentService,
    private readonly houseLinkRule: HouseLinkRuleService,
    private readonly cpaResolution: CpaResolutionService,
    private readonly linkDependency: LinkDependencyService,
    private readonly assignmentLog: LinkAssignmentLogService,
    private readonly linkWebhook: LinkWebhookService,
    private readonly crypto: CryptoService,
    private readonly notification: NotificationService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/link-requests
  // ─────────────────────────────────────────────────────────────────────────

  async create(
    userId: string,
    dto: CreateLinkRequestDto,
    options: { skipEligibility?: boolean } = {},
  ): Promise<LinkRequestCreateResult> {
    if (!dto.dealId && !dto.bettingHouseSlug) {
      throw new BadRequestException('Informe o dealId ou bettingHouseSlug.');
    }

    // Resolve deal — by id or by finding the first active deal for the house slug
    const dealSelect = {
      id: true,
      bettingHouseSlug: true,
      minAvgDepositPerFtd: true,
      minQualifiedFtd: true,
      active: true,
      kind: true,
      formSchema: true,
    } as const;
    const deal = dto.dealId
      ? await this.prisma.deal.findUnique({
          where: { id: dto.dealId },
          select: dealSelect,
        })
      : await this.prisma.deal.findFirst({
          where: {
            bettingHouseSlug: dto.bettingHouseSlug!.toLowerCase(),
            active: true,
          },
          select: dealSelect,
          orderBy: { createdAt: 'desc' },
        });

    if (!deal || !deal.active)
      throw new NotFoundException(
        'Deal não encontrado ou inativo para esta casa.',
      );

    // Deals tipo FORM têm fluxo próprio: valida o formulário, criptografa campos
    // secretos e cria 1 solicitação PENDENTE por casa selecionada — sem
    // eligibility/pool auto-assign (que é específico das deals LINK).
    if (deal.kind === 'FORM') {
      return this.createFormRequest(userId, deal, dto);
    }

    const houseSlug = deal.bettingHouseSlug.toLowerCase();

    const house = await this.prisma.bettingHouse.findFirst({
      where: { slug: houseSlug, active: true },
      select: { name: true, slug: true },
    });
    if (!house)
      throw new BadRequestException('Casa deste deal não está disponível.');

    // 1-per-account houses: any status, any deal
    if (
      (ONE_REQUEST_PER_ACCOUNT_HOUSES as readonly string[]).includes(houseSlug)
    ) {
      const existing = await this.prisma.linkRequest.findFirst({
        where: { userId, bettingHouseSlug: houseSlug },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `Apenas 1 solicitação de link é permitida por conta em ${house.name}.`,
        );
      }
    }

    // Skip eligibility if the user already has an AffiliateLink for this house
    const hasExistingLink = await this.prisma.affiliateLink.findFirst({
      where: {
        userId,
        bettingHouse: houseSlug,
        ...REAL_ACTIVE_LINK_WHERE,
      },
      select: { id: true },
    });

    if (
      !options.skipEligibility &&
      isDealEligibilityRequired(houseSlug, !!hasExistingLink)
    ) {
      const result = await this.eligibility.check(
        userId,
        houseSlug,
        houseSlug === BETANO_DIARIO_SLUG
          ? 0
          : deal.minAvgDepositPerFtd.toNumber(),
        deal.minQualifiedFtd,
      );
      if (!result.eligible) {
        throw new HttpException(
          {
            message: `Você ainda não atende aos requisitos para solicitar deals em ${house.name}.`,
            error: `Você ainda não atende aos requisitos para solicitar deals em ${house.name}.`,
            ...result,
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // Block duplicate pending request for the same deal
    const pendingForDeal = await this.prisma.linkRequest.findFirst({
      where: { userId, dealId: deal.id, status: LinkRequestStatus.PENDING },
      select: { id: true },
    });
    if (pendingForDeal) {
      throw new ConflictException(
        'Já existe uma solicitação pendente para este deal.',
      );
    }

    return this.resolveAndAssign(userId, deal.id, houseSlug, dto.message ?? '');
  }

  /**
   * Fluxo genérico de atribuição automática (substitui os 4 blocos por casa):
   * regra → dependência → CPA (snapshot) → cria LinkRequest com snapshot →
   * tenta pool → log. NUNCA depende de CPA manual do líder nem de timeout 24h.
   */
  private async resolveAndAssign(
    userId: string,
    dealId: string | null,
    houseSlug: string,
    message: string,
  ): Promise<LinkRequestCreateResult> {
    const rule = await this.houseLinkRule.getRule(houseSlug);

    const requester = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referredById: true, name: true },
    });
    const inviterId = requester?.referredById ?? null;
    const userName = requester?.name ?? '';

    const baseSelect = {
      id: true,
      userId: true,
      dealId: true,
      bettingHouseSlug: true,
      message: true,
      status: true,
      createdAt: true,
    } as const;

    // Casa sem regra configurada → comportamento legado: PENDING manual.
    if (!rule) {
      const item = await this.prisma.linkRequest.create({
        data: { userId, dealId, bettingHouseSlug: houseSlug, message },
        select: baseSelect,
      });
      await this.assignmentLog.record({
        linkRequestId: item.id,
        userId,
        userName,
        houseSlug,
        outcome: 'SKIPPED_AUTO_ASSIGN',
        origin: 'NEW_REQUEST',
        statusAfter: item.status,
        message: 'Casa sem regra configurada — solicitação manual.',
      });
      return this.toCreateResult(item);
    }

    // Casa desativada para solicitação → REJECTED (mantém histórico, §11).
    if (!rule.requestEnabled) {
      const reason =
        rule.blockMessage || 'Solicitação desativada para esta casa.';
      const item = await this.prisma.linkRequest.create({
        data: {
          userId,
          dealId,
          bettingHouseSlug: houseSlug,
          message,
          status: LinkRequestStatus.REJECTED,
          houseRuleId: rule.id,
          blockedReason: reason,
        },
        select: baseSelect,
      });
      await this.assignmentLog.record({
        linkRequestId: item.id,
        userId,
        userName,
        houseSlug,
        outcome: 'BLOCKED',
        ruleApplied: 'BLOCKED',
        origin: 'NEW_REQUEST',
        statusAfter: item.status,
        message: reason,
      });
      await this.notifyRejected(item.id, 'RULE_BLOCKED');
      return this.toCreateResult(item);
    }

    // Dependência genérica entre casas.
    const dependency = await this.linkDependency.checkRequiredLinks(
      userId,
      rule,
    );
    if (!dependency.ok) {
      const block = rule.blockOnRequiredFail;
      const status = block
        ? LinkRequestStatus.REJECTED
        : LinkRequestStatus.PENDING;
      const reason =
        rule.blockMessage ||
        `Para solicitar link desta casa, você precisa possuir link ativo nas seguintes casas: ${dependency.missingHouses.join(', ')}.`;
      const item = await this.prisma.linkRequest.create({
        data: {
          userId,
          dealId,
          bettingHouseSlug: houseSlug,
          message,
          status,
          houseRuleId: rule.id,
          requiredHouseSlugs: dependency.requiredHouses,
          missingHouseSlugs: dependency.missingHouses,
          blockedReason: reason,
          blockedMetadata: { missingHouseSlugs: dependency.missingHouses },
        },
        select: baseSelect,
      });
      await this.assignmentLog.record({
        linkRequestId: item.id,
        userId,
        userName,
        houseSlug,
        ruleApplied: 'BLOCKED',
        outcome: block ? 'BLOCKED' : 'WAITING_MANUAL_REVIEW',
        origin: 'NEW_REQUEST',
        requiredHouses: dependency.requiredHouses,
        missingHouses: dependency.missingHouses,
        statusAfter: item.status,
        message: reason,
      });
      if (status === LinkRequestStatus.REJECTED) {
        await this.notifyRejected(item.id, 'DEPENDENCY_BLOCKED');
      }
      return this.toCreateResult(item);
    }

    // Resolve o CPA (snapshot) — fonte de verdade enquanto aguarda link no pool.
    const resolution = await this.cpaResolution.resolveCpa({
      houseSlug,
      dealId,
      userId,
      inviterId,
      rule,
    });

    // Em espera (casas HOLD): quem pediu tem convidante mas o convidante ainda
    // não tem CPA ativo na casa → NÃO resolve CPA agora. resolvedCpa=null deixa
    // o pedido PENDING (scheduler do pool ignora) até o cron auto-snapshot
    // re-resolver quando o convidante tiver link+CPA.
    const holdForInviter = resolution.hold === true;

    const item = await this.prisma.linkRequest.create({
      data: {
        userId,
        dealId,
        bettingHouseSlug: houseSlug,
        message,
        // Snapshot da regra da casa. A Esportiva Diário também usa o snapshot:
        // o scheduler só atribui link quando resolvedCpa já está preenchido.
        resolvedCpa: holdForInviter ? null : resolution.cpa,
        resolvedRevshare: holdForInviter ? null : resolution.revshare,
        resolvedRuleApplied: holdForInviter ? null : resolution.ruleApplied,
        houseRuleId: rule.id,
        houseRuleUpdatedAt: rule.updatedAt,
        resolvedAt: holdForInviter ? null : new Date(),
        inviterId: resolution.inviterId,
        inviterCpa: resolution.inviterCpa,
        rangeReferenceHouse: resolution.rangeReferenceHouse,
        rangeReferenceCpa: resolution.rangeReferenceCpa,
        requiredHouseSlugs: dependency.requiredHouses,
      },
      select: baseSelect,
    });

    await this.notifyCreated(item.id);

    let finalStatus: LinkRequestStatus = item.status;
    let outcome: LinkAssignmentOutcome = 'WAITING_POOL_LINK';

    if (holdForInviter) {
      // Convidante ainda sem CPA na casa: NÃO atribui link agora. Fica em espera
      // (resolvedCpa=null); o cron auto-snapshot re-resolve e o pool atribui
      // quando o convidante tiver link+CPA.
      outcome = 'WAITING_SNAPSHOT';
    } else if (!rule.autoAssignEnabled || houseSlug === ESPORTIVA_DIARIO_SLUG) {
      // A Esportiva Diário atribui pelo scheduler dedicado para serializar a
      // aba DIÁRIO; aqui só persistimos o snapshot que libera esse cron.
      outcome = 'SKIPPED_AUTO_ASSIGN';
    } else {
      const assignment = this.poolAssignmentFor(houseSlug);
      if (assignment) {
        try {
          const result = await assignment.tryAssign(userId, item.id, {
            defaultCommission: {
              cpa: resolution.cpa,
              revshare: resolution.revshare,
            },
          });
          if (result.assigned) {
            finalStatus = LinkRequestStatus.FULFILLED;
            outcome = 'LINK_ASSIGNED';
            this.logger.log(
              `Auto-assigned ${houseSlug} link ${result.campaignId} to user ${userId} (request ${item.id}, cpa=${resolution.cpa})`,
            );
          } else {
            this.logger.warn(
              `${houseSlug} auto-assign skipped for request ${item.id}: ${result.reason}`,
            );
          }
        } catch (err) {
          this.logger.error(
            `${houseSlug} auto-assign threw for request ${item.id}: ${(err as Error).message}`,
          );
        }
      }
    }

    await this.assignmentLog.record({
      linkRequestId: item.id,
      userId,
      userName,
      houseSlug,
      inviterId: resolution.inviterId,
      inviterCpa: resolution.inviterCpa,
      assignedCpa: resolution.cpa,
      ruleApplied: resolution.ruleApplied,
      outcome,
      origin: 'NEW_REQUEST',
      togglesApplied: resolution.togglesApplied,
      requiredHouses: dependency.requiredHouses,
      statusBefore: LinkRequestStatus.PENDING,
      statusAfter: finalStatus,
      message: holdForInviter
        ? 'Em espera: convidante ainda sem CPA na casa — aguardando link+CPA do convidante.'
        : `CPA resolvido R$${resolution.cpa} (${resolution.ruleApplied})`,
    });

    if (finalStatus === LinkRequestStatus.FULFILLED) {
      await this.notifyApproved(item.id, 'AUTO_ASSIGN');
    }

    return this.toCreateResult({ ...item, status: finalStatus });
  }

  /** Mapeia uma casa de pool ao seu serviço de atribuição (snapshot CPA). */
  private poolAssignmentFor(houseSlug: string): {
    tryAssign: (
      userId: string,
      reqId: string,
      opts: { defaultCommission?: { cpa: number; revshare: number } },
    ) => Promise<{ assigned: boolean; campaignId?: string; reason?: string }>;
  } | null {
    switch (houseSlug) {
      case SUPERBET_SLUG:
        return this.superbetAssignment;
      case BETNACIONAL_SLUG:
        return this.betnacionalAssignment;
      case HIPERBET_SLUG:
        return this.hiperbetAssignment;
      case BETANO_SLUG:
        return this.betanoAssignment;
      case BETANO_DIARIO_SLUG:
        return this.betanoDiarioAssignment;
      case ESPORTIVA_DIARIO_SLUG:
        return this.esportivaDiarioAssignment;
      case ESPORTIVA_SLUG:
        return this.esportivaAssignment;
      case SPORTINGBET_SLUG:
        return this.sportingbetAssignment;
      case SPORTINGBET_DIARIO_SLUG:
        return this.sportingbetDiarioAssignment;
      case PINBET_DIARIO_SLUG:
        return this.pinbetDiarioAssignment;
      case PINBET_MENSAL_SLUG:
        return this.pinbetMensalAssignment;
      default:
        return null;
    }
  }

  private toCreateResult(item: {
    id: string;
    userId: string;
    dealId: string | null;
    bettingHouseSlug: string;
    message: string;
    status: LinkRequestStatus;
    createdAt: Date;
  }): LinkRequestCreateResult {
    return {
      id: item.id,
      userId: item.userId,
      dealId: item.dealId,
      bettingHouseSlug: item.bettingHouseSlug,
      message: item.message,
      status: item.status,
      createdAt: item.createdAt,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Deals tipo FORM (kind=FORM)
  // ───────────────────────────────────────────────────────────────────────────

  private parseFormSchema(formSchema: unknown): FormField[] {
    if (!Array.isArray(formSchema)) return [];
    return (formSchema as FormField[]).filter(
      (f) => f && typeof f.key === 'string' && typeof f.type === 'string',
    );
  }

  // Senha forte: mín. 6 caracteres, 1 minúscula, 1 maiúscula e 1 número.
  private static readonly STRONG_PASSWORD =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/;

  /** Valida presença dos obrigatórios + força de senha dos campos password. */
  private validateFormData(
    fields: FormField[],
    formData: Record<string, unknown>,
  ): void {
    for (const f of fields) {
      const v = formData?.[f.key];
      const empty =
        v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (f.required && empty) {
        throw new BadRequestException(
          `Campo obrigatório não preenchido: ${f.label ?? f.key}.`,
        );
      }
      if (
        f.type === 'password' &&
        typeof v === 'string' &&
        v !== '' &&
        !LinkRequestService.STRONG_PASSWORD.test(v)
      ) {
        throw new BadRequestException(
          'A senha deve ter no mínimo 6 caracteres, uma letra minúscula, uma letra maiúscula e um número.',
        );
      }
    }
  }

  /** Criptografa (AES-256-GCM) os campos marcados `secret` antes de persistir. */
  private encryptFormSecrets(
    fields: FormField[],
    formData: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...formData };
    for (const f of fields) {
      if (f.secret && typeof out[f.key] === 'string' && out[f.key]) {
        out[f.key] = this.crypto.encrypt(out[f.key] as string);
      }
    }
    return out;
  }

  /** Descriptografa os campos `secret` para exibição no admin. */
  private decryptFormData(
    formSchema: unknown,
    formData: unknown,
  ): Record<string, unknown> | null {
    if (!formData || typeof formData !== 'object') return null;
    const fields = this.parseFormSchema(formSchema);
    const out: Record<string, unknown> = {
      ...(formData as Record<string, unknown>),
    };
    for (const f of fields) {
      if (f.secret && typeof out[f.key] === 'string' && out[f.key]) {
        try {
          out[f.key] = this.crypto.decrypt(out[f.key] as string);
        } catch {
          // valor não decodificável (dado legado/corrompido) — mantém como está
        }
      }
    }
    return out;
  }

  /** Casas-alvo da submissão: campo `houses` (multiselect) ou a própria casa. */
  private resolveFormHouses(
    formData: Record<string, unknown>,
    ownHouseSlug: string,
  ): string[] {
    const raw = formData?.houses;
    const slugs =
      Array.isArray(raw) && raw.length > 0
        ? raw.map((s) => String(s).toLowerCase())
        : [ownHouseSlug];
    return [...new Set(slugs)];
  }

  /** Mapeia o acordo escolhido (`agreement`) → preset CPA/RevShare do schema. */
  private resolveAgreementPreset(
    formSchema: unknown,
    formData: unknown,
  ): { cpa: number; revshare: number } | null {
    const fields = this.parseFormSchema(formSchema);
    const field = fields.find((f) => f.key === 'agreement');
    const selected = (formData as Record<string, unknown> | null)?.agreement;
    if (!field?.options || selected == null) return null;
    const opt = field.options.find(
      (o) => typeof o === 'object' && o.value === selected,
    );
    if (
      opt &&
      typeof opt === 'object' &&
      (opt.cpa != null || opt.revshare != null)
    ) {
      return { cpa: opt.cpa ?? 0, revshare: opt.revshare ?? 0 };
    }
    return null;
  }

  /**
   * Fluxo de criação de deal FORM. Valida o formulário, criptografa segredos e
   * cria 1 LinkRequest PENDENTE por casa selecionada (cada uma apontando para o
   * form-deal ativo daquela casa). Sem pool/eligibility — o admin libera manual.
   */
  private async createFormRequest(
    userId: string,
    deal: { id: string; bettingHouseSlug: string; formSchema: unknown },
    dto: CreateLinkRequestDto,
  ): Promise<LinkRequestCreateResult> {
    const fields = this.parseFormSchema(deal.formSchema);
    const rawFormData = (dto.formData ?? {}) as Record<string, unknown>;
    this.validateFormData(fields, rawFormData);
    const storedFormData = this.encryptFormSecrets(fields, rawFormData);

    const ownHouse = deal.bettingHouseSlug.toLowerCase();
    const targetHouses = this.resolveFormHouses(rawFormData, ownHouse);

    const baseSelect = {
      id: true,
      userId: true,
      dealId: true,
      bettingHouseSlug: true,
      message: true,
      status: true,
      createdAt: true,
    } as const;

    const created: Array<{
      id: string;
      userId: string;
      dealId: string | null;
      bettingHouseSlug: string;
      message: string;
      status: LinkRequestStatus;
      createdAt: Date;
    }> = [];
    let hadDuplicate = false;

    for (const slug of targetHouses) {
      // form-deal ativo da casa selecionada (a própria, ou a outra casa marcada)
      const houseDeal =
        slug === ownHouse
          ? { id: deal.id }
          : await this.prisma.deal.findFirst({
              where: { bettingHouseSlug: slug, active: true, kind: 'FORM' },
              select: { id: true },
              orderBy: { createdAt: 'desc' },
            });
      if (!houseDeal) continue; // casa sem form-deal ativo → ignora silenciosamente

      const pending = await this.prisma.linkRequest.findFirst({
        where: {
          userId,
          dealId: houseDeal.id,
          status: LinkRequestStatus.PENDING,
        },
        select: { id: true },
      });
      if (pending) {
        hadDuplicate = true;
        continue;
      }

      const row = await this.prisma.linkRequest.create({
        data: {
          userId,
          dealId: houseDeal.id,
          bettingHouseSlug: slug,
          message: dto.message ?? '',
          formData: storedFormData as object,
        },
        select: baseSelect,
      });
      created.push(row);
    }

    if (created.length === 0) {
      if (hadDuplicate) {
        throw new ConflictException(
          'Já existe uma solicitação pendente para este formulário.',
        );
      }
      throw new BadRequestException(
        'Nenhuma casa válida selecionada para este formulário.',
      );
    }

    const primary =
      created.find((c) => c.bettingHouseSlug === ownHouse) ?? created[0]!;
    return this.toCreateResult(primary);
  }

  /**
   * Aprovação de uma solicitação de deal FORM: sem tracking URL — o admin fixa
   * CPA/RevShare (ou herda do acordo escolhido) e o ID de afiliado
   * (`manualCampaignId` → AffiliateLink.campaignId, usado pelo cron), marca
   * FULFILLED e notifica o afiliado in-app.
   */
  /**
   * Finaliza (aprova/rejeita) uma solicitação de deal FORM — compartilhado entre
   * `approveDealRequest` (PUT /deal-requests/:id/approve) e `update`
   * (PUT /link-requests/:id), já que o painel admin usa este último. Sem tracking
   * URL: fixa CPA/RevShare (ou herda do acordo) + ID de afiliado, marca FULFILLED
   * e notifica in-app.
   */
  private async finalizeFormRequest(
    id: string,
    item: {
      userId: string;
      bettingHouseSlug: string;
      formData: unknown;
      deal: { name: string | null; formSchema: unknown } | null;
    },
    actor: { sub: string; email: string },
    isAdmin: boolean,
    input: {
      action?: 'approve' | 'reject';
      cpa?: number;
      revshare?: number;
      manualCampaignId?: string;
      adminNote?: string;
    },
  ): Promise<LinkRequestListItem> {
    if (input.action === 'reject') {
      return this.rejectRequest(
        id,
        actor.sub,
        actor.email,
        input.adminNote,
        isAdmin ? 'ADMIN_REJECT' : 'LEADER_REJECT',
      );
    }

    let cpa = input.cpa;
    let revshare = input.revshare;
    if (cpa == null && revshare == null) {
      const preset = this.resolveAgreementPreset(
        item.deal?.formSchema,
        item.formData,
      );
      if (preset) {
        cpa = preset.cpa;
        revshare = preset.revshare;
      }
    }
    if (!cpa && !revshare) {
      throw new BadRequestException(
        'Defina CPA/RevShare (ou selecione o acordo) para aprovar.',
      );
    }

    if (!isAdmin) {
      await this.validateLeaderCeiling(
        actor.sub,
        item.bettingHouseSlug,
        cpa,
        revshare,
        { skipIfNoLink: true },
      );
    }

    const commission = { cpa: cpa ?? 0, revshare: revshare ?? 0 };
    await this.syncAffiliateLink(
      item.userId,
      item.bettingHouseSlug,
      [],
      commission,
      input.manualCampaignId,
    );

    const updated = await this.prisma.linkRequest.update({
      where: { id },
      data: {
        status: LinkRequestStatus.FULFILLED,
        resolvedCpa: commission.cpa,
        resolvedRevshare: commission.revshare,
        ...(input.adminNote !== undefined
          ? { adminNote: input.adminNote }
          : {}),
        fulfilledAt: new Date(),
        fulfilledById: actor.sub,
        fulfilledByName: actor.email,
      },
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
        formData: true,
        user: { select: LIST_ITEM_USER_SELECT },
        deal: { select: { name: true, formSchema: true } },
      },
    });

    await this.notifyApproved(id, isAdmin ? 'ADMIN_APPROVE' : 'LEADER_APPROVE');
    await this.notifyDealFormApproved(
      item.userId,
      item.bettingHouseSlug,
      commission.cpa,
      commission.revshare,
    );

    return {
      ...this.toListItem(updated),
      formData: this.decryptFormData(
        updated.deal?.formSchema,
        updated.formData,
      ),
    };
  }

  /** Notificação in-app de liberação de acesso (deal FORM aprovado). */
  private async notifyDealFormApproved(
    userId: string,
    houseSlug: string,
    cpa: number,
    revshare: number,
  ): Promise<void> {
    try {
      const house = await this.prisma.bettingHouse.findUnique({
        where: { slug: houseSlug },
        select: { name: true },
      });
      const houseName = house?.name ?? houseSlug;
      const parts: string[] = [];
      if (cpa > 0) parts.push(`CPA R$${cpa}`);
      if (revshare > 0) parts.push(`RevShare ${revshare}%`);
      const terms = parts.length ? ` (${parts.join(' + ')})` : '';
      await this.notification.create({
        userId,
        type: NotificationType.DEAL_FORM_APPROVED,
        title: `✅ Acesso liberado — ${houseName}`,
        message: `Seu cadastro em ${houseName} foi aprovado${terms}. Já pode começar a operar.`,
        metadata: { bettingHouse: houseSlug, houseName, cpa, revshare },
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao notificar liberação de deal FORM (user ${userId}): ${(err as Error).message}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/link-requests
  // Admin: all. Affiliate: own + direct invitees (referredById = currentUser.id)
  // ─────────────────────────────────────────────────────────────────────────

  async list(
    user: JwtPayload,
    query: ListLinkRequestsQueryDto,
  ): Promise<{
    data: LinkRequestListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit, skip } = clampPagination(query, {
      defaultLimit: 50,
      maxLimit: 100,
    });
    const where = await this.buildListWhere(user, query);

    const selectFields = {
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
      inviterCpa: true,
      requiredHouseSlugs: true,
      missingHouseSlugs: true,
      blockedReason: true,
      formData: true,
      user: { select: LIST_ITEM_USER_SELECT },
      deal: { select: { name: true, kind: true, formSchema: true } },
    } as const;

    const [items, total] = await Promise.all([
      this.prisma.linkRequest.findMany({
        where,
        orderBy: { [query.sort ?? 'createdAt']: 'desc' },
        select: selectFields,
        skip,
        take: limit,
      }),
      this.prisma.linkRequest.count({ where }),
    ]);

    // Só o admin/superadmin enxerga o formData decifrado (com a senha de terceiro).
    const isAdmin =
      user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN;
    return {
      data: items.map((it) => ({
        ...this.toListItem(it),
        kind: it.deal?.kind ?? 'LINK',
        formData:
          isAdmin && it.deal?.kind === 'FORM'
            ? this.decryptFormData(it.deal?.formSchema, it.formData)
            : null,
      })),
      total,
      page,
      limit,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /v1/link-requests/:id  (admin only)
  // ─────────────────────────────────────────────────────────────────────────

  async update(
    id: string,
    adminId: string,
    adminName: string,
    dto: UpdateLinkRequestDto,
  ): Promise<LinkRequestListItem> {
    const item = await this.prisma.linkRequest.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        bettingHouseSlug: true,
        links: true,
        status: true,
        dealId: true,
        formData: true,
        deal: { select: { kind: true, name: true, formSchema: true } },
      },
    });
    if (!item) throw new NotFoundException('Solicitação não encontrada.');

    // Deal FORM: usa o fluxo próprio (sem links) — o painel admin aprova via este
    // endpoint (PUT /link-requests/:id) enviando status + cpa/revshare + ID de afiliado.
    if (item.deal?.kind === 'FORM') {
      return this.finalizeFormRequest(
        id,
        {
          userId: item.userId,
          bettingHouseSlug: item.bettingHouseSlug,
          formData: item.formData,
          deal: item.deal,
        },
        { sub: adminId, email: adminName },
        true, // este endpoint já é restrito a admin
        {
          action: dto.status === 'rejected' ? 'reject' : 'approve',
          cpa: dto.cpa,
          revshare: dto.revshare,
          manualCampaignId: dto.manualCampaignId,
          adminNote: dto.adminNote,
        },
      );
    }

    const incomingLinks = dto.links ?? [];
    const existingLinks = (item.links as unknown as LinkItem[]) ?? [];
    const allLinks = incomingLinks.length > 0 ? incomingLinks : existingLinks;

    if (dto.status === 'fulfilled' && allLinks.length === 0) {
      throw new BadRequestException(
        'Pelo menos um link é obrigatório ao aprovar.',
      );
    }

    // ── Pre-approval: validate campaignId uniqueness BEFORE writing ──────────
    if (dto.status === 'fulfilled' && allLinks.length > 0) {
      const firstUrl = allLinks[0]?.url ?? '';
      const extractedCampaignId = this.extractCampaignIdForHouse(
        item.bettingHouseSlug,
        firstUrl,
        dto.manualCampaignId,
      );

      if (extractedCampaignId) {
        const conflict = await this.prisma.affiliateLink.findFirst({
          where: {
            campaignId: extractedCampaignId,
            bettingHouse: item.bettingHouseSlug,
            NOT: { userId: item.userId },
          },
          select: {
            userId: true,
            user: { select: { name: true, email: true } },
          },
        });
        if (conflict) {
          const owner = (conflict as any).user;
          throw new BadRequestException(
            `Este link de rastreamento já está vinculado a outro afiliado${owner ? ` (${owner.name} — ${owner.email})` : ''}. Use um link diferente.`,
          );
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const isFulfilling = dto.status === 'fulfilled';
    const isClosing = isFulfilling || dto.status === 'rejected';

    const updated = await this.prisma.linkRequest.update({
      where: { id },
      data: {
        ...(dto.status
          ? {
              status:
                dto.status === 'fulfilled'
                  ? LinkRequestStatus.FULFILLED
                  : LinkRequestStatus.REJECTED,
            }
          : {}),
        ...(incomingLinks.length > 0
          ? { links: incomingLinks as unknown as any }
          : {}),
        ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote } : {}),
        ...(isClosing
          ? {
              fulfilledAt: new Date(),
              fulfilledById: adminId,
              fulfilledByName: adminName,
            }
          : {}),
      },
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
        user: { select: LIST_ITEM_USER_SELECT },
        deal: { select: { name: true } },
      },
    });

    if (isFulfilling && allLinks.length > 0) {
      // CPA/Rev from DTO take priority; fallback to deal defaults
      const hasDtoCommission =
        dto.cpa !== undefined || dto.revshare !== undefined;
      const commission = hasDtoCommission
        ? { cpa: dto.cpa ?? 0, revshare: dto.revshare ?? 0 }
        : await this.getDealCommission(item.dealId);

      // Validate referrer ceiling when admin sets explicit CPA/Rev
      // If referrer has no link for this house → no ceiling → skip silently
      if (hasDtoCommission) {
        const user = await this.prisma.user.findUnique({
          where: { id: item.userId },
          select: { referredById: true },
        });
        if (user?.referredById) {
          await this.validateLeaderCeiling(
            user.referredById,
            item.bettingHouseSlug,
            dto.cpa,
            dto.revshare,
            { skipIfNoLink: true },
          );
        }
      }

      try {
        await this.syncAffiliateLink(
          item.userId,
          item.bettingHouseSlug,
          allLinks,
          commission,
          dto.manualCampaignId,
        );
      } catch (err) {
        this.logger.error(
          `syncAffiliateLink failed for link-request ${id}: ${(err as Error)?.message}`,
        );
        throw err;
      }
      await this.notifyApproved(id, 'ADMIN_APPROVE');
    } else if (dto.status === 'rejected') {
      await this.notifyRejected(id, 'ADMIN_REJECT');
    }

    return this.toListItem(updated);
  }

  /**
   * PUT /v1/link-requests/:id/set-cpa — CPA MANUAL (esportiva-diario).
   * Admin ou o convidante (referredById do solicitante) define o CPA; o request
   * passa a ter resolvedCpa e entra na fila do scheduler (que atribui o link da
   * planilha). Convidante respeita o teto do próprio CPA na casa.
   */
  async setManualCpa(
    actor: JwtPayload,
    id: string,
    dto: SetLinkRequestCpaDto,
  ): Promise<{ ok: true }> {
    const req = await this.prisma.linkRequest.findUnique({
      where: { id },
      select: {
        id: true,
        bettingHouseSlug: true,
        status: true,
        user: { select: { referredById: true } },
      },
    });
    if (!req) throw new NotFoundException('Solicitação não encontrada.');
    if (req.bettingHouseSlug !== ESPORTIVA_DIARIO_SLUG) {
      throw new BadRequestException('Esta casa não usa CPA manual.');
    }
    if (req.status !== LinkRequestStatus.PENDING) {
      throw new BadRequestException('Solicitação não está pendente.');
    }

    const isAdmin =
      actor.role === UserRole.ADMIN || actor.role === UserRole.SUPERADMIN;
    const isInviter =
      !!req.user.referredById && req.user.referredById === actor.sub;
    if (!isAdmin && !isInviter) {
      throw new ForbiddenException(
        'Apenas o admin ou quem convidou pode definir o CPA.',
      );
    }
    // Convidante respeita o teto do próprio CPA na casa.
    if (!isAdmin) {
      await this.validateLeaderCeiling(
        actor.sub,
        ESPORTIVA_DIARIO_SLUG,
        dto.cpa,
        dto.revshare,
      );
    }

    await this.prisma.linkRequest.update({
      where: { id },
      data: {
        resolvedCpa: dto.cpa,
        resolvedRevshare: dto.revshare ?? 0,
        resolvedAt: new Date(),
      },
    });
    this.logger.log(
      `Manual CPA set on request ${id} by ${isAdmin ? 'admin' : 'inviter'} ${actor.sub} (cpa=${dto.cpa})`,
    );
    return { ok: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/deal-requests
  // Same table, dealId NOT NULL. Admin: all. Affiliate: own + direct invitees with Superbet
  // ─────────────────────────────────────────────────────────────────────────

  async listDealRequests(
    user: JwtPayload,
    query: ListDealRequestsQueryDto,
  ): Promise<{ data: LinkRequestListItem[] }> {
    const where = await this.buildDealRequestWhere(user, query);

    const items = await this.prisma.linkRequest.findMany({
      where,
      orderBy: { [query.sort ?? 'createdAt']: 'desc' },
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
        formData: true,
        user: { select: LIST_ITEM_USER_SELECT },
        deal: { select: { name: true, kind: true, formSchema: true } },
      },
    });

    // Admin: expõe o formData das deals FORM já com os campos secretos decifrados.
    return {
      data: items.map((it) => ({
        ...this.toListItem(it),
        kind: it.deal?.kind ?? 'LINK',
        formData:
          it.deal?.kind === 'FORM'
            ? this.decryptFormData(it.deal?.formSchema, it.formData)
            : null,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUT /v1/deal-requests/:id/approve
  // Admin OR the network leader who referred the requester
  // ─────────────────────────────────────────────────────────────────────────

  async approveDealRequest(
    id: string,
    actor: JwtPayload,
    dto: ApproveDealRequestDto,
  ): Promise<LinkRequestListItem> {
    const item = await this.prisma.linkRequest.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        bettingHouseSlug: true,
        links: true,
        status: true,
        dealId: true,
        formData: true,
        user: { select: { referredById: true } },
        deal: { select: { kind: true, name: true, formSchema: true } },
      },
    });
    if (!item) throw new NotFoundException('Solicitação não encontrada.');
    if (!item.dealId)
      throw new BadRequestException('Esta solicitação não tem deal associado.');

    const isAdmin =
      actor.role === UserRole.ADMIN || actor.role === UserRole.SUPERADMIN;
    const isLeader = item.user.referredById === actor.sub;

    // Explicit self-approval block — an affiliate cannot approve their own request
    if (actor.sub === item.userId) {
      throw new ForbiddenException(
        'Você não pode aprovar a sua própria solicitação.',
      );
    }

    if (!isAdmin && !isLeader) {
      throw new ForbiddenException(
        'Você só pode aprovar solicitações de seus convidados diretos.',
      );
    }

    // Deal FORM: fluxo próprio (sem tracking URL) — CPA/RevShare + ID de afiliado.
    if (item.deal?.kind === 'FORM') {
      return this.finalizeFormRequest(
        id,
        {
          userId: item.userId,
          bettingHouseSlug: item.bettingHouseSlug,
          formData: item.formData,
          deal: item.deal,
        },
        { sub: actor.sub, email: actor.email },
        isAdmin,
        {
          action: dto.action,
          cpa: dto.cpa,
          revshare: dto.revshare,
          manualCampaignId: dto.manualCampaignId,
          adminNote: dto.adminNote,
        },
      );
    }

    if (dto.action === 'reject') {
      return this.rejectRequest(
        item.id,
        actor.sub,
        actor.email,
        dto.adminNote,
        isAdmin ? 'ADMIN_REJECT' : 'LEADER_REJECT',
      );
    }

    if (!dto.cpa && !dto.revshare) {
      throw new BadRequestException(
        'Defina pelo menos CPA ou RevShare para aprovar.',
      );
    }

    // Network leader: validate commission ceiling
    if (!isAdmin) {
      await this.validateLeaderCeiling(
        actor.sub,
        item.bettingHouseSlug,
        dto.cpa,
        dto.revshare,
      );
    }

    const incomingLinks = dto.links ?? [];
    const existingLinks = (item.links as unknown as LinkItem[]) ?? [];
    const allLinks = incomingLinks.length > 0 ? incomingLinks : existingLinks;

    // Pool houses (superbet/betnacional/hiperbet): leader aprovação só fixa
    // cpa+rev. Se não há um campaignId real resolvível (URL válida ou
    // manualCampaignId), evita gravar placeholder + FULFILLED — mantém
    // PENDING para o cron atribuir um link real da planilha. Sem isso,
    // user fica "Aprovado" mas sem link funcional.
    const isPoolHouse = (POOL_HOUSES as readonly string[]).includes(
      item.bettingHouseSlug,
    );
    const resolvableCampaignId = isPoolHouse
      ? this.extractCampaignIdForHouse(
          item.bettingHouseSlug,
          allLinks[0]?.url ?? '',
          dto.manualCampaignId,
        )
      : null;
    const divertPoolToPending =
      isPoolHouse && allLinks.length > 0 && !resolvableCampaignId;

    // Sem URL → leader define apenas cpa+rev. linkRequest fica PENDING e
    // auto-assign (cron) atribui link da planilha quando user atender o gate.
    if (allLinks.length === 0 || divertPoolToPending) {
      const commission = {
        cpa: dto.cpa ?? 0,
        revshare: dto.revshare ?? 0,
      };
      await this.upsertCommissionOnly(
        item.userId,
        item.bettingHouseSlug,
        commission,
      );
      if (dto.adminNote !== undefined) {
        await this.prisma.linkRequest.update({
          where: { id },
          data: { adminNote: dto.adminNote },
        });
      }
      const latest = await this.prisma.linkRequest.findUnique({
        where: { id },
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
          user: { select: LIST_ITEM_USER_SELECT },
          deal: { select: { name: true } },
        },
      });
      return this.toListItem(latest!);
    }

    const updated = await this.prisma.linkRequest.update({
      where: { id },
      data: {
        status: LinkRequestStatus.FULFILLED,
        ...(incomingLinks.length > 0
          ? { links: incomingLinks as unknown as any }
          : {}),
        ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote } : {}),
        fulfilledAt: new Date(),
        fulfilledById: actor.sub,
        fulfilledByName: actor.email,
      },
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
        user: { select: LIST_ITEM_USER_SELECT },
        deal: { select: { name: true } },
      },
    });

    const commission = { cpa: dto.cpa ?? 0, revshare: dto.revshare ?? 0 };
    try {
      await this.syncAffiliateLink(
        item.userId,
        item.bettingHouseSlug,
        allLinks,
        commission,
        dto.manualCampaignId,
      );
    } catch (err) {
      this.logger.error(
        `syncAffiliateLink failed for deal-request ${id}: ${(err as Error)?.message}`,
      );
      throw err;
    }

    await this.notifyApproved(id, isAdmin ? 'ADMIN_APPROVE' : 'LEADER_APPROVE');

    return this.toListItem(updated);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/link-requests/houses  (public listing for affiliate dropdowns)
  // ─────────────────────────────────────────────────────────────────────────

  async listHouses() {
    const houses = await this.prisma.bettingHouse.findMany({
      where: { active: true },
      select: { id: true, name: true, slug: true, logoUrl: true },
      orderBy: { name: 'asc' },
    });
    return { data: houses };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/link-requests/deals  (active deals for affiliate dropdown)
  // ─────────────────────────────────────────────────────────────────────────

  async listDeals(userId: string) {
    // Acesso a deals exclusivas: admin/superadmin sempre vê; afiliado só vê
    // quando exclusiveDealsAccess=true (toggle no painel admin).
    const viewer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, exclusiveDealsAccess: true },
    });
    const canSeeExclusive =
      !!viewer &&
      (viewer.role !== UserRole.AFFILIATE || viewer.exclusiveDealsAccess);
    const dealWhere = canSeeExclusive
      ? { active: true }
      : { active: true, exclusive: false };

    const [deals, userRequests, userLinks, baseEligibility] = await Promise.all(
      [
        this.prisma.deal.findMany({
          where: dealWhere,
          select: {
            id: true,
            name: true,
            bettingHouseSlug: true,
            cpa: true,
            revshare: true,
            baseline: true,
            minAvgDepositPerFtd: true,
            minQualifiedFtd: true,
            exclusive: true,
            featured: true,
            newArrival: true,
            sortOrder: true,
            logoUrl: true,
            conditionsText: true,
            paymentNotes: true,
            trafficSources: true,
            revenueType: true,
            kind: true,
            formSchema: true,
            createdAt: true,
            bettingHouse: { select: { name: true } },
          },
          orderBy: [
            { featured: 'desc' },
            { sortOrder: 'asc' },
            { name: 'asc' },
          ],
        }),
        this.prisma.linkRequest.findMany({
          where: { userId },
          select: { dealId: true, bettingHouseSlug: true, status: true },
        }),
        this.prisma.affiliateLink.findMany({
          where: { userId, ...REAL_ACTIVE_LINK_WHERE },
          select: { bettingHouse: true },
        }),
        this.eligibility.getSnapshot(userId),
      ],
    );

    // Status is deal-scoped. Legacy requests without dealId belong only to the
    // oldest deal of their house, so they do not mark newly-created deals as
    // already requested.
    const statusByDeal = new Map<string, LinkRequestStatus>();
    const legacyStatusByHouse = new Map<string, LinkRequestStatus>();
    const statusPriority: Record<LinkRequestStatus, number> = {
      REJECTED: 1,
      FULFILLED: 2,
      PENDING: 3,
    };
    const recordStatus = (
      statuses: Map<string, LinkRequestStatus>,
      key: string,
      status: LinkRequestStatus,
    ) => {
      const current = statuses.get(key);
      if (
        !current ||
        (statusPriority[status] ?? 0) > (statusPriority[current] ?? 0)
      ) {
        statuses.set(key, status);
      }
    };
    for (const req of userRequests) {
      if (req.dealId) recordStatus(statusByDeal, req.dealId, req.status);
      else
        recordStatus(
          legacyStatusByHouse,
          req.bettingHouseSlug.toLowerCase(),
          req.status,
        );
    }
    const oldestDealIdByHouse = new Map<string, string>();
    for (const deal of [...deals].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )) {
      const houseSlug = deal.bettingHouseSlug.toLowerCase();
      if (!oldestDealIdByHouse.has(houseSlug)) {
        oldestDealIdByHouse.set(houseSlug, deal.id);
      }
    }
    const linkedHouses = new Set(userLinks.map((link) => link.bettingHouse));

    return {
      data: deals.map((d) => {
        const houseSlug = d.bettingHouseSlug.toLowerCase();
        const requiresEligibility = isDealEligibilityRequired(
          houseSlug,
          linkedHouses.has(houseSlug),
        );
        const dealMinAvgDepositPerFtd = d.minAvgDepositPerFtd.toNumber();
        const dealMinQualifiedFtd = d.minQualifiedFtd;
        const eligibilityMinAvgDeposit =
          houseSlug === BETANO_DIARIO_SLUG ? 0 : dealMinAvgDepositPerFtd;
        const eligibility = requiresEligibility
          ? this.eligibility.evaluate(
              baseEligibility,
              eligibilityMinAvgDeposit,
              dealMinQualifiedFtd,
            )
          : {
              ...this.eligibility.evaluate(
                baseEligibility,
                dealMinAvgDepositPerFtd,
                dealMinQualifiedFtd,
              ),
              eligible: true,
              required: false,
              reasons: [],
            };

        return {
          id: d.id,
          name: d.name,
          bettingHouseSlug: d.bettingHouseSlug,
          houseName: d.bettingHouse.name,
          cpa: Number(d.cpa),
          revshare: Number(d.revshare),
          baseline: Number(d.baseline),
          minAvgDepositPerFtd: dealMinAvgDepositPerFtd,
          minQualifiedFtd: dealMinQualifiedFtd,
          exclusive: d.exclusive,
          featured: d.featured,
          newArrival: d.newArrival,
          logoUrl: d.logoUrl || null,
          conditionsText: d.conditionsText || null,
          paymentNotes: d.paymentNotes || null,
          trafficSources: d.trafficSources,
          revenueType: d.revenueType,
          kind: d.kind,
          formSchema: (d.formSchema as unknown) ?? null,
          eligibility,
          // null = not yet requested
          userStatus:
            statusByDeal.get(d.id) ??
            (oldestDealIdByHouse.get(houseSlug) === d.id
              ? legacyStatusByHouse.get(houseSlug)
              : undefined) ??
            null,
        };
      }),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve o campaignId da casa: casas em MANUAL_CAMPAIGN_ID_HOUSES exigem o
   * valor digitado; as demais extraem da URL (ver extractCampaignIdFromUrl) e
   * só caem no manual se a URL não trouxer padrão conhecido.
   */
  private extractCampaignIdForHouse(
    house: string,
    url: string,
    manualId?: string,
  ): string | null {
    if ((MANUAL_CAMPAIGN_ID_HOUSES as readonly string[]).includes(house)) {
      return manualId ?? null; // null → link will be created with empty campaignId
    }
    return extractCampaignIdFromUrl(url) ?? manualId ?? null;
  }

  /**
   * Creates or updates the AffiliateLink when a link request is approved.
   * Per-house extraction strategy; fire-and-forget (caller catches errors).
   */
  /**
   * Persiste apenas cpa+rev no AffiliateLink do user para a casa.
   * Se não existir, cria com campaignId placeholder `pending_<slug>_<userId>`.
   * Auto-assign (cron) sobrescreve o campaignId quando atribuir link real.
   */
  private async upsertCommissionOnly(
    userId: string,
    houseSlug: string,
    commission: { cpa: number; revshare: number },
  ): Promise<void> {
    const existing = await this.prisma.affiliateLink.findFirst({
      where: { userId, bettingHouse: houseSlug },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.affiliateLink.update({
        where: { id: existing.id },
        data: { cpa: commission.cpa, revshare: commission.revshare },
      });
    } else {
      await this.prisma.affiliateLink.create({
        data: {
          userId,
          bettingHouse: houseSlug,
          campaignId: `pending_${houseSlug}_${userId}`,
          affiliateId: '',
          cpa: commission.cpa,
          revshare: commission.revshare,
        },
      });
    }
  }

  private async syncAffiliateLink(
    userId: string,
    houseSlug: string,
    links: LinkItem[],
    commission: { cpa: number; revshare: number } | null,
    manualCampaignId?: string,
  ): Promise<void> {
    const cpa = commission?.cpa ?? null;
    const revshare = commission?.revshare ?? null;

    // Try to extract campaignId from the first URL (or use manual)
    const firstUrl = links[0]?.url ?? '';
    const campaignId =
      this.extractCampaignIdForHouse(houseSlug, firstUrl, manualCampaignId) ??
      '';

    const existing = await this.prisma.affiliateLink.findFirst({
      where: { userId, bettingHouse: houseSlug },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.affiliateLink.update({
        where: { id: existing.id },
        data: {
          ...(campaignId ? { campaignId } : {}),
          ...(cpa !== null ? { cpa } : {}),
          ...(revshare !== null ? { revshare } : {}),
        },
      });
    } else {
      await this.prisma.affiliateLink.create({
        data: {
          userId,
          bettingHouse: houseSlug,
          campaignId: campaignId || `manual_${houseSlug}_${userId.slice(0, 8)}`,
          affiliateId: '',
          cpa,
          revshare,
        },
      });
    }
  }

  private async validateLeaderCeiling(
    leaderId: string,
    houseSlug: string,
    cpa?: number,
    revshare?: number,
    opts: { skipIfNoLink?: boolean } = {},
  ): Promise<void> {
    const leaderLink = await this.prisma.affiliateLink.findFirst({
      where: { userId: leaderId, bettingHouse: houseSlug },
      select: { cpa: true, revshare: true },
    });
    if (!leaderLink) {
      // Ter vínculo/acordo na casa NÃO é mais obrigatório para aprovar solicitações.
      // Sem link do líder não há teto a validar — segue sem bloquear (antes: throw
      // exigindo acordo na casa). `opts.skipIfNoLink` mantido por compatibilidade.
      void opts;
      return;
    }
    if (cpa && leaderLink.cpa && cpa > leaderLink.cpa.toNumber()) {
      throw new BadRequestException(
        `CPA não pode exceder seu teto de R$${leaderLink.cpa.toNumber()}.`,
      );
    }
    if (
      revshare &&
      leaderLink.revshare &&
      revshare > leaderLink.revshare.toNumber()
    ) {
      throw new BadRequestException(
        `RevShare não pode exceder seu teto de ${leaderLink.revshare.toNumber()}%.`,
      );
    }
  }

  private async rejectRequest(
    id: string,
    actorId: string,
    actorName: string,
    note?: string,
    origin = 'ADMIN_REJECT',
  ): Promise<LinkRequestListItem> {
    const updated = await this.prisma.linkRequest.update({
      where: { id },
      data: {
        status: LinkRequestStatus.REJECTED,
        fulfilledAt: new Date(),
        fulfilledById: actorId,
        fulfilledByName: actorName,
        ...(note !== undefined ? { adminNote: note } : {}),
      },
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
        user: { select: LIST_ITEM_USER_SELECT },
        deal: { select: { name: true } },
      },
    });
    await this.notifyRejected(id, origin);
    return this.toListItem(updated);
  }

  private async notifyApproved(id: string, origin: string) {
    try {
      await this.linkWebhook.notifyApproved(id, origin);
    } catch (err) {
      this.logger.warn(
        `Link webhook approved notification failed for ${id}: ${(err as Error).message}`,
      );
    }
  }

  private async notifyRejected(id: string, origin: string) {
    try {
      await this.linkWebhook.notifyRejected(id, origin);
    } catch (err) {
      this.logger.warn(
        `Link webhook rejected notification failed for ${id}: ${(err as Error).message}`,
      );
    }
  }

  private async notifyCreated(id: string) {
    try {
      await this.linkWebhook.notifyCreated(id, 'CREATED');
    } catch (err) {
      this.logger.warn(
        `Link webhook created notification failed for ${id}: ${(err as Error).message}`,
      );
    }
  }

  private async getDealCommission(
    dealId: string | null,
  ): Promise<{ cpa: number; revshare: number } | null> {
    if (!dealId) return null;
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      select: { cpa: true, revshare: true },
    });
    if (!deal) return null;
    return { cpa: deal.cpa.toNumber(), revshare: deal.revshare.toNumber() };
  }

  /** Filters for GET /link-requests */
  private async buildListWhere(
    user: JwtPayload,
    query: ListLinkRequestsQueryDto,
  ) {
    const where: Record<string, any> = {};

    if (query.mine) {
      // "Meus Links" — só do próprio usuário, ignora invitees e deals inativas.
      // Solicitações avulsas/legadas sem deal continuam visíveis.
      where.userId = user.sub;
      where.OR = [{ dealId: null }, { deal: { is: { active: true } } }];
    } else if (
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.SUPERADMIN
    ) {
      const inviteeIds = await this.prisma.user.findMany({
        where: { referredById: user.sub },
        select: { id: true },
      });
      where.userId = { in: [user.sub, ...inviteeIds.map((u) => u.id)] };
    } else if (query.panel) {
      // Admin panel filter: find users whose campaignId matches the utmCampaign
      const campaignIds = await this.prisma.affiliateData.findMany({
        where: { utmCampaign: query.panel, campaignId: { not: '' } },
        select: { campaignId: true },
        distinct: ['campaignId'],
      });
      const userIds = await this.prisma.affiliateLink.findMany({
        where: { campaignId: { in: campaignIds.map((c) => c.campaignId) } },
        select: { userId: true },
        distinct: ['userId'],
      });
      where.userId = { in: userIds.map((u) => u.userId) };
    }

    if (query.status) where.status = query.status;
    if (query.house) where.bettingHouseSlug = query.house;

    if (query.search) {
      const userWhere = buildUserSearchWhere(query.search);
      if (userWhere) where.user = userWhere;
    }

    if (query.dateFrom || query.dateTo) {
      where.fulfilledAt = {};
      if (query.dateFrom) where.fulfilledAt.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        end.setHours(23, 59, 59, 999);
        where.fulfilledAt.lte = end;
      }
    }

    // hasCommission: filter by whether the affiliate already has cpa/revshare set
    if (query.hasCommission === 'yes') {
      where.user = {
        ...where.user,
        affiliateLinks: {
          some: {
            deletedAt: null,
            AND: [{ cpa: { not: null } }, { revshare: { not: null } }],
          },
        },
      };
    } else if (query.hasCommission === 'no') {
      where.user = {
        ...where.user,
        affiliateLinks: {
          none: {
            deletedAt: null,
            AND: [{ cpa: { not: null } }, { revshare: { not: null } }],
          },
        },
      };
    }

    return where;
  }

  /** Filters for GET /deal-requests */
  private async buildDealRequestWhere(
    user: JwtPayload,
    query: ListDealRequestsQueryDto,
  ) {
    const where: Record<string, any> = { dealId: { not: null } };

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPERADMIN) {
      // Affiliate sees deal requests from ALL direct invitees (referredById = current user)
      const directInvitees = await this.prisma.user.findMany({
        where: { referredById: user.sub },
        select: { id: true },
      });
      // Deal Requests tab: only direct invitees (NOT the caller themselves)
      where.userId = { in: directInvitees.map((u) => u.id) };
    }

    if (query.status) where.status = query.status;
    if (query.house) where.bettingHouseSlug = query.house;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    return where;
  }

  /** Maps a Prisma row to the DTO shape */
  private toListItem(item: any): LinkRequestListItem {
    return {
      id: item.id,
      userId: item.userId,
      userName: item.user?.name ?? '',
      userEmail: item.user?.email ?? '',
      referredBy: item.user?.referredBy
        ? {
            id: item.user.referredBy.id,
            name: item.user.referredBy.name,
            email: item.user.referredBy.email,
          }
        : null,
      dealId: item.dealId,
      dealName: item.deal?.name ?? null,
      bettingHouseSlug: item.bettingHouseSlug,
      message: item.message,
      status: item.status,
      links: (item.links as unknown as LinkItem[]) ?? [],
      adminNote: item.adminNote,
      fulfilledAt: item.fulfilledAt,
      fulfilledByName: item.fulfilledByName,
      createdAt: item.createdAt,
      resolvedCpa: item.resolvedCpa != null ? Number(item.resolvedCpa) : null,
      resolvedRevshare:
        item.resolvedRevshare != null ? Number(item.resolvedRevshare) : null,
      resolvedRuleApplied: item.resolvedRuleApplied ?? null,
      inviterCpa: item.inviterCpa != null ? Number(item.inviterCpa) : null,
      requiredHouseSlugs: item.requiredHouseSlugs ?? [],
      missingHouseSlugs: item.missingHouseSlugs ?? [],
      blockedReason: item.blockedReason ?? null,
      // Passthrough (bruto). Endpoints admin sobrescrevem com a versão decifrada.
      formData:
        (item.formData as Record<string, unknown> | null | undefined) ?? null,
    };
  }

  /**
   * Returns the referrer's CPA/RevShare ceiling for a link-request.
   * Used by admin UI to show max values before approval.
   */
  async getReferrerCeiling(linkRequestId: string) {
    const lr = await this.prisma.linkRequest.findUnique({
      where: { id: linkRequestId },
      select: {
        userId: true,
        bettingHouseSlug: true,
        dealId: true,
        status: true,
      },
    });
    if (!lr) throw new NotFoundException('Solicitação não encontrada.');

    // Check if the requesting user already has an affiliate link with CPA/RevShare
    // (created during referrer approval flow)
    const userLink = await this.prisma.affiliateLink.findFirst({
      where: { userId: lr.userId, bettingHouse: lr.bettingHouseSlug },
      select: { cpa: true, revshare: true },
    });

    // Sinaliza pro frontend: cpa+rev já definidos + linkRequest ainda PENDING
    // → cron vai atribuir link da planilha em breve. Modal trava edição.
    const awaitingAutoAssign =
      lr.status === LinkRequestStatus.PENDING &&
      userLink?.cpa != null &&
      userLink?.revshare != null;

    // Fetch deal defaults as fallback
    const deal = lr.dealId
      ? await this.prisma.deal.findUnique({
          where: { id: lr.dealId },
          select: { cpa: true, revshare: true },
        })
      : null;

    const user = await this.prisma.user.findUnique({
      where: { id: lr.userId },
      select: {
        referredById: true,
        referredBy: { select: { name: true } },
      },
    });

    // Pre-set values: user's existing link (from referrer approval) > deal defaults > null.
    // Trata cpa=0/rev=0 do deal como "não definido" (default placeholder), retorna null.
    const userCpa = userLink?.cpa?.toNumber();
    const userRev = userLink?.revshare?.toNumber();
    const dealCpa = deal?.cpa?.toNumber();
    const dealRev = deal?.revshare?.toNumber();
    const presetCpa =
      userCpa != null && userCpa > 0
        ? userCpa
        : dealCpa != null && dealCpa > 0
          ? dealCpa
          : null;
    const presetRevshare =
      userRev != null && userRev > 0
        ? userRev
        : dealRev != null && dealRev > 0
          ? dealRev
          : null;

    if (!user?.referredById) {
      return {
        hasCeiling: false,
        presetCpa,
        presetRevshare,
        awaitingAutoAssign,
      };
    }

    const referrerLink = await this.prisma.affiliateLink.findFirst({
      where: { userId: user.referredById, bettingHouse: lr.bettingHouseSlug },
      select: { cpa: true, revshare: true },
    });
    if (!referrerLink) {
      return {
        hasCeiling: false,
        presetCpa,
        presetRevshare,
        awaitingAutoAssign,
      };
    }

    return {
      hasCeiling: true,
      referrerName: user.referredBy?.name ?? '',
      maxCpa: referrerLink.cpa?.toNumber() ?? 0,
      maxRevshare: referrerLink.revshare?.toNumber() ?? 0,
      presetCpa,
      presetRevshare,
      awaitingAutoAssign,
    };
  }
}
