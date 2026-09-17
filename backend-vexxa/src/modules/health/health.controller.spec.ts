import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../shared/shared.module.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: async () => [{ 1: 1 }] } },
        { provide: REDIS_CLIENT, useValue: { ping: async () => 'PONG' } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return health status', () => {
    expect(controller.check()).toEqual({ status: 'ok', service: 'vexxa-api' });
  });
});
