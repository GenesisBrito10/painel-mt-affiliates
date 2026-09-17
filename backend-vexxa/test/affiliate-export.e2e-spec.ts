import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';

const API = '/api/v1';

describe('Admin affiliate export (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let adminToken: string;
  let affiliateToken: string;
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
        name: 'Afiliado Export E2E',
        email: `affiliate-export-e2e-${suffix}@vexxa.test`,
        password,
        role: UserRole.AFFILIATE,
        status: UserStatus.APPROVED,
        active: true,
        cpf: `2000000${suffix.slice(-4).padStart(4, '0')}`.slice(0, 11),
        whatsapp: '+5511999990001',
        pixKeyType: 'cpf',
        pixKey: `2000000${suffix.slice(-4).padStart(4, '0')}`.slice(0, 11),
        accountHolder: 'Afiliado Export E2E',
        profileCompleted: true,
      },
      select: { id: true, email: true, role: true },
    });

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
    if (affiliateId) {
      await prisma.user.delete({ where: { id: affiliateId } }).catch(() => {});
    }
    await app.close();
  });

  describe('auth', () => {
    it('returns 401 without an auth token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/admin/affiliates/export`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 for a non-admin (affiliate) token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/admin/affiliates/export`,
        headers: { authorization: `Bearer ${affiliateToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('CSV format', () => {
    it('responds 200 with text/csv and a dated attachment filename', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/admin/affiliates/export?format=csv&role=AFFILIATE`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');

      const disposition = String(res.headers['content-disposition']);
      expect(disposition).toContain('attachment');
      // filename="afiliados-YYYY-MM-DD.csv"
      expect(disposition).toMatch(
        /filename="afiliados-\d{4}-\d{2}-\d{2}\.csv"/,
      );

      // header row present (BOM-prefixed)
      expect(res.payload).toContain('Nome');
      expect(res.payload).toContain('Casas & comissões');
    });

    it('defaults to CSV when format is omitted', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/admin/affiliates/export?role=AFFILIATE`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(String(res.headers['content-disposition'])).toContain('.csv');
    });
  });

  describe('PDF format', () => {
    it('responds 200 with application/pdf and a dated attachment filename', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/admin/affiliates/export?format=pdf&role=AFFILIATE`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');

      const disposition = String(res.headers['content-disposition']);
      expect(disposition).toContain('attachment');
      expect(disposition).toMatch(
        /filename="afiliados-\d{4}-\d{2}-\d{2}\.pdf"/,
      );

      // non-empty PDF payload starting with the %PDF magic header
      const buf = res.rawPayload;
      expect(buf.length).toBeGreaterThan(0);
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });
  });

  describe('invalid format', () => {
    it('rejects an unknown format with 400 (whitelist validation)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${API}/admin/affiliates/export?format=xlsx`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
