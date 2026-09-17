import { Prisma, PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { requestContext } from '../../common/context/request-context.js';

const logger = new Logger('PrismaAudit');

/** Lançado quando alguém tenta hard-delete de link/saque (proibido). */
export class ForbiddenHardDeleteError extends Error {
  constructor(op: string) {
    super(
      `Hard-delete bloqueado em ${op}. Use soft-delete (deletedAt) ou mudança de status — ` +
        `link/cpa/campaignId e histórico de saque nunca podem ser apagados.`,
    );
    this.name = 'ForbiddenHardDeleteError';
  }
}

type Dec = Prisma.Decimal | null | undefined;
const decStr = (v: Dec): string | null => (v == null ? null : v.toString());
const decChanged = (a: Dec, b: Dec): boolean => decStr(a) !== decStr(b);

interface LinkRow {
  id?: string;
  userId: string;
  bettingHouse: string;
  cpa: Prisma.Decimal | null;
  revshare: Prisma.Decimal | null;
}

const ENFORCE_CPA_SOURCES = new Set(['APPROVAL', 'ADMIN_EDIT']);

/** Invariante: cpa não pode ficar null em aprovação/edição-admin. */
export function assertCpaSet(data: Record<string, unknown> | undefined): void {
  if (!data || !('cpa' in data)) return;
  const ctx = requestContext.get();
  const source = ctx?.source ?? 'SCRIPT';
  if (data.cpa == null) {
    if (ENFORCE_CPA_SOURCES.has(source)) {
      throw new Error(
        `CPA obrigatório: tentativa de gravar AffiliateLink com cpa nulo (source=${source}).`,
      );
    }
    logger.warn(`AffiliateLink gravado com cpa nulo (source=${source}).`);
  }
}

/** Grava CommissionLog para cada campo cpa/revshare que mudou. base = client cru. */
export async function writeCommissionDiff(
  base: PrismaClient,
  before: LinkRow | null,
  after: LinkRow,
): Promise<void> {
  const ctx = requestContext.get();
  const source = ctx?.source ?? 'SCRIPT';
  const changedById = ctx?.changedById ?? null;

  const diffs: { field: 'cpa' | 'revshare'; oldValue: Dec; newValue: Dec }[] =
    [];
  for (const field of ['cpa', 'revshare'] as const) {
    const oldV = before ? before[field] : null;
    const newV = after[field];
    if (decChanged(oldV, newV))
      diffs.push({ field, oldValue: oldV, newValue: newV });
  }
  if (diffs.length === 0) return;

  const user = await base.user.findUnique({
    where: { id: after.userId },
    select: { name: true, email: true },
  });
  await base.commissionLog.createMany({
    data: diffs.map((d) => ({
      userId: after.userId,
      userName: user?.name ?? '',
      userEmail: user?.email ?? '',
      changedById,
      bettingHouse: after.bettingHouse,
      field: d.field,
      oldValue: d.oldValue ?? null,
      newValue: d.newValue ?? null,
      source,
    })),
  });
}

const LINK_SELECT = {
  id: true,
  userId: true,
  bettingHouse: true,
  cpa: true,
  revshare: true,
} as const;

/**
 * Injeta `deletedAt: null` no where de leituras DIRETAS de affiliateLink, a não
 * ser que o chamador já tenha especificado `deletedAt` (escape p/ ver apagados).
 * NÃO cobre includes aninhados (ex.: user.findMany({include:{affiliateLinks}}))
 * nem SQL cru — esses são filtrados manualmente nos call sites.
 */
export function withNotDeleted<T extends { where?: Record<string, unknown> }>(
  args: T,
): T {
  const where = (args.where ?? {}) as Record<string, unknown>;
  if ('deletedAt' in where) return args;
  return { ...args, where: { ...where, deletedAt: null } } as T;
}

/**
 * Extensão Prisma de auditoria + proteção:
 *  - LOG: toda mudança de cpa/revshare em affiliateLink.create/update vira CommissionLog.
 *  - GUARD: hard-delete de affiliateLink e withdrawalRequest é PROIBIDO (throw).
 *  - INVARIANTE: cpa não pode ficar null em aprovação/edição-admin.
 * `base` é o client SEM extensão (evita recursão nos sub-queries/log).
 */
export function auditExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: 'affiliateAudit',
    query: {
      affiliateLink: {
        async create({ args, query }) {
          assertCpaSet(args.data as Record<string, unknown>);
          const result = (await query(args)) as unknown as LinkRow;
          await writeCommissionDiff(base, null, result);
          return result as never;
        },
        async update({ args, query }) {
          assertCpaSet(args.data as Record<string, unknown>);
          const before = (await base.affiliateLink.findUnique({
            where: args.where,
            select: LINK_SELECT,
          })) as LinkRow | null;
          const result = (await query(args)) as unknown as LinkRow;
          await writeCommissionDiff(base, before, result);
          return result as never;
        },
        async updateMany({ args, query }) {
          const data = (args.data ?? {}) as Record<string, unknown>;
          if ('cpa' in data || 'revshare' in data) {
            logger.warn(
              'updateMany alterou cpa/revshare em lote — CommissionLog por-linha NÃO gravado. ' +
                'Prefira updates individuais ou logue manualmente.',
            );
          }
          return query(args);
        },
        // ── Auto-filtro de soft-delete em leituras DIRETAS ──
        findMany({ args, query }) {
          return query(withNotDeleted(args));
        },
        findFirst({ args, query }) {
          return query(withNotDeleted(args));
        },
        count({ args, query }) {
          return query(withNotDeleted(args));
        },
        aggregate({ args, query }) {
          return query(withNotDeleted(args));
        },
        groupBy({ args, query }) {
          return query(withNotDeleted(args));
        },
        delete() {
          throw new ForbiddenHardDeleteError('affiliateLink.delete');
        },
        deleteMany() {
          throw new ForbiddenHardDeleteError('affiliateLink.deleteMany');
        },
      },
      withdrawalRequest: {
        delete() {
          throw new ForbiddenHardDeleteError('withdrawalRequest.delete');
        },
        deleteMany() {
          throw new ForbiddenHardDeleteError('withdrawalRequest.deleteMany');
        },
      },
    },
  });
}
