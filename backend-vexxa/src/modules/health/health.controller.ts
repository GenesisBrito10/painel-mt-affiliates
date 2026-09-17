import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service.js';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../shared/shared.module.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check API health' })
  check() {
    return { status: 'ok', service: 'vexxa-api' };
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — process is alive' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — DB and Redis reachable' })
  async ready() {
    const checks: Record<string, 'ok' | 'fail'> = { db: 'fail', redis: 'fail' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = 'ok';
    } catch {
      /* probe failed */
    }

    try {
      const pong = await this.redis.ping();
      if (pong === 'PONG') checks.redis = 'ok';
    } catch {
      /* probe failed */
    }

    const allOk = checks.db === 'ok' && checks.redis === 'ok';
    if (!allOk)
      throw new ServiceUnavailableException({ status: 'unavailable', checks });

    return { status: 'ok', checks };
  }
}
