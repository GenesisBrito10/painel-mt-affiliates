import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './../src/app.module';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('HealthController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toEqual(200);
    // Observe that the TransformInterceptor might wrap the response.
    // If global interceptors are not applied in testing module manually or correctly,
    // we need to verify depending on whether it's registered.
    // Here we check if the basic response is ok.
    expect(response.json()).toHaveProperty('status', 'ok');
  });
});
