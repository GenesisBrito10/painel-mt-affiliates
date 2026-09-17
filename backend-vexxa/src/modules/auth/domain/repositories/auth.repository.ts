import type { UserRole, UserStatus } from '@prisma/client';

// Repository Port — defines what the application layer needs for auth.
// Implemented in infrastructure/persistence/auth.prisma-repository.ts
export const AUTH_REPOSITORY = Symbol('IAuthRepository');

/** Minimal user projection for login (avoids loading full User entity). */
export interface AuthUserView {
  id: string;
  email: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  active: boolean;
  isExternal: boolean;
}

/** Minimal projection for register response. */
export interface CreatedUserView {
  id: string;
  email: string;
  role: UserRole;
}

export interface IAuthRepository {
  findByEmail(email: string): Promise<AuthUserView | null>;
  findByReferralCode(code: string): Promise<{ id: string } | null>;
  findAdminIds(): Promise<string[]>;
  createUser(data: {
    name: string;
    email: string;
    password: string;
    referralCode: string;
    referredById?: string;
  }): Promise<CreatedUserView>;
}
