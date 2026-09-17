import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ApiAccessGuard } from './api-access.guard.js';

function ctx(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function makeGuard(apiAccessEnabled: boolean | null) {
  const prisma = {
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          apiAccessEnabled === null ? null : { apiAccessEnabled },
        ),
    },
  };
  return { guard: new ApiAccessGuard(prisma as never), prisma };
}

describe('ApiAccessGuard', () => {
  it('allows admin without touching the DB', async () => {
    const { guard, prisma } = makeGuard(false);
    await expect(
      guard.canActivate(ctx({ sub: 'a', role: UserRole.ADMIN })),
    ).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows an affiliate with apiAccessEnabled', async () => {
    const { guard } = makeGuard(true);
    await expect(
      guard.canActivate(ctx({ sub: 'b', role: UserRole.AFFILIATE })),
    ).resolves.toBe(true);
  });

  it('rejects an affiliate without access — "Você não tem permissão"', async () => {
    const { guard } = makeGuard(false);
    await expect(
      guard.canActivate(ctx({ sub: 'c', role: UserRole.AFFILIATE })),
    ).rejects.toThrow('Você não tem permissão');
    await expect(
      guard.canActivate(ctx({ sub: 'c', role: UserRole.AFFILIATE })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when there is no authenticated user', async () => {
    const { guard } = makeGuard(true);
    await expect(guard.canActivate(ctx(undefined))).rejects.toThrow(
      'Você não tem permissão',
    );
  });
});
