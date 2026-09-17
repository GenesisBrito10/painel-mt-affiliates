import { Injectable } from '@nestjs/common';
import { buildUserSearchWhere } from '../../../../common/pagination/index.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type {
  IUserRepository,
  UserFilters,
  PaginatedUsers,
} from '../../domain/repositories/user.repository.js';
import type { User, AffiliateLink } from '@prisma/client';

@Injectable()
export class UserPrismaRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id, deletedAt: null } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findAll(filters: UserFilters): Promise<PaginatedUsers> {
    const limit = filters.limit ?? 20;

    const searchWhere = filters.search
      ? buildUserSearchWhere(filters.search)
      : null;

    // whereBase excludes cursor so count reflects total matching users, not
    // just those after the cursor position.
    const whereBase = {
      deletedAt: null,
      ...(filters.role && { role: filters.role }),
      ...(filters.status && { status: filters.status }),
      ...(searchWhere ?? {}),
    };

    const where = {
      ...whereBase,
      ...(filters.cursor && { id: { gt: filters.cursor } }),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
      }),
      this.prisma.user.count({ where: whereBase }),
    ]);

    const hasNextPage = users.length > limit;
    const data = hasNextPage ? users.slice(0, limit) : users;
    const nextCursor = hasNextPage ? (data[data.length - 1]?.id ?? null) : null;

    return { data, total, nextCursor };
  }

  async update(
    id: string,
    data: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async findAffiliateLinksByUser(userId: string): Promise<AffiliateLink[]> {
    return this.prisma.affiliateLink.findMany({
      where: { userId, deletedAt: null },
      orderBy: { bettingHouse: 'asc' },
    });
  }

  async findAffiliateLinkById(linkId: string): Promise<AffiliateLink | null> {
    return this.prisma.affiliateLink.findFirst({
      where: { id: linkId, deletedAt: null },
    });
  }

  async findAffiliateLinkByUniqueKey(
    campaignId: string,
    bettingHouse: string,
  ): Promise<AffiliateLink | null> {
    // uniqueness agora é índice PARCIAL (só ativos) — findUnique por
    // uq_campaign_house não existe mais; busca o link ATIVO do par.
    return this.prisma.affiliateLink.findFirst({
      where: { campaignId, bettingHouse, deletedAt: null },
    });
  }

  async createAffiliateLink(data: {
    userId: string;
    bettingHouse: string;
    campaignId: string;
    affiliateId: string;
    cpa?: string | null;
    revshare?: string | null;
    userLink?: string | null;
  }): Promise<AffiliateLink> {
    return this.prisma.affiliateLink.create({ data });
  }

  async updateAffiliateLink(
    linkId: string,
    data: {
      affiliateId?: string;
      cpa?: string | null;
      revshare?: string | null;
      userLink?: string | null;
    },
  ): Promise<AffiliateLink> {
    return this.prisma.affiliateLink.update({ where: { id: linkId }, data });
  }

  async deleteAffiliateLink(linkId: string): Promise<void> {
    // SOFT-DELETE: nunca hard-delete (preserva campaignId/link/cpa). Hard-delete
    // é bloqueado pela extensão Prisma. O índice parcial libera o par p/ reuso.
    await this.prisma.affiliateLink.update({
      where: { id: linkId },
      data: { deletedAt: new Date() },
    });
  }

  async findFraudCount(userId: string, bettingHouse: string): Promise<number> {
    const fc = await this.prisma.fraudCount.findUnique({
      where: { userId_bettingHouse: { userId, bettingHouse } },
    });
    return fc?.count ?? 0;
  }

  async createAuditLog(data: {
    userId: string;
    userName: string;
    userEmail: string;
    action: string;
    resource: string;
    method: string;
    path: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { ...data, details: data.details as any },
    });
  }

  async bettingHouseExists(slug: string): Promise<boolean> {
    const house = await this.prisma.bettingHouse.findUnique({
      where: { slug },
    });
    return house !== null;
  }

  async updateStatusWithAudit(params: {
    targetUserId: string;
    status: import('@prisma/client').UserStatus;
    auditLog: {
      userId: string;
      userName: string;
      userEmail: string;
      details: Record<string, unknown>;
    };
  }): Promise<import('@prisma/client').User> {
    const { targetUserId, status, auditLog } = params;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { status },
      });
      await tx.auditLog.create({
        data: {
          userId: auditLog.userId,
          userName: auditLog.userName,
          userEmail: auditLog.userEmail,
          action: 'UPDATE_STATUS',
          resource: 'users',
          method: 'PATCH',
          path: `/admin/users/${targetUserId}/status`,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          details: auditLog.details as any,
        },
      });
      return updated;
    });
  }
}
