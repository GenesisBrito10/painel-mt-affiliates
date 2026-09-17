import { Injectable } from '@nestjs/common';
import {
  Prisma,
  LinkSource,
  LinkRequestStatus,
  LinkAssignmentRuleApplied,
  type HouseLinkRule,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  parseRangeTiers,
  type CpaResolution,
} from '../domain/types/house-link-rule.types.js';

/**
 * Calcula automaticamente o CPA do convidado a partir da regra configurada da
 * casa (HouseLinkRule). Substitui o CPA manual do líder + timeout de 24h.
 * Toda aritmética usa Prisma.Decimal para evitar perda de precisão.
 */
@Injectable()
export class CpaResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCpa(params: {
    houseSlug: string;
    dealId?: string | null;
    userId: string;
    inviterId: string | null;
    rule: HouseLinkRule;
  }): Promise<CpaResolution> {
    const { houseSlug, dealId, userId, inviterId, rule } = params;
    const toggles: string[] = [];
    const defaultCpa = rule.defaultCpa.toNumber();
    const fallbackCpa = rule.fallbackCpa.toNumber();
    const revshare = rule.defaultRevshare.toNumber();

    const build = (over: Partial<CpaResolution>): CpaResolution => ({
      cpa: 0,
      revshare,
      ruleApplied: LinkAssignmentRuleApplied.DEFAULT,
      inviterId: inviterId ?? null,
      inviterCpa: null,
      rangeReferenceHouse: null,
      rangeReferenceCpa: null,
      fallbackUsed: false,
      togglesApplied: toggles,
      ...over,
    });

    // Pré-condição global: um usuário com convidante só pode ter o CPA
    // resolvido quando o convidante já possui link real ativo com CPA na mesma
    // casa. Sem isso, mantém o pedido pendente e não usa fallback/default.
    const inviterHouseCpa = inviterId
      ? houseSlug === 'superbet' && dealId
        ? await this.readDealCpa(inviterId, houseSlug, dealId)
        : await this.readRealCpa(inviterId, houseSlug)
      : null;
    if (inviterId && inviterHouseCpa === null) {
      toggles.push('holdInviterNoCpa');
      return build({ hold: true });
    }

    // Regra espelho (ex.: SportingBet) — CPA = CPA do PRÓPRIO usuário na casa de
    // referência (ex.: superbet), 1:1, sem faixa/desconto. Sem CPA de referência
    // → fallback. Independe de convidante, por isso resolvida antes dos checks.
    if (rule.ruleType === 'MIRROR') {
      const refHouse = rule.rangeReferenceHouse ?? houseSlug;
      toggles.push('mirrorRef');
      const userRefCpa = await this.readRealCpa(userId, refHouse);
      if (userRefCpa === null) {
        toggles.push('noReferenceCpa');
        return build({
          rangeReferenceHouse: refHouse,
          cpa: fallbackCpa,
          ruleApplied: LinkAssignmentRuleApplied.FALLBACK,
          fallbackUsed: true,
        });
      }
      const refNum = userRefCpa.toNumber();
      return build({
        rangeReferenceHouse: refHouse,
        rangeReferenceCpa: refNum,
        cpa: refNum,
        ruleApplied: LinkAssignmentRuleApplied.MIRROR_REFERENCE,
      });
    }

    // Regra por faixa (ex.: Esportiva) — referência = CPA do PRÓPRIO usuário na
    // casa de referência (ex.: superbet). Independe de haver convidante, por
    // isso é resolvida ANTES dos checks de useInviterCpa/!inviterId.
    if (rule.ruleType === 'RANGE') {
      return this.resolveRange({
        houseSlug,
        userId,
        inviterId,
        rule,
        toggles,
        fallbackCpa,
        inviterHouseCpa,
        build,
      });
    }

    // Toggle: ignorar CPA do convidante.
    if (!rule.useInviterCpa) {
      toggles.push('useInviterCpa=false');
      return build({ cpa: defaultCpa });
    }

    // Usuário sem convidante.
    if (!inviterId) {
      if (rule.applyDefaultNoInviter) {
        toggles.push('applyDefaultNoInviter');
        return build({ cpa: defaultCpa });
      }
      return build({
        cpa: fallbackCpa,
        ruleApplied: LinkAssignmentRuleApplied.FALLBACK,
        fallbackUsed: true,
      });
    }

    // INVITER_DISCOUNT: CPA do convidante na própria casa.
    toggles.push('useInviterCpa');
    const invCpa = inviterHouseCpa!;

    const invNum = invCpa.toNumber();
    const threshold = rule.inviterCpaThreshold; // Prisma.Decimal | null
    const withinThreshold =
      threshold === null ? true : invCpa.lessThanOrEqualTo(threshold);

    if (withinThreshold) {
      const computed = invCpa.minus(rule.inviterCpaDiscount);
      const finalCpa = computed.greaterThan(0) ? computed.toNumber() : 0;
      toggles.push('inviterDiscount');
      return build({
        inviterCpa: invNum,
        cpa: finalCpa,
        ruleApplied: LinkAssignmentRuleApplied.INVITER_MINUS_DISCOUNT,
      });
    }

    // CPA do convidante acima do limite → CPA padrão.
    return build({ inviterCpa: invNum, cpa: defaultCpa });
  }

  /**
   * Regra por faixa (Esportiva). Referência = CPA do PRÓPRIO usuário na casa de
   * referência (ex.: superbet). Depois compara com o CPA do convidante na casa
   * atual (esportiva):
   *  - convidante sem CPA na casa → hold global antes de entrar neste método;
   *  - convidante com CPA igual ao calculado → calculado − inviterCpaDiscount;
   *  - sem convidante ou CPA diferente → valor da faixa.
   * Quem não tem link Superbet ativo é bloqueado antes (checkRequiredLinks).
   */
  private async resolveRange(ctx: {
    houseSlug: string;
    userId: string;
    inviterId: string | null;
    rule: HouseLinkRule;
    toggles: string[];
    fallbackCpa: number;
    inviterHouseCpa: Prisma.Decimal | null;
    build: (over: Partial<CpaResolution>) => CpaResolution;
  }): Promise<CpaResolution> {
    const {
      houseSlug,
      userId,
      inviterId,
      rule,
      toggles,
      fallbackCpa,
      inviterHouseCpa,
      build,
    } = ctx;
    const refHouse = rule.rangeReferenceHouse ?? houseSlug;
    toggles.push('rangeSelfRef');

    // CPA do próprio usuário na casa de referência (ex.: superbet).
    const userRefCpa = await this.readRealCpa(userId, refHouse);
    if (userRefCpa === null) {
      // Superbet ativo mas sem CPA configurado → fallback (55).
      toggles.push('noReferenceCpa');
      return build({
        rangeReferenceHouse: refHouse,
        cpa: fallbackCpa,
        ruleApplied: LinkAssignmentRuleApplied.FALLBACK,
        fallbackUsed: true,
      });
    }

    const refNum = userRefCpa.toNumber();
    const tiers = parseRangeTiers(rule.rangeTiers);
    const tier = tiers.find(
      (t) =>
        (t.min === null || refNum >= t.min) &&
        (t.max === null || refNum <= t.max),
    );
    if (!tier) {
      toggles.push('noTierMatch');
      return build({
        rangeReferenceHouse: refHouse,
        rangeReferenceCpa: refNum,
        cpa: fallbackCpa,
        ruleApplied: LinkAssignmentRuleApplied.FALLBACK,
        fallbackUsed: true,
      });
    }

    let cpa = tier.cpa;
    let ruleApplied: LinkAssignmentRuleApplied =
      LinkAssignmentRuleApplied.RANGE_RULE;
    let inviterCpaNum: number | null = null;

    // Comparação com o CPA do convidante na PRÓPRIA casa (esportiva).
    if (inviterId) {
      const inviterCpa = inviterHouseCpa!;
      inviterCpaNum = inviterCpa.toNumber();
      if (cpa === inviterCpaNum) {
        const discount = rule.inviterCpaDiscount.toNumber();
        cpa = cpa - discount > 0 ? cpa - discount : 0;
        ruleApplied = LinkAssignmentRuleApplied.INVITER_MINUS_DISCOUNT;
        toggles.push('equalToInviterMinusDiscount');
      }
    }

    return build({
      inviterCpa: inviterCpaNum,
      rangeReferenceHouse: refHouse,
      rangeReferenceCpa: refNum,
      cpa,
      ruleApplied,
    });
  }

  /**
   * Lê o CPA de um usuário numa casa considerando APENAS link real ativo
   * (POOL/MANUAL, não soft-deletado). Placeholder/commission-only é ignorado.
   */
  private async readRealCpa(
    userId: string,
    houseSlug: string,
  ): Promise<Prisma.Decimal | null> {
    const link = await this.prisma.affiliateLink.findFirst({
      where: {
        userId,
        bettingHouse: houseSlug,
        deletedAt: null,
        source: { in: [LinkSource.POOL, LinkSource.MANUAL] },
        cpa: { not: null },
      },
      select: { cpa: true },
      orderBy: { updatedAt: 'desc' },
    });
    return link?.cpa ?? null;
  }

  private async readDealCpa(
    userId: string,
    houseSlug: string,
    dealId: string,
  ): Promise<Prisma.Decimal | null> {
    const request = await this.prisma.linkRequest.findFirst({
      where: {
        userId,
        dealId,
        bettingHouseSlug: houseSlug,
        status: LinkRequestStatus.FULFILLED,
        resolvedCpa: { not: null },
      },
      select: { resolvedCpa: true },
      orderBy: [{ fulfilledAt: 'desc' }, { updatedAt: 'desc' }],
    });
    return request?.resolvedCpa ?? null;
  }
}
