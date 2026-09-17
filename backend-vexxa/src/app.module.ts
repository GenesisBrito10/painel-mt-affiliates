import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor.js';

import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import * as Joi from 'joi';
import databaseConfig from './config/database.config.js';
import { PrismaModule } from './modules/prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PublicModule } from './modules/public/public.module.js';
import { SharedModule } from './modules/shared/shared.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { UserModule } from './modules/user/user.module.js';
import { ProviderAccountModule } from './modules/provider-account/provider-account.module.js';
import { SyncModule } from './modules/sync/index.js';
import { DashboardModule } from './modules/dashboard/index.js';
import { NetworkModule } from './modules/network/index.js';
import { WithdrawalModule } from './modules/withdrawal/index.js';
import { PaymentGatewayModule } from './modules/payment-gateway/index.js';
import { LinkRequestModule } from './modules/link-request/index.js';
import { LinkWebhookModule } from './modules/link-webhook/index.js';
import { RankingModule } from './modules/ranking/index.js';
import { CpaPrizeModule } from './modules/cpa-prize/index.js';
import { NotificationModule } from './modules/notification/index.js';
import { SuperbetLinkPoolModule } from './modules/superbet-link-pool/index.js';
import { AdminManagementModule } from './modules/admin-management/index.js';
import { BetnacionalLinkPoolModule } from './modules/betnacional-link-pool/index.js';
import { HiperbetLinkPoolModule } from './modules/hiperbet-link-pool/index.js';
import { BetanoLinkPoolModule } from './modules/betano-link-pool/index.js';
import { BetanoDiarioLinkPoolModule } from './modules/betano-diario-link-pool/index.js';
import { EsportivaDiarioLinkPoolModule } from './modules/esportiva-diario-link-pool/index.js';
import { PinbetDiarioLinkPoolModule } from './modules/pinbet-diario-link-pool/index.js';
import { PinbetMensalLinkPoolModule } from './modules/pinbet-mensal-link-pool/index.js';
import { SupportChatModule } from './modules/support-chat/index.js';
import { AffiliateApiModule } from './modules/affiliate-api/index.js';
import { CorrelationIdMiddleware } from './common/middlewares/correlation-id.middleware.js';
import { MailModule } from './modules/mail/index.js';
import { SuperbetInactivityModule } from './modules/superbet-inactivity/index.js';
import { WhatsappModule } from './modules/whatsapp/index.js';
import { LoginModalModule } from './modules/login-modal/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().default(3011),
        DATABASE_URL: Joi.string().uri().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRATION: Joi.string().default('15m'),
        ENCRYPTION_KEY: Joi.string().min(32).required(),
        CORS_ORIGIN: Joi.string()
          .default('*')
          .custom((value: string) => {
            if (value === '*' && process.env['NODE_ENV'] === 'production') {
              process.stderr.write(
                '[SECURITY WARNING] CORS_ORIGIN is set to "*" in production. Set a specific origin.\n',
              );
            }
            return value;
          }),
        REDIS_HOST: Joi.string().default('localhost'),
        REDIS_PORT: Joi.number().default(6379),
        REDIS_PASSWORD: Joi.string().optional().allow(''),
        REDIS_DB: Joi.number().integer().min(0).max(15).default(0),
        VAPID_PUBLIC_KEY: Joi.string().required(),
        VAPID_PRIVATE_KEY: Joi.string().required(),
        VAPID_EMAIL: Joi.string().required(),
        HEARTPAY_BASE_URL: Joi.string().uri().required(),
        HEARTPAY_API_KEY: Joi.string().required(),
        HEARTPAY_WEBHOOK_TOKEN: Joi.string().min(16).required(),
        HEARTPAY_HTTP_TIMEOUT_MS: Joi.number()
          .integer()
          .min(1000)
          .default(15000),
        // Seletor de gateway PIX ativo para saques.
        PAYMENT_GATEWAY: Joi.string()
          .valid('heartpay', 'vorexy')
          .default('vorexy'),
        APP_PUBLIC_URL: Joi.string().uri().required(),
        AFFILIATE_PANEL_URL: Joi.string()
          .uri()
          .default('https://affiliates.vallexgroup.com.br'),
        RESEND_API_KEY: Joi.string().optional().allow(''),
        RESEND_FROM: Joi.string().optional().allow(''),
        SUPERBET_INACTIVITY_EMAIL_COPY_TO: Joi.string()
          .email()
          .optional()
          .allow(''),
        // ─── Google Sheets (Superbet auto-assign) ──────────────────────
        GOOGLE_TYPE: Joi.string().required(),
        GOOGLE_PROJECT_ID: Joi.string().required(),
        GOOGLE_PRIVATE_KEY_ID: Joi.string().required(),
        GOOGLE_PRIVATE_KEY: Joi.string().required(),
        GOOGLE_CLIENT_EMAIL: Joi.string().required(),
        GOOGLE_CLIENT_ID: Joi.string().required(),
        GOOGLE_AUTH_URI: Joi.string().uri().optional(),
        GOOGLE_TOKEN_URI: Joi.string().uri().optional(),
        GOOGLE_AUTH_PROVIDER_X509_CERT_URL: Joi.string().uri().optional(),
        GOOGLE_CLIENT_X509_CERT_URL: Joi.string().uri().optional(),
        GOOGLE_UNIVERSE_DOMAIN: Joi.string().default('googleapis.com'),
        SUPERBET_SHEET_ID: Joi.string().required(),
        SUPERBET_SHEET_TAB: Joi.string().default('Sheet1'),
        // ─── Google Sheets (Betnacional auto-assign) ───────────────────
        BETNACIONAL_SHEET_ID: Joi.string().required(),
        BETNACIONAL_SHEET_TAB: Joi.string().default('Página1'),
        // ─── Google Sheets (Hiperbet auto-assign) ──────────────────────
        HIPERBET_SHEET_ID: Joi.string().required(),
        HIPERBET_SHEET_TAB: Joi.string().default('Página1'),
        // ─── Google Sheets (Betano auto-assign) ────────────────────────
        BETANO_SHEET_ID: Joi.string().required(),
        BETANO_SHEET_TAB: Joi.string().default('Página1'),
        BETANO_DIARIO_SHEET_ID: Joi.string().required(),
        BETANO_DIARIO_SHEET_TAB: Joi.string().default('LINKS'),
        ESPORTIVA_DIARIO_SHEET_ID: Joi.string().optional().allow(''),
        ESPORTIVA_DIARIO_SHEET_TAB: Joi.string().optional().allow(''),
        // ─── Google Sheets (Pinbet Diário auto-assign) ─────────────────
        PINBET_SHEET_ID: Joi.string().optional().allow(''),
        PINBET_SHEET_TAB: Joi.string().default('Diário'),
        // ─── Google Sheets (Pinbet Mensal — INATIVO, sem planilha ainda) ─
        PINBET_MENSAL_SHEET_ID: Joi.string().optional().allow(''),
        PINBET_MENSAL_SHEET_TAB: Joi.string().default('Mensal'),
        // ─── Smartico (token da API do Pinbet — fonte de verdade em runtime) ─
        PINBET_SMARTICO_TOKEN: Joi.string().optional().allow(''),
        // ─── WhatsApp (Evolution GO) ───────────────────────────────────
        EVOLUTION_API_URL: Joi.string().uri().optional().allow(''),
        EVOLUTION_API_KEY: Joi.string().optional().allow(''),
        EVOLUTION_INSTANCE_NAME: Joi.string().optional().allow(''),
        EVOLUTION_AUTH_HEADER: Joi.string().default('apikey'),
        WHATSAPP_WEBHOOK_TOKEN: Joi.string().optional().allow(''),
        WHATSAPP_RECEIPT_SIGNING_SECRET: Joi.string().optional().allow(''),
        WHATSAPP_PUBLIC_API_URL: Joi.string().uri().optional().allow(''),
        WHATSAPP_DELAY_MIN_SECONDS: Joi.number().integer().min(0).default(20),
        WHATSAPP_DELAY_MAX_SECONDS: Joi.number().integer().min(0).default(90),
        WHATSAPP_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
        WHATSAPP_MAX_WAIT_CONNECTION_MINUTES: Joi.number()
          .integer()
          .min(1)
          .default(1440),
        WHATSAPP_FAILURE_THRESHOLD: Joi.number().integer().min(1).default(5),
        WHATSAPP_DISCONNECT_COOLDOWN_SECONDS: Joi.number()
          .integer()
          .min(60)
          .default(1800),
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          // Use same pattern as SharedModule — undefined means no auth
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          db: config.get<number>('REDIS_DB', 0),
        },
      }),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SharedModule,
    HealthModule,
    PublicModule,
    AuthModule,
    SettingsModule,
    UserModule,
    ProviderAccountModule,
    SyncModule,
    DashboardModule,
    NetworkModule,
    PaymentGatewayModule,
    WithdrawalModule,
    LinkRequestModule,
    LinkWebhookModule,
    RankingModule,
    CpaPrizeModule,
    NotificationModule,
    SuperbetLinkPoolModule,
    BetnacionalLinkPoolModule,
    HiperbetLinkPoolModule,
    BetanoLinkPoolModule,
    BetanoDiarioLinkPoolModule,
    EsportivaDiarioLinkPoolModule,
    PinbetDiarioLinkPoolModule,
    PinbetMensalLinkPoolModule,
    AffiliateApiModule,
    MailModule,
    SuperbetInactivityModule,
    AdminManagementModule,
    SupportChatModule,
    WhatsappModule,
    LoginModalModule,
  ],
  controllers: [],
  providers: [
    // Global: popula AsyncLocalStorage (changedById/source) p/ auditoria de cpa.
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('{*path}');
  }
}
