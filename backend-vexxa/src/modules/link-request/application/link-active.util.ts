import { LinkSource, type Prisma } from '@prisma/client';

/**
 * Fonte de verdade do que conta como "link real ativo".
 * deletedAt IS NULL AND source IN (POOL, MANUAL).
 * Placeholder/commission-only NUNCA conta — ver enum LinkSource.
 *
 * Usado em: checagem de link existente, bloqueio de duplicidade, dependência
 * entre casas, eligibility, backfill e schedulers.
 */
export const REAL_ACTIVE_LINK_WHERE = {
  deletedAt: null,
  source: { in: [LinkSource.POOL, LinkSource.MANUAL] },
} satisfies Prisma.AffiliateLinkWhereInput;

/** where para link real ativo numa casa específica de um usuário. */
export function realActiveLinkWhere(
  userId: string,
  bettingHouse: string,
): Prisma.AffiliateLinkWhereInput {
  return { userId, bettingHouse, ...REAL_ACTIVE_LINK_WHERE };
}

/** Predicado para uma linha já carregada (deletedAt + source). */
export function isRealActiveLinkRow(link: {
  deletedAt: Date | null;
  source: LinkSource;
}): boolean {
  return (
    link.deletedAt === null &&
    (link.source === LinkSource.POOL || link.source === LinkSource.MANUAL)
  );
}
