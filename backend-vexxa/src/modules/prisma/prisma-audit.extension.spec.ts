import { describe, it, expect, vi } from 'vitest';
import {
  withNotDeleted,
  assertCpaSet,
  writeCommissionDiff,
  ForbiddenHardDeleteError,
} from './prisma-audit.extension.js';
import { requestContext } from '../../common/context/request-context.js';

// Mimic Prisma.Decimal (apenas .toString(), que é o que o código usa).
const dec = (v: number | string) => ({ toString: () => String(v) }) as never;

describe('prisma-audit.extension', () => {
  describe('withNotDeleted', () => {
    it('injeta deletedAt:null quando ausente', () => {
      expect(withNotDeleted({ where: { userId: 'u1' } })).toEqual({
        where: { userId: 'u1', deletedAt: null },
      });
    });
    it('cria where quando não há', () => {
      expect(withNotDeleted({})).toEqual({ where: { deletedAt: null } });
    });
    it('respeita deletedAt explícito (escape p/ ver apagados)', () => {
      const args = { where: { deletedAt: { not: null } } };
      expect(withNotDeleted(args)).toBe(args);
    });
  });

  describe('assertCpaSet', () => {
    it('não lança quando cpa não está no payload', () => {
      expect(() => assertCpaSet({ revshare: 0 })).not.toThrow();
    });
    it('lança quando cpa null em APPROVAL', () => {
      requestContext.run({ source: 'APPROVAL' }, () => {
        expect(() => assertCpaSet({ cpa: null })).toThrow(/CPA obrigatório/);
      });
    });
    it('NÃO lança quando cpa null em SYNC (só avisa)', () => {
      requestContext.run({ source: 'SYNC' }, () => {
        expect(() => assertCpaSet({ cpa: null })).not.toThrow();
      });
    });
    it('não lança quando cpa setado', () => {
      requestContext.run({ source: 'ADMIN_EDIT' }, () => {
        expect(() => assertCpaSet({ cpa: 110 })).not.toThrow();
      });
    });
  });

  describe('writeCommissionDiff', () => {
    const makeBase = () => {
      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      const base = {
        user: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ name: 'Fulano', email: 'f@x.com' }),
        },
        commissionLog: { createMany },
      } as never;
      return { base, createMany };
    };
    const link = (cpa: number | null, revshare: number | null) => ({
      id: 'l1',
      userId: 'u1',
      bettingHouse: 'superbet',
      cpa: cpa == null ? null : dec(cpa),
      revshare: revshare == null ? null : dec(revshare),
    });

    it('grava 1 row quando cpa muda', async () => {
      const { base, createMany } = makeBase();
      await requestContext.run(
        { source: 'ADMIN_EDIT', changedById: 'admin1' },
        () => writeCommissionDiff(base, link(100, 0), link(110, 0)),
      );
      expect(createMany).toHaveBeenCalledTimes(1);
      const rows = createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        field: 'cpa',
        bettingHouse: 'superbet',
        source: 'ADMIN_EDIT',
        changedById: 'admin1',
        userEmail: 'f@x.com',
      });
      expect(rows[0].oldValue.toString()).toBe('100');
      expect(rows[0].newValue.toString()).toBe('110');
    });

    it('NÃO grava quando nada muda', async () => {
      const { base, createMany } = makeBase();
      await writeCommissionDiff(base, link(100, 0), link(100, 0));
      expect(createMany).not.toHaveBeenCalled();
    });

    it('loga valor inicial no create (before=null)', async () => {
      const { base, createMany } = makeBase();
      await requestContext.run({ source: 'APPROVAL' }, () =>
        writeCommissionDiff(base, null, link(115, null)),
      );
      const rows = createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(1);
      expect(rows[0].field).toBe('cpa');
      expect(rows[0].oldValue).toBeNull();
      expect(rows[0].newValue.toString()).toBe('115');
      expect(rows[0].source).toBe('APPROVAL');
    });

    it('source default = SCRIPT sem contexto', async () => {
      const { base, createMany } = makeBase();
      await writeCommissionDiff(base, link(100, 0), link(90, 0));
      expect(createMany.mock.calls[0][0].data[0].source).toBe('SCRIPT');
    });
  });

  describe('ForbiddenHardDeleteError', () => {
    it('tem mensagem de bloqueio', () => {
      const e = new ForbiddenHardDeleteError('affiliateLink.delete');
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toMatch(/Hard-delete bloqueado/);
    });
  });
});
