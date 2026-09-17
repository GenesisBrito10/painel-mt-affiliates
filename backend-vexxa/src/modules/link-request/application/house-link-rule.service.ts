import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type HouseLinkRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  validateHouseLinkRule,
  type RuleValidationInput,
} from './link-rule-validation.js';
import { parseRangeTiers } from '../domain/types/house-link-rule.types.js';
import { type UpsertHouseLinkRuleDto } from './dto/house-link-rule.dto.js';

const CACHE_TTL_MS = 30_000;

/** Campos financeiros que exigem changeReason ao alterar (§6). */
const CRITICAL_FIELDS = [
  'defaultCpa',
  'fallbackCpa',
  'inviterCpaThreshold',
  'inviterCpaDiscount',
  'rangeTiers',
  'rangeReferenceHouse',
  'requiredHouseSlugs',
] as const;

@Injectable()
export class HouseLinkRuleService {
  private cache = new Map<string, { rule: HouseLinkRule; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Lê a regra de uma casa (cache curto). null se não configurada. */
  async getRule(houseSlug: string): Promise<HouseLinkRule | null> {
    const slug = houseSlug.toLowerCase();
    const hit = this.cache.get(slug);
    if (hit && hit.expires > Date.now()) return hit.rule;

    const rule = await this.prisma.houseLinkRule.findUnique({
      where: { houseSlug: slug },
    });
    if (rule)
      this.cache.set(slug, { rule, expires: Date.now() + CACHE_TTL_MS });
    return rule;
  }

  invalidate(houseSlug: string): void {
    this.cache.delete(houseSlug.toLowerCase());
  }

  async listRules(): Promise<HouseLinkRule[]> {
    return this.prisma.houseLinkRule.findMany({
      orderBy: { houseSlug: 'asc' },
    });
  }

  async getChangeHistory(houseSlug: string, limit = 50) {
    return this.prisma.houseLinkRuleChangeLog.findMany({
      where: { houseSlug: houseSlug.toLowerCase() },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** Cria/atualiza a regra com validação (§14/§15) e log de domínio (§12). */
  async upsertRule(
    houseSlug: string,
    dto: UpsertHouseLinkRuleDto,
    adminName: string,
  ): Promise<HouseLinkRule> {
    const slug = houseSlug.toLowerCase();

    const house = await this.prisma.bettingHouse.findUnique({
      where: { slug },
      select: { slug: true, active: true },
    });
    if (!house) throw new NotFoundException(`Casa "${slug}" não encontrada.`);

    const existing = await this.prisma.houseLinkRule.findUnique({
      where: { houseSlug: slug },
    });

    const merged = this.mergeForValidation(existing, dto);

    const [activeHouseSlugs, dependencyGraph] = await Promise.all([
      this.loadActiveHouseSlugs(),
      this.buildDependencyGraph(slug),
    ]);

    const issues = validateHouseLinkRule(merged, {
      selfSlug: slug,
      activeHouseSlugs,
      dependencyGraph,
    });
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Configuração inválida.',
        issues,
      });
    }

    // Diff p/ change log + exigência de motivo em campos críticos.
    const changes = this.computeChanges(existing, dto);
    const changedFields = Object.keys(changes);
    const touchedCritical = changedFields.some((f) =>
      (CRITICAL_FIELDS as readonly string[]).includes(f),
    );
    if (existing && touchedCritical && !dto.changeReason?.trim()) {
      throw new BadRequestException({
        message:
          'Motivo (changeReason) é obrigatório ao alterar valores financeiros da regra.',
        fields: changedFields.filter((f) =>
          (CRITICAL_FIELDS as readonly string[]).includes(f),
        ),
      });
    }

    const data = this.toPrismaData(dto);
    const rule = await this.prisma.houseLinkRule.upsert({
      where: { houseSlug: slug },
      create: { houseSlug: slug, ...data, updatedByName: adminName },
      update: { ...data, updatedByName: adminName },
    });

    if (changedFields.length > 0) {
      await this.prisma.houseLinkRuleChangeLog.create({
        data: {
          houseRuleId: rule.id,
          houseSlug: slug,
          adminName,
          changeReason: dto.changeReason ?? null,
          changes: changes as Prisma.InputJsonValue,
          blockMessageOld: existing?.blockMessage ?? '',
          blockMessageNew: rule.blockMessage,
        },
      });
    }

    this.invalidate(slug);
    return rule;
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async loadActiveHouseSlugs(): Promise<Set<string>> {
    const houses = await this.prisma.bettingHouse.findMany({
      where: { active: true },
      select: { slug: true },
    });
    return new Set(houses.map((h) => h.slug));
  }

  private async buildDependencyGraph(
    excludeSlug: string,
  ): Promise<Map<string, string[]>> {
    const rules = await this.prisma.houseLinkRule.findMany({
      where: {
        requireActiveLinkInHouses: true,
        NOT: { houseSlug: excludeSlug },
      },
      select: { houseSlug: true, requiredHouseSlugs: true },
    });
    const graph = new Map<string, string[]>();
    for (const r of rules) graph.set(r.houseSlug, r.requiredHouseSlugs);
    return graph;
  }

  /** Valores efetivos (existing sobrescrito por dto) p/ validação. */
  private mergeForValidation(
    existing: HouseLinkRule | null,
    dto: UpsertHouseLinkRuleDto,
  ): RuleValidationInput {
    const num = (v: number | null | undefined, fallback: number): number =>
      v === null || v === undefined ? fallback : v;

    const exThreshold =
      existing?.inviterCpaThreshold == null
        ? null
        : existing.inviterCpaThreshold.toNumber();

    return {
      ruleType: dto.ruleType ?? existing?.ruleType ?? 'INVITER_DISCOUNT',
      defaultCpa: num(dto.defaultCpa, existing?.defaultCpa.toNumber() ?? 0),
      fallbackCpa: num(dto.fallbackCpa, existing?.fallbackCpa.toNumber() ?? 0),
      inviterCpaThreshold:
        dto.inviterCpaThreshold !== undefined
          ? dto.inviterCpaThreshold
          : exThreshold,
      inviterCpaDiscount: num(
        dto.inviterCpaDiscount,
        existing?.inviterCpaDiscount.toNumber() ?? 5,
      ),
      rangeReferenceHouse:
        dto.rangeReferenceHouse !== undefined
          ? dto.rangeReferenceHouse
          : (existing?.rangeReferenceHouse ?? null),
      rangeTiers: dto.rangeTiers ?? existing?.rangeTiers ?? [],
      requireActiveLinkInHouses:
        dto.requireActiveLinkInHouses ??
        existing?.requireActiveLinkInHouses ??
        false,
      requiredHouseSlugs:
        dto.requiredHouseSlugs ?? existing?.requiredHouseSlugs ?? [],
      blockOnRequiredFail:
        dto.blockOnRequiredFail ?? existing?.blockOnRequiredFail ?? true,
      blockMessage: dto.blockMessage ?? existing?.blockMessage ?? '',
    };
  }

  /** Apenas os campos presentes no dto viram update Prisma. */
  private toPrismaData(
    dto: UpsertHouseLinkRuleDto,
  ): Partial<Prisma.HouseLinkRuleUncheckedCreateInput> {
    const d: Partial<Prisma.HouseLinkRuleUncheckedCreateInput> = {};
    if (dto.requestEnabled !== undefined) d.requestEnabled = dto.requestEnabled;
    if (dto.autoAssignEnabled !== undefined)
      d.autoAssignEnabled = dto.autoAssignEnabled;
    if (dto.ruleType !== undefined) d.ruleType = dto.ruleType;
    if (dto.defaultCpa !== undefined) d.defaultCpa = dto.defaultCpa;
    if (dto.fallbackCpa !== undefined) d.fallbackCpa = dto.fallbackCpa;
    if (dto.inviterCpaThreshold !== undefined)
      d.inviterCpaThreshold = dto.inviterCpaThreshold;
    if (dto.inviterCpaDiscount !== undefined)
      d.inviterCpaDiscount = dto.inviterCpaDiscount;
    if (dto.defaultRevshare !== undefined)
      d.defaultRevshare = dto.defaultRevshare;
    if (dto.rangeReferenceHouse !== undefined)
      d.rangeReferenceHouse = dto.rangeReferenceHouse;
    if (dto.rangeTiers !== undefined)
      d.rangeTiers = dto.rangeTiers as unknown as Prisma.InputJsonValue;
    if (dto.checkExistingLink !== undefined)
      d.checkExistingLink = dto.checkExistingLink;
    if (dto.checkPendingRequest !== undefined)
      d.checkPendingRequest = dto.checkPendingRequest;
    if (dto.useInviterCpa !== undefined) d.useInviterCpa = dto.useInviterCpa;
    if (dto.applyFallbackNoInviterCpa !== undefined)
      d.applyFallbackNoInviterCpa = dto.applyFallbackNoInviterCpa;
    if (dto.applyDefaultNoInviter !== undefined)
      d.applyDefaultNoInviter = dto.applyDefaultNoInviter;
    if (dto.blockOnRequiredFail !== undefined)
      d.blockOnRequiredFail = dto.blockOnRequiredFail;
    if (dto.processOldRequests !== undefined)
      d.processOldRequests = dto.processOldRequests;
    if (dto.requireActiveLinkInHouses !== undefined)
      d.requireActiveLinkInHouses = dto.requireActiveLinkInHouses;
    if (dto.requiredHouseSlugs !== undefined)
      d.requiredHouseSlugs = dto.requiredHouseSlugs;
    if (dto.blockMessage !== undefined) d.blockMessage = dto.blockMessage;
    return d;
  }

  /** Diff de campos providos vs existente, p/ o change log. */
  private computeChanges(
    existing: HouseLinkRule | null,
    dto: UpsertHouseLinkRuleDto,
  ): Record<string, { old: unknown; new: unknown }> {
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    const dec = (v: Prisma.Decimal | null | undefined) =>
      v == null ? null : v.toNumber();

    const oldOf = (field: string): unknown => {
      if (!existing) return null;
      switch (field) {
        case 'defaultCpa':
          return dec(existing.defaultCpa);
        case 'fallbackCpa':
          return dec(existing.fallbackCpa);
        case 'inviterCpaThreshold':
          return dec(existing.inviterCpaThreshold);
        case 'inviterCpaDiscount':
          return dec(existing.inviterCpaDiscount);
        case 'defaultRevshare':
          return dec(existing.defaultRevshare);
        case 'rangeTiers':
          return parseRangeTiers(existing.rangeTiers);
        default:
          return (existing as unknown as Record<string, unknown>)[field];
      }
    };

    for (const [field, value] of Object.entries(dto)) {
      if (value === undefined || field === 'changeReason') continue;
      const oldValue = oldOf(field);
      if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
        changes[field] = { old: oldValue, new: value };
      }
    }
    return changes;
  }
}
