import {
  parseRangeTiers,
  type RangeTier,
  type RuleValidationIssue,
} from '../domain/types/house-link-rule.types.js';

export interface RuleValidationInput {
  ruleType: 'INVITER_DISCOUNT' | 'RANGE' | 'MIRROR';
  defaultCpa: number;
  fallbackCpa: number;
  inviterCpaThreshold: number | null;
  inviterCpaDiscount: number;
  defaultRevshare?: number;
  rangeReferenceHouse: string | null;
  rangeTiers: unknown;
  requireActiveLinkInHouses: boolean;
  requiredHouseSlugs: string[];
  blockOnRequiredFail: boolean;
  blockMessage: string;
}

export interface RuleValidationContext {
  /** Slug da casa sendo configurada. */
  selfSlug: string;
  /** Slugs de casas ativas existentes (para validar dependências). */
  activeHouseSlugs: Set<string>;
  /**
   * Grafo de dependências atual: houseSlug -> casas exigidas (apenas quando o
   * toggle requireActiveLinkInHouses está ativo). NÃO inclui a casa sendo
   * salva — a aresta proposta é adicionada durante a checagem de ciclo.
   */
  dependencyGraph: Map<string, string[]>;
}

/** Valida a configuração de uma HouseLinkRule antes de salvar (§14/§15). */
export function validateHouseLinkRule(
  input: RuleValidationInput,
  ctx: RuleValidationContext,
): RuleValidationIssue[] {
  const issues: RuleValidationIssue[] = [];

  if (!(input.defaultCpa >= 0)) {
    issues.push({
      field: 'defaultCpa',
      message: 'CPA padrão não pode ser negativo.',
    });
  }
  if (!(input.fallbackCpa >= 0)) {
    issues.push({
      field: 'fallbackCpa',
      message: 'CPA fallback não pode ser negativo.',
    });
  }
  if (!(input.inviterCpaDiscount >= 0)) {
    issues.push({
      field: 'inviterCpaDiscount',
      message: 'Desconto não pode ser negativo.',
    });
  }

  if (input.ruleType === 'INVITER_DISCOUNT') {
    if (
      input.inviterCpaThreshold === null ||
      input.inviterCpaThreshold === undefined
    ) {
      issues.push({
        field: 'inviterCpaThreshold',
        message:
          'Limite (threshold) é obrigatório quando a regra é INVITER_DISCOUNT.',
      });
    }
  }

  if (input.ruleType === 'MIRROR') {
    if (!input.rangeReferenceHouse) {
      issues.push({
        field: 'rangeReferenceHouse',
        message: 'Casa de referência é obrigatória quando a regra é MIRROR.',
      });
    } else if (!ctx.activeHouseSlugs.has(input.rangeReferenceHouse)) {
      issues.push({
        field: 'rangeReferenceHouse',
        message: `Casa de referência "${input.rangeReferenceHouse}" não existe ou está inativa.`,
      });
    }
  }

  if (input.ruleType === 'RANGE') {
    if (!input.rangeReferenceHouse) {
      issues.push({
        field: 'rangeReferenceHouse',
        message: 'Casa de referência é obrigatória quando a regra é RANGE.',
      });
    } else if (!ctx.activeHouseSlugs.has(input.rangeReferenceHouse)) {
      issues.push({
        field: 'rangeReferenceHouse',
        message: `Casa de referência "${input.rangeReferenceHouse}" não existe ou está inativa.`,
      });
    }
    const tiers = parseRangeTiers(input.rangeTiers);
    if (tiers.length === 0) {
      issues.push({
        field: 'rangeTiers',
        message: 'Defina ao menos uma faixa válida quando a regra é RANGE.',
      });
    }
    if (tiers.some((t) => !(t.cpa >= 0))) {
      issues.push({
        field: 'rangeTiers',
        message: 'CPA das faixas não pode ser negativo.',
      });
    }
    const overlap = findTierOverlap(tiers);
    if (overlap) {
      issues.push({
        field: 'rangeTiers',
        message: `Faixas se sobrepõem: ${overlap}.`,
      });
    }
  }

  if (input.requireActiveLinkInHouses) {
    if (input.requiredHouseSlugs.includes(ctx.selfSlug)) {
      issues.push({
        field: 'requiredHouseSlugs',
        message: 'A casa não pode exigir link ativo nela mesma.',
      });
    }
    for (const slug of input.requiredHouseSlugs) {
      if (slug === ctx.selfSlug) continue;
      if (!ctx.activeHouseSlugs.has(slug)) {
        issues.push({
          field: 'requiredHouseSlugs',
          message: `Casa exigida "${slug}" não existe ou está inativa.`,
        });
      }
    }
    const cycle = findDependencyCycle(
      ctx.dependencyGraph,
      ctx.selfSlug,
      input.requiredHouseSlugs,
    );
    if (cycle) {
      issues.push({
        field: 'requiredHouseSlugs',
        message:
          'Não é possível salvar esta configuração porque ela cria uma dependência circular entre casas: ' +
          cycle.join(' → ') +
          '.',
      });
    }
    if (input.blockOnRequiredFail && !input.blockMessage.trim()) {
      issues.push({
        field: 'blockMessage',
        message:
          'Mensagem de bloqueio é obrigatória quando o bloqueio está ativo.',
      });
    }
  }

  return issues;
}

/** Retorna a descrição da 1ª sobreposição entre faixas, ou null. */
export function findTierOverlap(tiers: RangeTier[]): string | null {
  const lo = (t: RangeTier) => (t.min === null ? -Infinity : t.min);
  const hi = (t: RangeTier) => (t.max === null ? Infinity : t.max);
  for (let i = 0; i < tiers.length; i++) {
    for (let j = i + 1; j < tiers.length; j++) {
      const a = tiers[i]!;
      const b = tiers[j]!;
      if (lo(a) <= hi(b) && lo(b) <= hi(a)) {
        return `[${a.min ?? '-∞'}..${a.max ?? '∞'}] x [${b.min ?? '-∞'}..${b.max ?? '∞'}]`;
      }
    }
  }
  return null;
}

/**
 * Detecta dependência circular ao aplicar a aresta proposta (selfSlug exige
 * proposedRequired). Retorna o caminho do ciclo (começando e terminando em
 * selfSlug) ou null se não há ciclo.
 */
export function findDependencyCycle(
  graph: Map<string, string[]>,
  selfSlug: string,
  proposedRequired: string[],
): string[] | null {
  // Cópia do grafo com a aresta proposta aplicada.
  const adj = new Map<string, string[]>();
  for (const [k, v] of graph) adj.set(k, [...v]);
  adj.set(
    selfSlug,
    proposedRequired.filter((s) => s !== selfSlug),
  );

  // DFS a partir de selfSlug; ciclo se reencontrarmos selfSlug.
  const path: string[] = [selfSlug];
  const visited = new Set<string>();

  const dfs = (node: string): string[] | null => {
    for (const next of adj.get(node) ?? []) {
      if (next === selfSlug) return [...path, selfSlug];
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      const found = dfs(next);
      if (found) return found;
      path.pop();
    }
    return null;
  };

  return dfs(selfSlug);
}
