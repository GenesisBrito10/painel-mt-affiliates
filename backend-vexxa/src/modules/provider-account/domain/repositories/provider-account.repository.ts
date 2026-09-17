import type { ProviderAccount } from '@prisma/client';
import type { AccountWithHouses } from '../types/provider-account.types.js';

// Repository Port — interface pura definida no domain.
export const PROVIDER_ACCOUNT_REPOSITORY = Symbol('IProviderAccountRepository');

export interface IProviderAccountRepository {
  findByNameAndProvider(name: string, provider: string): Promise<ProviderAccount | null>;
  findById(id: string): Promise<AccountWithHouses | null>;
  findAll(): Promise<AccountWithHouses[]>;
  findByHouseSlug(slug: string): Promise<AccountWithHouses[]>;
  create(data: {
    name: string;
    provider: string;
    apiBaseUrl: string;
    email: string;          // plaintext — not a secret
    encryptedPassword: string;
    houses?: { bettingHouseSlug: string; bookmarkerId: string; extraConfig: object }[];
  }): Promise<AccountWithHouses>;
  update(id: string, data: {
    name?: string;
    apiBaseUrl?: string;
    active?: boolean;
    email?: string;         // plaintext
    encryptedPassword?: string;
  }): Promise<AccountWithHouses>;
  delete(id: string): Promise<void>;

  // House association management
  findHouseAssociation(providerAccountId: string, bettingHouseSlug: string): Promise<{ id: string } | null>;
  addHouse(providerAccountId: string, data: {
    bettingHouseSlug: string;
    bookmarkerId: string;
    extraConfig: object;
  }): Promise<void>;
  removeHouse(houseAssociationId: string): Promise<void>;
  bettingHouseExists(slug: string): Promise<boolean>;

  // SyncModule usage
  findByIdRaw(id: string): Promise<ProviderAccount | null>;
  markUsed(id: string, error?: string): Promise<void>;
}
