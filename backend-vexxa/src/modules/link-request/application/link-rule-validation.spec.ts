import { describe, it, expect } from 'vitest';
import {
  validateHouseLinkRule,
  findDependencyCycle,
  findTierOverlap,
  type RuleValidationInput,
  type RuleValidationContext,
} from './link-rule-validation.js';

function input(over: Partial<RuleValidationInput> = {}): RuleValidationInput {
  return {
    ruleType: 'INVITER_DISCOUNT',
    defaultCpa: 100,
    fallbackCpa: 100,
    inviterCpaThreshold: 105,
    inviterCpaDiscount: 5,
    rangeReferenceHouse: null,
    rangeTiers: [],
    requireActiveLinkInHouses: false,
    requiredHouseSlugs: [],
    blockOnRequiredFail: true,
    blockMessage: '',
    ...over,
  };
}

function ctx(over: Partial<RuleValidationContext> = {}): RuleValidationContext {
  return {
    selfSlug: 'esportivabet',
    activeHouseSlugs: new Set([
      'superbet',
      'betnacional',
      'hiperbet',
      'esportivabet',
    ]),
    dependencyGraph: new Map(),
    ...over,
  };
}

const fields = (issues: { field: string }[]) => issues.map((i) => i.field);

describe('validateHouseLinkRule', () => {
  it('aceita config INVITER_DISCOUNT válida', () => {
    expect(
      validateHouseLinkRule(input(), ctx({ selfSlug: 'superbet' })),
    ).toEqual([]);
  });

  it('rejeita CPA negativo', () => {
    const issues = validateHouseLinkRule(
      input({ defaultCpa: -1, fallbackCpa: -2 }),
      ctx(),
    );
    expect(fields(issues)).toEqual(
      expect.arrayContaining(['defaultCpa', 'fallbackCpa']),
    );
  });

  it('exige threshold em INVITER_DISCOUNT', () => {
    const issues = validateHouseLinkRule(
      input({ inviterCpaThreshold: null }),
      ctx(),
    );
    expect(fields(issues)).toContain('inviterCpaThreshold');
  });

  it('exige rangeReferenceHouse + faixas em RANGE', () => {
    const issues = validateHouseLinkRule(
      input({
        ruleType: 'RANGE',
        inviterCpaThreshold: null,
        rangeReferenceHouse: null,
        rangeTiers: [],
      }),
      ctx(),
    );
    expect(fields(issues)).toEqual(
      expect.arrayContaining(['rangeReferenceHouse', 'rangeTiers']),
    );
  });

  it('rejeita faixas sobrepostas', () => {
    const issues = validateHouseLinkRule(
      input({
        ruleType: 'RANGE',
        inviterCpaThreshold: null,
        rangeReferenceHouse: 'superbet',
        rangeTiers: [
          { min: 100, max: 120, cpa: 60 },
          { min: 110, max: 130, cpa: 65 },
        ],
      }),
      ctx(),
    );
    expect(fields(issues)).toContain('rangeTiers');
  });

  it('rejeita casa exigindo link nela mesma', () => {
    const issues = validateHouseLinkRule(
      input({
        requireActiveLinkInHouses: true,
        requiredHouseSlugs: ['esportivabet'],
        blockMessage: 'x',
      }),
      ctx({ selfSlug: 'esportivabet' }),
    );
    expect(fields(issues)).toContain('requiredHouseSlugs');
  });

  it('exige blockMessage quando blockOnRequiredFail=true e há dependência', () => {
    const issues = validateHouseLinkRule(
      input({
        requireActiveLinkInHouses: true,
        requiredHouseSlugs: ['superbet'],
        blockMessage: '  ',
      }),
      ctx(),
    );
    expect(fields(issues)).toContain('blockMessage');
  });

  it('bloqueia dependência circular (esportiva↔superbet)', () => {
    // superbet já exige esportivabet; agora esportivabet tentaria exigir superbet.
    const graph = new Map<string, string[]>([['superbet', ['esportivabet']]]);
    const issues = validateHouseLinkRule(
      input({
        requireActiveLinkInHouses: true,
        requiredHouseSlugs: ['superbet'],
        blockMessage: 'x',
      }),
      ctx({ selfSlug: 'esportivabet', dependencyGraph: graph }),
    );
    expect(fields(issues)).toContain('requiredHouseSlugs');
  });
});

describe('findDependencyCycle', () => {
  it('detecta ciclo direto A→B→A', () => {
    const graph = new Map<string, string[]>([['superbet', ['esportivabet']]]);
    expect(
      findDependencyCycle(graph, 'esportivabet', ['superbet']),
    ).not.toBeNull();
  });

  it('não acusa ciclo em cadeia acíclica', () => {
    const graph = new Map<string, string[]>([['hiperbet', ['betnacional']]]);
    expect(findDependencyCycle(graph, 'esportivabet', ['superbet'])).toBeNull();
  });
});

describe('findTierOverlap', () => {
  it('faixas contíguas não sobrepõem', () => {
    expect(
      findTierOverlap([
        { min: 116, max: 120, cpa: 65 },
        { min: 115, max: 115, cpa: 60 },
        { min: 100, max: 114, cpa: 55 },
        { min: null, max: 99, cpa: 50 },
      ]),
    ).toBeNull();
  });
});
