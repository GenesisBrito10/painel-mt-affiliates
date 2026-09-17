import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';

const API = '/api/v1';

describe('Admin affiliate endpoints (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let adminToken: string;
  let affiliateToken: string;
  let adminId: string;
  let affiliateId: string;

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
    jwtService = app.get(JwtService);

    const suffix = Date.now().toString(36);
    const password = await bcrypt.hash('StrongPass@123', 4);

    const admin = await prisma.user.findFirst({
      where: { role: UserRole.ADMIN, active: true },
      select: { id: true, email: true, role: true },
    });
    if (!admin) throw new Error('No active admin found in database');

    const affiliate = await prisma.user.create({
      data: {
        name: 'Afiliado E2E',
        email: `affiliate-e2e-${suffix}@vexxa.test`,
        password,
        role: UserRole.AFFILIATE,
        status: UserStatus.APPROVED,
        active: true,
        cpf: `1000000${suffix.slice(-4).padStart(4, '0')}`.slice(0, 11),
        whatsapp: '+5511999990000',
        pixKeyType: 'cpf',
        pixKey: `1000000${suffix.slice(-4).padStart(4, '0')}`.slice(0, 11),
        accountHolder: 'Afiliado E2E',
        profileCompleted: true,
      },
      select: { id: true, email: true, role: true },
    });

    adminId = admin.id;
    affiliateId = affiliate.id;
    adminToken = jwtService.sign({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
    });
    affiliateToken = jwtService.sign({
      sub: affiliate.id,
      email: affiliate.email,
      role: affiliate.role,
    });
  }, 30_000);

  afterAll(async () => {
    // Audit logs are append-only in production-like databases, so only ephemeral
    // rows without audit FK implications are removed here.
    await prisma.notification.deleteMany({
      where: { userId: affiliateId },
    });
    if (affiliateId) {
      await prisma.user.delete({ where: { id: affiliateId } }).catch(() => {});
    }
    await app.close();
  });

  it('allows admin to view full affiliate profile and audits sensitive access', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API}/admin/affiliates/${affiliateId}/profile`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: affiliateId,
      email: expect.stringContaining('affiliate-e2e-'),
      cpf: expect.any(String),
      whatsapp: '+5511999990000',
    });
    expect(body.cpf).toHaveLength(11);

    const audit = await prisma.auditLog.findFirst({
      where: {
        userId: adminId,
        action: 'VIEW_AFFILIATE_SENSITIVE_PROFILE',
      },
    });
    expect(audit).toBeTruthy();
  });

  it('blocks and unblocks one affiliate balance', async () => {
    const block = await app.inject({
      method: 'PATCH',
      url: `${API}/admin/affiliates/${affiliateId}/balance-block`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { blocked: true, reason: 'E2E compliance check' },
    });
    expect(block.statusCode).toBe(200);
    expect(block.json()).toMatchObject({ withdrawalBlocked: true });

    const unblock = await app.inject({
      method: 'PATCH',
      url: `${API}/admin/affiliates/${affiliateId}/balance-block`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { blocked: false, reason: 'E2E released' },
    });
    expect(unblock.statusCode).toBe(200);
    expect(unblock.json()).toMatchObject({ withdrawalBlocked: false });
  });

  it('allows admin to access read-only dashboard mirror and network', async () => {
    const summary = await app.inject({
      method: 'GET',
      url: `${API}/admin/affiliates/${affiliateId}/dashboard/summary`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(summary.statusCode).toBe(200);

    const network = await app.inject({
      method: 'GET',
      url: `${API}/admin/affiliates/${affiliateId}/network`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(network.statusCode).toBe(200);
  });

  it('denies admin affiliate profile access to common affiliates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API}/admin/affiliates/${affiliateId}/profile`,
      headers: { authorization: `Bearer ${affiliateToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
