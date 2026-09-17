import type {
  ProviderAccount,
  ProviderAccountHouse,
  BettingHouse,
} from '@prisma/client';

export type AccountWithHouses = ProviderAccount & {
  houses: (ProviderAccountHouse & { bettingHouse: BettingHouse })[];
};

export interface DecryptedAccountCredentials {
  email: string;
  password: string;
  apiBaseUrl: string;
}

export const SUPPORTED_PROVIDERS = ['betboard', 'smartico', 'otg'] as const;
export type ProviderSlug = (typeof SUPPORTED_PROVIDERS)[number];
