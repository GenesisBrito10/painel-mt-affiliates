import type { User, AffiliateLink, UserStatus } from '@prisma/client';

// Repository Port — interface pura definida no domain, implementada na infrastructure.
export const USER_REPOSITORY = Symbol('IUserRepository');

export interface UserFilters {
  role?: User['role'];
  status?: UserStatus;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface PaginatedUsers {
  data: User[];
  total: number;
  nextCursor: string | null;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(filters: UserFilters): Promise<PaginatedUsers>;
  update(
    id: string,
    data: Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<User>;

  // AffiliateLink aggregate methods (User owns this sub-aggregate)
  findAffiliateLinksByUser(userId: string): Promise<AffiliateLink[]>;
  findAffiliateLinkById(linkId: string): Promise<AffiliateLink | null>;
  findAffiliateLinkByUniqueKey(
    campaignId: string,
    bettingHouse: string,
  ): Promise<AffiliateLink | null>;
  createAffiliateLink(data: {
    userId: string;
    bettingHouse: string;
    campaignId: string;
    affiliateId: string;
    cpa?: string | null;
    revshare?: string | null;
    userLink?: string | null;
  }): Promise<AffiliateLink>;
  updateAffiliateLink(
    linkId: string,
    data: {
      affiliateId?: string;
      cpa?: string | null;
      revshare?: string | null;
      userLink?: string | null;
    },
  ): Promise<AffiliateLink>;
  deleteAffiliateLink(linkId: string): Promise<void>;

  // Cross-module read (for CommissionModule, Phase 2)
  findFraudCount(userId: string, bettingHouse: string): Promise<number>;

  // Audit log write (updateStatus use-case)
  createAuditLog(data: {
    userId: string;
    userName: string;
    userEmail: string;
    action: string;
    resource: string;
    method: string;
    path: string;
    details: Record<string, unknown>;
  }): Promise<void>;

  // M03: atomic status change + audit — prevents status update without audit record
  updateStatusWithAudit(params: {
    targetUserId: string;
    status: import('@prisma/client').UserStatus;
    auditLog: {
      userId: string;
      userName: string;
      userEmail: string;
      details: Record<string, unknown>;
    };
  }): Promise<import('@prisma/client').User>;

  // BettingHouse validation
  bettingHouseExists(slug: string): Promise<boolean>;
}
