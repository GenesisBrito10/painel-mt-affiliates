import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import type Redis from 'ioredis';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../shared/shared.module.js';
import type { JwtPayload } from '../../domain/auth.types.js';

const USER_STATUS_CACHE_PREFIX = 'user:status:';
const USER_STATUS_CACHE_TTL = 60; // seconds

interface CachedUserStatus {
  status: UserStatus;
  active: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const cacheKey = `${USER_STATUS_CACHE_PREFIX}${payload.sub}`;

    // ── 1. Try Redis cache (hot path) ────────────────────────────────────────
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const { status, active } = JSON.parse(cached) as CachedUserStatus;
      if (status === UserStatus.BLOCKED || status === UserStatus.REJECTED || !active) {
        throw new UnauthorizedException('Conta inativa ou bloqueada.');
      }
      return payload;
    }

    // ── 2. Cache miss — hit DB (single indexed PK query ~0.5ms) ─────────────
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, active: true },
    });

    if (
      !user ||
      user.status === UserStatus.BLOCKED ||
      user.status === UserStatus.REJECTED ||
      !user.active
    ) {
      throw new UnauthorizedException('Conta inativa ou bloqueada.');
    }

    // ── 3. Populate cache for subsequent requests (fire-and-forget) ──────────
    // Non-critical: if Redis is unavailable, the DB fallback continues to work.
    this.redis
      .set(
        cacheKey,
        JSON.stringify({ status: user.status, active: user.active } satisfies CachedUserStatus),
        'EX',
        USER_STATUS_CACHE_TTL,
      )
      .catch(() => {
        // Intentionally silent — Redis cache is an optimization, not a requirement
      });

    return payload;
  }
}
