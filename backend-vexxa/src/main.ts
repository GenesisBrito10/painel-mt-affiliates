import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { RedisSocketIoAdapter } from './common/adapters/redis-socket-io.adapter.js';

// Silence pg deprecation warning emitted by @prisma/adapter-pg internals
// ("Calling client.query() when the client is already executing"). This is a
// known interaction between pg >=8.13 and the Prisma driver adapter and does
// not affect correctness. Remove once Prisma 7.8+ ships the adapter fix.
process.on('warning', (warning: NodeJS.ErrnoException) => {
  if (
    warning.name === 'DeprecationWarning' &&
    /Calling client\.query\(\) when the client is already executing/.test(
      warning.message,
    )
  ) {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(warning.stack ?? warning.message);
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    // Disable Nest's auto JSON parser — we register our own below to capture
    // rawBody for HeartPay webhook HMAC validation.
    { bodyParser: false },
  );

  // ── Raw body capture (HeartPay webhook HMAC validation) ───────
  // Stores the original request bytes on `request.rawBody` so the webhook
  // controller can recompute HMAC-SHA256 over the exact payload HeartPay
  // signed. Replaces the default Fastify JSON parser.
  const fastifyInstance = app.getHttpAdapter().getInstance() as unknown as {
    removeContentTypeParser: (ct: string) => void;
    addContentTypeParser: (
      ct: string,
      opts: { parseAs: 'buffer'; bodyLimit: number },
      parser: (
        req: { rawBody?: string },
        body: Buffer,
        done: (err: Error | null, body?: unknown) => void,
      ) => void,
    ) => void;
  };
  const JSON_BODY_LIMIT = 1_048_576; // 1 MB — caps memory cost of raw-body capture.
  fastifyInstance.removeContentTypeParser('application/json');
  fastifyInstance.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: JSON_BODY_LIMIT },
    (req, body, done) => {
      const raw = body.toString('utf8');
      req.rawBody = raw;
      if (!raw.length) return done(null, {});
      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  // ── Global Prefix ────────────────────────────────────────
  app.setGlobalPrefix('api', { exclude: ['/health'] });

  // ── Security ────────────────────────────────────────────────
  const isProduction = process.env['NODE_ENV'] === 'production';

  await app.register(helmet, {
    contentSecurityPolicy: isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'"],
          },
        }
      : false, // Disabled in dev for Swagger UI
  });
  const rawOrigin = process.env['CORS_ORIGIN'];
  const allowedOrigins = rawOrigin
    ? rawOrigin
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [];
  const corsOrigin = isProduction
    ? allowedOrigins.length === 1
      ? allowedOrigins[0]
      : allowedOrigins.length > 1
        ? allowedOrigins
        : false
    : true; // dev: reflect any origin (CORS effectively disabled)

  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(compress);
  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 10 * 1024 * 1024,
      fieldSize: 10 * 1024 * 1024,
    },
  });

  // ── Socket.io ──────────────────────────────────────────────
  const config = app.get(ConfigService);
  const socketAdapter = new RedisSocketIoAdapter(app);
  await socketAdapter.connectToRedis({
    host: config.get<string>('REDIS_HOST', 'localhost'),
    port: config.get<number>('REDIS_PORT', 6379),
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    db: config.get<number>('REDIS_DB', 0),
  });
  app.useWebSocketAdapter(socketAdapter);

  // ── URI Versioning (/v1/, /v2/, …) ─────────────────────────
  app.enableVersioning({ type: VersioningType.URI });

  // ── Global Pipes ────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // ── Global Filters ──────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Global Interceptors ─────────────────────────────────────
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ── Swagger (disabled in production) ────────────────────────
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('VeXXa API')
      .setDescription('VeXXa Backend — Affiliate management platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();

  const port = process.env['PORT'] ?? 3011;
  await app.listen(port, '0.0.0.0');
  Logger.log(`🚀 Server running on http://localhost:${port}`, 'Bootstrap');
  if (!isProduction) {
    Logger.log(`📖 Swagger at http://localhost:${port}/docs`, 'Bootstrap');
  }
}

void bootstrap();
