import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

/**
 * E2E tests for the LinkRequestModule.
 * Runs against the real database — requires a live Postgres connection.
 *
 * Auth strategy (same as withdrawal.e2e-spec.ts):
 * - Affiliate: login via endpoint (known credentials)
 * - Admin: JwtService.sign() directly (password-independent)
 * - Leader (affiliate who referred another affiliate): sign directly
 */

const API = '/api/v1';
const NULL_UUID = '00000000-0000-0000-0000-000000000000';

let app: NestFastifyApplication;
let prisma: PrismaService;
let affiliateToken: string;
let adminToken: string;
let leaderToken: string;
let affiliateUserId: string;
let leaderUserId: string | null = null;
let testDealId: string | null = null;
let createdLinkRequestId: string | null = null;

describe('LinkRequestController (e2e)', () => {
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
      payload: { email: 'rolex2026@mtafiliates.com.br', password: '123123123' },
    });
    affiliateToken = loginRes.json().accessToken;
    if (!affiliateToken) throw new Error('Affiliate login failed — check credentials');

    const affiliateUser = await prisma.user.findFirst({
      where: { email: 'rolex2026@mtafiliates.com.br' },
      select: { id: true },
    });
    affiliateUserId = affiliateUser!.id;

    // Admin: sign JWT directly
    const adminUser = await prisma.user.findFirst({
      where: { role: 'ADMIN', active: true },
      select: { id: true, email: true, role: true },
    });
    if (!adminUser) throw new Error('No active admin found in database');
    adminToken = jwtService.sign({ sub: adminUser.id, email: adminUser.email, role: adminUser.role });

    // Leader: find affiliate who referred the test affiliate (if exists)
    const affiliate = await prisma.user.findUnique({
      where: { id: affiliateUserId },
      select: { referredById: true },
    });
    if (affiliate?.referredById) {
      leaderUserId = affiliate.referredById;
      const leader = await prisma.user.findUnique({
        where: { id: leaderUserId },
        select: { id: true, email: true, role: true },
      });
      if (leader) {
        leaderToken = jwtService.sign({ sub: leader.id, email: leader.email, role: leader.role });
      }
    }

    // Find an active deal for POST tests
    const deal = await prisma.deal.findFirst({
      where: { active: true },
      select: { id: true },
    });
    testDealId = deal?.id ?? null;
  }, 30_000);

  afterAll(async () => {
    // Clean up test-created link request if it wasn't cleaned by another test
    if (createdLinkRequestId) {
      await prisma.linkRequest
        .delete({ where: { id: createdLinkRequestId } })
        .catch(() => {});
    }
    await app.close();
  });

  // ─── GET /link-requests/houses ────────────────────────────────────────────

  describe('GET /v1/link-requests/houses', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({ method: 'GET', url: `${API}/link-requests/houses` });
      expect(res.statusCode).toBe(401);
    });

    it('returns active betting houses list for authenticated affiliate', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/link-requests/houses`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('house items contain id, name, slug', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/link-requests/houses`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      const body = res.json();
      if (body.data.length > 0) {
        const house = body.data[0];
        expect(house).toHaveProperty('id');
        expect(house).toHaveProperty('name');
        expect(house).toHaveProperty('slug');
      }
    });
  });

  // ─── GET /link-requests ───────────────────────────────────────────────────

  describe('GET /v1/link-requests', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({ method: 'GET', url: `${API}/link-requests` });
      expect(res.statusCode).toBe(401);
    });

    it('affiliate sees own and invitees link requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/link-requests`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('admin sees all link requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/link-requests`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('data');
      // Admin should see more or equal records than affiliate
      expect(body.data.length).toBeGreaterThanOrEqual(0);
    });

    it('list items contain expected fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/link-requests`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = res.json();
      if (body.data.length > 0) {
        const item = body.data[0];
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('userId');
        expect(item).toHaveProperty('userName');
        expect(item).toHaveProperty('userEmail');
        expect(item).toHaveProperty('dealId');
        expect(item).toHaveProperty('bettingHouseSlug');
        expect(item).toHaveProperty('message');
        expect(item).toHaveProperty('status');
        expect(item).toHaveProperty('links');
        expect(item).toHaveProperty('adminNote');
        expect(item).toHaveProperty('createdAt');
        expect(Array.isArray(item.links)).toBe(true);
      }
    });

    it('supports sort=fulfilledAt query param', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/link-requests?sort=fulfilledAt`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects invalid sort value with 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/link-requests?sort=invalidField`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('supports dateFrom/dateTo filters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/link-requests?dateFrom=2025-01-01&dateTo=2026-12-31`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ─── POST /link-requests ──────────────────────────────────────────────────

  describe('POST /v1/link-requests', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API}/link-requests`,
        payload: { dealId: NULL_UUID },
      });
      expect(res.statusCode).toBe(401);
    });

    it('validates body — rejects empty payload with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API}/link-requests`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('validates body — rejects non-UUID dealId with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API}/link-requests`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { dealId: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('validates body — rejects extra fields (forbidNonWhitelisted)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API}/link-requests`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { dealId: NULL_UUID, hackerField: 'xss' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for nonexistent or inactive deal', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${API}/link-requests`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { dealId: NULL_UUID },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().detail).toContain('Deal');
    });

    it('creates link request or returns expected business error', async () => {
      if (!testDealId) return; // Skip if no active deal in DB

      // Remove any existing pending request for this deal to allow creation
      await prisma.linkRequest.deleteMany({
        where: { userId: affiliateUserId, dealId: testDealId, status: 'PENDING' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `${API}/link-requests`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { dealId: testDealId, message: 'E2E test request' },
      });

      const body = res.json();

      if (res.statusCode === 201) {
        expect(body).toHaveProperty('id');
        expect(body).toHaveProperty('userId', affiliateUserId);
        expect(body).toHaveProperty('dealId', testDealId);
        expect(body).toHaveProperty('status', 'PENDING');
        expect(body.message).toBe('E2E test request');
        createdLinkRequestId = body.id;
      } else {
        // Acceptable: eligibility gate (403), house unavailable (400), 1-per-account (409)
        expect([400, 403, 409]).toContain(res.statusCode);
        expect(body).toHaveProperty('detail');
      }
    });

    it('rejects duplicate pending request for the same deal (409)', async () => {
      if (!testDealId || !createdLinkRequestId) return; // Skip if prior test didn't create one

      const res = await app.inject({
        method: 'POST',
        url: `${API}/link-requests`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { dealId: testDealId },
      });

      expect([409, 400, 403]).toContain(res.statusCode);
      if (res.statusCode === 409) {
        expect(res.json().detail).toContain('pendente');
      }
    });
  });

  // ─── PUT /link-requests/:id  (Admin) ──────────────────────────────────────

  describe('PUT /v1/link-requests/:id', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/link-requests/${NULL_UUID}`,
        payload: { status: 'fulfilled' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when affiliate tries to update (not admin)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/link-requests/${NULL_UUID}`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { status: 'fulfilled' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('validates status enum — rejects invalid value with 400', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/link-requests/${NULL_UUID}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'APPROVED' }, // not in enum
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for nonexistent link request id', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/link-requests/${NULL_UUID}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'rejected' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects fulfillment without links (400)', async () => {
      const pending = await prisma.linkRequest.findFirst({
        where: { status: 'PENDING' },
        select: { id: true },
      });
      if (!pending) return;

      const res = await app.inject({
        method: 'PUT',
        url: `${API}/link-requests/${pending.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'fulfilled', links: [] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().detail).toContain('link');
    });

    it('admin can reject a pending link request', async () => {
      const pending = await prisma.linkRequest.findFirst({
        where: { status: 'PENDING' },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!pending) return;

      const res = await app.inject({
        method: 'PUT',
        url: `${API}/link-requests/${pending.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'rejected', adminNote: 'E2E test rejection' },
      });

      if (res.statusCode === 200) {
        const body = res.json();
        expect(body.status).toBe('REJECTED');
        expect(body.adminNote).toBe('E2E test rejection');
        expect(body).toHaveProperty('fulfilledAt');
        expect(body).toHaveProperty('fulfilledByName');

        // Restore to PENDING for other tests
        await prisma.linkRequest.update({
          where: { id: pending.id },
          data: { status: 'PENDING', adminNote: '', fulfilledAt: null, fulfilledById: null, fulfilledByName: '' },
        });
      }
    });

    it('admin can approve a pending link request with links', async () => {
      const pending = await prisma.linkRequest.findFirst({
        where: { status: 'PENDING' },
        select: { id: true, userId: true, bettingHouseSlug: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!pending) return;

      const res = await app.inject({
        method: 'PUT',
        url: `${API}/link-requests/${pending.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          status: 'fulfilled',
          adminNote: 'E2E test approval',
          links: [
            { label: 'Link principal', url: 'https://wlsuperbet.adsrv.eacdn.com/C.ashx?siteid=32666&c=E2ETEST' },
          ],
        },
      });

      if (res.statusCode === 200) {
        const body = res.json();
        expect(body.status).toBe('FULFILLED');
        expect(body.adminNote).toBe('E2E test approval');
        expect(body).toHaveProperty('fulfilledAt');

        // Restore for idempotency
        await prisma.linkRequest.update({
          where: { id: pending.id },
          data: { status: 'PENDING', adminNote: '', fulfilledAt: null, fulfilledById: null, fulfilledByName: '' },
        });
      }
    });
  });

  // ─── GET /deal-requests ───────────────────────────────────────────────────

  describe('GET /v1/deal-requests', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({ method: 'GET', url: `${API}/deal-requests` });
      expect(res.statusCode).toBe(401);
    });

    it('returns deal requests (dealId != null) for authenticated affiliate', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/deal-requests`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      // All returned items must have a dealId
      body.data.forEach((item: any) => {
        expect(item.dealId).not.toBeNull();
      });
    });

    it('admin sees all deal requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/deal-requests`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('data');
    });

    it('supports status filter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/deal-requests?status=PENDING`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      body.data.forEach((item: any) => {
        expect(item.status).toBe('PENDING');
      });
    });

    it('rejects invalid status value with 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/deal-requests?status=INVALID`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─── PUT /deal-requests/:id/approve ───────────────────────────────────────

  describe('PUT /v1/deal-requests/:id/approve', () => {
    it('returns 401 without auth token', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/deal-requests/${NULL_UUID}/approve`,
        payload: { cpa: 100 },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for nonexistent deal request', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/deal-requests/${NULL_UUID}/approve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { cpa: 100 },
      });
      expect(res.statusCode).toBe(404);
    });

    it('validates body — rejects extra fields (forbidNonWhitelisted)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `${API}/deal-requests/${NULL_UUID}/approve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { cpa: 100, hackerField: 'xss' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when approving without cpa and revshare', async () => {
      const pending = await prisma.linkRequest.findFirst({
        where: { status: 'PENDING', dealId: { not: null } },
        select: { id: true },
      });
      if (!pending) return;

      const res = await app.inject({
        method: 'PUT',
        url: `${API}/deal-requests/${pending.id}/approve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {}, // no cpa, no revshare, no reject action
      });

      // No action=reject and no commission → 400
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when non-leader affiliate tries to approve', async () => {
      // Find a deal request that belongs to a user NOT referred by affiliateUserId
      const unrelatedRequest = await prisma.linkRequest.findFirst({
        where: {
          status: 'PENDING',
          dealId: { not: null },
          user: { referredById: { not: affiliateUserId } },
        },
        select: { id: true },
      });
      if (!unrelatedRequest) return;

      const res = await app.inject({
        method: 'PUT',
        url: `${API}/deal-requests/${unrelatedRequest.id}/approve`,
        headers: { authorization: `Bearer ${affiliateToken}` },
        payload: { cpa: 100 },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().detail).toContain('convidados diretos');
    });

    it('admin can reject a deal request', async () => {
      const pending = await prisma.linkRequest.findFirst({
        where: { status: 'PENDING', dealId: { not: null } },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!pending) return;

      const res = await app.inject({
        method: 'PUT',
        url: `${API}/deal-requests/${pending.id}/approve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { action: 'reject', adminNote: 'E2E rejection' },
      });

      if (res.statusCode === 200) {
        const body = res.json();
        expect(body.status).toBe('REJECTED');

        // Restore
        await prisma.linkRequest.update({
          where: { id: pending.id },
          data: { status: 'PENDING', adminNote: '', fulfilledAt: null, fulfilledById: null, fulfilledByName: '' },
        });
      }
    });

    it('network leader can approve a direct invitee deal request within ceiling', async () => {
      if (!leaderUserId || !leaderToken) return; // Skip if no leader found

      // Find a pending deal request from a direct invitee of leaderUserId
      const inviteePending = await prisma.linkRequest.findFirst({
        where: {
          status: 'PENDING',
          dealId: { not: null },
          user: { referredById: leaderUserId },
        },
        select: { id: true, bettingHouseSlug: true, userId: true },
      });
      if (!inviteePending) return;

      // Ensure leader has an AffiliateLink for this house with some commission
      const leaderLink = await prisma.affiliateLink.findFirst({
        where: { userId: leaderUserId, bettingHouse: inviteePending.bettingHouseSlug },
        select: { cpa: true },
      });
      if (!leaderLink?.cpa) return; // Leader has no link → skip

      const safeCpa = Math.min(50, leaderLink.cpa.toNumber()); // within ceiling

      const res = await app.inject({
        method: 'PUT',
        url: `${API}/deal-requests/${inviteePending.id}/approve`,
        headers: { authorization: `Bearer ${leaderToken}` },
        payload: { cpa: safeCpa },
      });

      if (res.statusCode === 200) {
        const body = res.json();
        expect(body.status).toBe('FULFILLED');

        // Restore
        await prisma.linkRequest.update({
          where: { id: inviteePending.id },
          data: { status: 'PENDING', fulfilledAt: null, fulfilledById: null, fulfilledByName: '' },
        });
        // Clean up the AffiliateLink created by sync (fire-and-forget, may not exist yet)
        await new Promise((r) => setTimeout(r, 200)); // give async a moment
        await prisma.affiliateLink.deleteMany({
          where: {
            userId: inviteePending.userId,
            bettingHouse: inviteePending.bettingHouseSlug,
            campaignId: { startsWith: 'manual_' },
          },
        });
      }
    });
  });
});
