import type { HouseLinkRule, LinkAssignmentRuleApplied } from '@prisma/client';

/** Faixa de CPA por referência (regra RANGE). min/max null = sem piso/teto. */
export interface RangeTier {
  min: number | null;
  max: number | null;
  cpa: number;
}

/** Resultado da resolução de CPA — base do snapshot gravado na LinkRequest. */
export interface CpaResolution {
  cpa: number;
  revshare: number;
  ruleApplied: LinkAssignmentRuleApplied;
  inviterId: string | null;
  inviterCpa: number | null;
  rangeReferenceHouse: string | null;
  rangeReferenceCpa: number | null;
  fallbackUsed: boolean;
  /** Toggles efetivamente considerados nesta resolução (auditoria). */
  togglesApplied: string[];
  /**
   * true = NÃO resolver CPA agora. O convidante ainda não tem CPA ativo na casa
   * e a regra global mantém o pedido PENDING com resolvedCpa=null até o
   * convidante ter link+CPA. O cron auto-snapshot re-resolve depois. `cpa` deve
   * ser ignorado quando hold=true.
   */
  hold?: boolean;
}

/** Resultado da checagem de dependência entre casas. */
export interface DependencyCheck {
  ok: boolean;
  requiredHouses: string[];
  missingHouses: string[];
}

/** Erro de validação de configuração de regra (admin). */
export interface RuleValidationIssue {
  field: string;
  message: string;
}

export type HouseLinkRuleRow = HouseLinkRule;

/** Lê com segurança o array de faixas (Json) de uma regra. */
export function parseRangeTiers(raw: unknown): RangeTier[] {
  if (!Array.isArray(raw)) return [];
  const tiers: RangeTier[] = [];
  for (const t of raw) {
    if (t === null || typeof t !== 'object') continue;
    const obj = t as Record<string, unknown>;
    const cpa = Number(obj['cpa']);
    if (!Number.isFinite(cpa)) continue;
    const min =
      obj['min'] === null || obj['min'] === undefined
        ? null
        : Number(obj['min']);
    const max =
      obj['max'] === null || obj['max'] === undefined
        ? null
        : Number(obj['max']);
    tiers.push({
      min: min !== null && Number.isFinite(min) ? min : null,
      max: max !== null && Number.isFinite(max) ? max : null,
      cpa,
    });
  }
  return tiers;
}
