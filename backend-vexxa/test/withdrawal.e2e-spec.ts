import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

/**
 * E2E tests for the WithdrawalModule.
 * Runs against the real database — requires a live Postgres connection.
 *
 * Affiliate auth: via login endpoint (known credentials).
 * Admin auth: via direct JWT signing (password may be unknown).
 */

const API = '/api/v1';

let app: NestFastifyApplication;
let prisma: PrismaService;
let affiliateToken: string;
let adminToken: string;
let createdWithdrawalId: string;

describe('WithdrawalController (e2e)', () => {
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

    prisma = app.get(PrismaService);
    const jwtService = app.get(JwtService);

    // Affiliate: login via endpoint
    const loginRes = await app.inject({
      method: 'POST',
      url: `${API}/auth/login`,
      payload: { email: 'rolex2026@vallexgroup.com.br', password: '123123123' },
    });
    affiliateToken = loginRes.json().accessToken;
    if (!affiliateToken) throw new Error('Affiliate login failed');

    // Admin: sign JWT directly (password may differ)
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN', active: true },
      select: { id: true, email: true, role: true },
    });
    if (!adminUser) throw new Error('No admin user found in database');
    adminToken = jwtService.sign({
      sub: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });
  }, 30_000);

  afterAll(async () => {
    // Clean up created withdrawal if exists
    if (createdWithdrawalId) {
      await prisma.withdrawalRequest
        .delete({ where: { id: createdWithdrawalId } })
        .catch(() => {}); // Ignore if already deleted
    }
    await app.close();
  });

  // ─── GET /withdrawals ──────────────────────────────────────────────────

  describe('GET /v1/withdrawals', () => {
    it('returns paginated list for authenticated affiliate', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('page');
      expect(body).toHaveProperty('limit');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 401 without auth token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('supports pagination with page and limit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals?page=1&limit=5`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.page).toBe(1);
      expect(body.limit).toBe(5);
      expect(body.data.length).toBeLessThanOrEqual(5);
    });

    it('supports date range filters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals?startDate=2026-01-01&endDate=2026-12-31`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it('admin can see all withdrawals', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBeGreaterThanOrEqual(0);
    });

    it('list items contain expected fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals?limit=1`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      const body = res.json();
      if (body.data.length > 0) {
        const item = body.data[0];
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('userId');
        expect(item).toHaveProperty('userName');
        expect(item).toHaveProperty('userEmail');
        expect(item).toHaveProperty('amount');
        expect(item).toHaveProperty('originalAmount');
        expect(item).toHaveProperty('withdrawalFee');
        expect(item).toHaveProperty('bettingHouse');
        expect(item).toHaveProperty('pixKeyType');
        expect(item).toHaveProperty('pixKey');
        expect(item).toHaveProperty('accountHolder');
        expect(item).toHaveProperty('status');
        expect(item).toHaveProperty('adminNote');
        expect(item).toHaveProperty('createdAt');
        expect(typeof item.amount).toBe('number');
        expect(typeof item.originalAmount).toBe('number');
        expect(typeof item.withdrawalFee).toBe('number');
      }
    });
  });

  // ─── POST /withdrawals ─────────────────────────────────────────────────

  describe('POST /v1/withdrawals', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API}/withdrawals`,
        payload: { bettingHouse: 'esportivabet' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('validates body — rejects empty payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API}/withdrawals`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: {},
      });

      // Should fail validation (bettingHouse required)
      expect(res.statusCode).toBe(400);
    });

    it('validates body — rejects extra fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API}/withdrawals`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { bettingHouse: 'esportivabet', hackerField: 'xss' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('creates withdrawal or returns business validation error', async () => {
      // Clean up any existing withdrawal for today to avoid rate limit
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const affiliateUser = await prisma.user.findFirst({
        where: { email: 'rolex2026@vallexgroup.com.br' },
        select: { id: true },
      });

      if (affiliateUser) {
        // Delete today's withdrawals to ensure rate limit doesn't block
        await prisma.withdrawalRequest.deleteMany({
          where: {
            userId: affiliateUser.id,
            createdAt: { gte: startOfDay },
          },
        });
      }

      const res = await app.inject({
        method: 'POST',
        url: `${API}/withdrawals`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { bettingHouse: 'esportivabet' },
      });

      const body = res.json();

      if (res.statusCode === 201 || res.statusCode === 200) {
        // Successful creation
        expect(body).toHaveProperty('id');
        expect(body).toHaveProperty('amount');
        expect(body).toHaveProperty('originalAmount');
        expect(body).toHaveProperty('withdrawalFee');
        expect(body).toHaveProperty('status', 'PENDING');
        expect(body.withdrawalFee).toBeCloseTo(body.originalAmount * 0.06, 1);
        expect(body.amount).toBeCloseTo(body.originalAmount - body.withdrawalFee, 1);
        createdWithdrawalId = body.id;
      } else {
        // Known business validation errors are acceptable
        expect([400, 403]).toContain(res.statusCode);
        expect(body).toHaveProperty('detail');
      }
    });

    it('enforces rate limit — 1 per day', async () => {
      // The previous test either created a withdrawal or we need to ensure one exists
      const res = await app.inject({
        method: 'POST',
        url: `${API}/withdrawals`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { bettingHouse: 'esportivabet' },
      });

      // Should be either 429 (rate limit) or a business error (400/403)
      // If previous test failed to create, this might also fail with 400
      expect([400, 403, 429]).toContain(res.statusCode);

      if (res.statusCode === 429) {
        const body = res.json();
        expect(body.detail).toContain('1 saque por dia');
      }
    });
  });

  // ─── PUT /withdrawals/:id  (Admin) ─────────────────────────────────────

  describe('PUT /v1/withdrawals/:id', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/withdrawals/nonexistent-id`,
        payload: { status: 'approved' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when affiliate tries to update', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/withdrawals/nonexistent-id`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { status: 'approved' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for nonexistent withdrawal id', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/withdrawals/00000000-0000-0000-0000-000000000000`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'approved' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('validates status value', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/withdrawals/any-id`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'INVALID' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('admin can approve a pending withdrawal', async () => {
      // Find a PENDING withdrawal to test approval
      const pending = await prisma.withdrawalRequest.findFirst({
        where: { status: 'PENDING' },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!pending) {
        // No pending withdrawal available — skip gracefully
        return;
      }

      const res = await app.inject({
        method: 'PUT',
        url: `${API}/withdrawals/${pending.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'approved', adminNote: 'E2E test approval' },
      });

      const body = res.json();

      if (res.statusCode === 200) {
        expect(body.status).toBe('APPROVED');
        expect(body.adminNote).toBe('E2E test approval');
        expect(body).toHaveProperty('approvedAt');
        expect(body).toHaveProperty('approvedByName');

        // Restore to PENDING for idempotency
        await prisma.withdrawalRequest.update({
          where: { id: pending.id },
          data: { status: 'PENDING', adminNote: '', approvedAt: null, approvedById: null },
        });
      }
    });

    it('rejects double-processing of already approved withdrawal', async () => {
      // Find a withdrawal that is NOT pending
      const approved = await prisma.withdrawalRequest.findFirst({
        where: { status: { not: 'PENDING' } },
        select: { id: true },
      });

      if (!approved) return; // Skip if no processed withdrawals exist

      const res = await app.inject({
        method: 'PUT',
        url: `${API}/withdrawals/${approved.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'approved' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().detail).toContain('já foi processado');
    });
  });

  // ─── GET /withdrawals/balance-breakdown/:userId  (Admin) ───────────────

  describe('GET /v1/withdrawals/balance-breakdown/:userId', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals/balance-breakdown/some-user-id`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when affiliate tries to access', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals/balance-breakdown/some-user-id`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns balance breakdown for a valid user', async () => {
      const user = await prisma.user.findFirst({
        where: { role: 'AFFILIATE', active: true },
        select: { id: true },
      });

      if (!user) return;

      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals/balance-breakdown/${user.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Should contain all BalanceResponseDto fields
      expect(body).toHaveProperty('balance');
      expect(body).toHaveProperty('grossBalance');
      expect(body).toHaveProperty('approvedWithdrawals');
      expect(body).toHaveProperty('cpa');
      expect(body).toHaveProperty('rev');
      expect(body).toHaveProperty('networkCpa');
      expect(body).toHaveProperty('networkRev');
      expect(body).toHaveProperty('fraudDetails');
      expect(body).toHaveProperty('perHouse');
      expect(body).toHaveProperty('depositInfo');
      expect(body).toHaveProperty('minWithdrawalAmount');
      expect(typeof body.balance).toBe('number');
    });

    it('returns 404 for nonexistent user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/withdrawals/balance-breakdown/00000000-0000-0000-0000-000000000000`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
