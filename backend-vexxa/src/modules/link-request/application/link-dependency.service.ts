import { Injectable } from '@nestjs/common';
import { type HouseLinkRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DEAL_ELIGIBILITY_METRICS_SLUG } from '../domain/types/link-request.types.js';
import { REAL_ACTIVE_LINK_WHERE } from './link-active.util.js';
import { type DependencyCheck } from '../domain/types/house-link-rule.types.js';

/**
 * Dependência genérica entre casas. Superbet nunca é exigida como pré-requisito.
 * Quando requireActiveLinkInHouses está ativo, o usuário precisa ter link REAL
 * ativo (POOL/MANUAL) em TODAS as casas exigidas (exceto Superbet).
 */
@Injectable()
export class LinkDependencyService {
  constructor(private readonly prisma: PrismaService) {}

  async checkRequiredLinks(
    userId: string,
    rule: Pick<
      HouseLinkRule,
      'requireActiveLinkInHouses' | 'requiredHouseSlugs'
    >,
  ): Promise<DependencyCheck> {
    const required = rule.requireActiveLinkInHouses
      ? [
          ...new Set(
            rule.requiredHouseSlugs.filter(
              (slug) => slug.toLowerCase() !== DEAL_ELIGIBILITY_METRICS_SLUG,
            ),
          ),
        ]
      : [];

    if (required.length === 0) {
      return { ok: true, requiredHouses: [], missingHouses: [] };
    }

    const links = await this.prisma.affiliateLink.findMany({
      where: {
        userId,
        bettingHouse: { in: required },
        ...REAL_ACTIVE_LINK_WHERE,
      },
      select: { bettingHouse: true },
    });

    const have = new Set(links.map((l) => l.bettingHouse));
    const missingHouses = required.filter((slug) => !have.has(slug));

    return {
      ok: missingHouses.length === 0,
      requiredHouses: required,
      missingHouses,
    };
  }
}
