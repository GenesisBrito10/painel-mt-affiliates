import { describe, it, expect, vi } from 'vitest';
import { LinkSource } from '@prisma/client';
import { LinkDependencyService } from './link-dependency.service.js';

/**
 * prisma.affiliateLink.findMany já aplica o where (deletedAt null + source POOL/MANUAL).
 * O mock devolve só as linhas que "passariam" no filtro, simulando o DB.
 */
function makePrisma(activeHouses: string[]) {
  return {
    affiliateLink: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          activeHouses.map((bettingHouse) => ({ bettingHouse })),
        ),
    },
  } as never;
}

const rule = (
  requireActiveLinkInHouses: boolean,
  requiredHouseSlugs: string[],
) => ({ requireActiveLinkInHouses, requiredHouseSlugs }) as never;

describe('LinkDependencyService', () => {
  it('toggle off → ok sem checar', async () => {
    const svc = new LinkDependencyService(makePrisma([]));
    const r = await svc.checkRequiredLinks('u', rule(false, ['superbet']));
    expect(r).toEqual({ ok: true, requiredHouses: [], missingHouses: [] });
  });

  it('toggle on, só Superbet exigida → ok (Superbet nunca é pré-requisito)', async () => {
    const svc = new LinkDependencyService(makePrisma([]));
    const r = await svc.checkRequiredLinks('u', rule(true, ['superbet']));
    expect(r).toEqual({ ok: true, requiredHouses: [], missingHouses: [] });
  });

  it('toggle on, outra casa exigida e possui link → ok', async () => {
    const svc = new LinkDependencyService(makePrisma(['betnacional']));
    const r = await svc.checkRequiredLinks('u', rule(true, ['betnacional']));
    expect(r.ok).toBe(true);
    expect(r.missingHouses).toEqual([]);
  });

  it('toggle on, falta link de casa exigida (não-Superbet) → bloqueia', async () => {
    const svc = new LinkDependencyService(makePrisma([]));
    const r = await svc.checkRequiredLinks('u', rule(true, ['betnacional']));
    expect(r.ok).toBe(false);
    expect(r.missingHouses).toEqual(['betnacional']);
  });

  it('Superbet na lista é ignorada; exige demais casas', async () => {
    const svc = new LinkDependencyService(makePrisma(['superbet']));
    const r = await svc.checkRequiredLinks(
      'u',
      rule(true, ['superbet', 'betnacional']),
    );
    expect(r.ok).toBe(false);
    expect(r.requiredHouses).toEqual(['betnacional']);
    expect(r.missingHouses).toEqual(['betnacional']);
  });

  it('query filtra por link real ativo (POOL/MANUAL, deletedAt null)', async () => {
    const prisma = makePrisma(['betnacional']);
    const svc = new LinkDependencyService(prisma);
    await svc.checkRequiredLinks('u', rule(true, ['betnacional']));
    const call = (
      prisma as unknown as {
        affiliateLink: { findMany: { mock: { calls: unknown[][] } } };
      }
    ).affiliateLink.findMany.mock.calls[0]![0] as {
      where: { deletedAt: null; source: { in: LinkSource[] } };
    };
    expect(call.where.deletedAt).toBeNull();
    expect(call.where.source.in).toEqual([LinkSource.POOL, LinkSource.MANUAL]);
  });
});
