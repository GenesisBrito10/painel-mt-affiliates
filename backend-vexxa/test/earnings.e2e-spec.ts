import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

const API = '/api/v1';

let app: NestFastifyApplication;
let affiliateToken: string;

describe('EarningsController (e2e)', () => {
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );

    app.setGlobalPrefix('api', { exclude: ['/health'] });
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const prisma = app.get(PrismaService);
    const jwtService = app.get(JwtService);

    const user = await prisma.user.findFirst({
      where: { email: 'rolex2026@vallexgroup.com.br' },
      select: { id: true, email: true, role: true },
    });

    if (!user) throw new Error('Test user not found');
    
    affiliateToken = jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/earnings/overview', () => {
    it('returns earnings overview for authenticated affiliate', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/earnings/overview`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('availableBalance');
      expect(body).toHaveProperty('formula');
      expect(body.formula).toHaveProperty('grossTotal');
      expect(body.formula).toHaveProperty('withdrawalsPending');
      expect(body.formula).toHaveProperty('netBalance');
    });

    it('returns 401 without auth token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/earnings/overview`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /v1/earnings/network', () => {
    it('returns network breakdown', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/earnings/network`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('totalNetworkEarnings');
      expect(body).toHaveProperty('totalMembers');
      expect(body).toHaveProperty('members');
      expect(Array.isArray(body.members)).toBe(true);
    });
  });

  describe('GET /v1/earnings/ledger', () => {
    it('returns paginated ledger entries', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/earnings/ledger?page=1&limit=10`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('periodSummary');
      expect(body.periodSummary).toHaveProperty('netChange');
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('GET /v1/earnings/ledger/export', () => {
    it('returns CSV stream', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/earnings/ledger/export`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(typeof res.payload).toBe('string');
      expect(res.payload).toContain('ID,Date,Type,Label,Amount');
    });
  });
});
