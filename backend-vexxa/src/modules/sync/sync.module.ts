import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/index.js';
import { ProviderAccountModule } from '../provider-account/provider-account.module.js';
import { LinkWebhookModule } from '../link-webhook/index.js';
import { SyncOrchestratorService } from './application/sync-orchestrator.service.js';
import { BetboardExtractor } from './infrastructure/extractors/betboard.extractor.js';
import { SmarticoExtractor } from './infrastructure/extractors/smartico.extractor.js';
import { OtgExtractor } from './infrastructure/extractors/otg.extractor.js';
import { SyncPrismaRepository } from './infrastructure/persistence/sync.prisma-repository.js';
import { SyncSchedulerService } from './infrastructure/scheduling/sync-scheduler.service.js';
import { SyncController } from './infrastructure/sync.controller.js';
import { SYNC_REPOSITORY } from './domain/ports/sync.repository.port.js';
import { PROVIDER_ACCOUNT_REPOSITORY } from '../provider-account/domain/repositories/provider-account.repository.js';
import { ProviderAccountPrismaRepository } from '../provider-account/infrastructure/persistence/provider-account.prisma-repository.js';
import type { IProviderExtractor } from './domain/ports/provider-extractor.port.js';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    ProviderAccountModule, // exports ProviderAccountCredentialService
    LinkWebhookModule, // exports LinkWebhookService (affiliate_data.synced)
  ],
  controllers: [SyncController],
  providers: [
    // Domain/Application
    SyncOrchestratorService,

    // Infrastructure
    SyncSchedulerService,
    BetboardExtractor,
    SmarticoExtractor,
    OtgExtractor,
    { provide: SYNC_REPOSITORY, useClass: SyncPrismaRepository },

    // Re-provide PROVIDER_ACCOUNT_REPOSITORY so SyncSchedulerService can inject it
    // (ProviderAccountModule only exports ProviderAccountCredentialService)
    {
      provide: PROVIDER_ACCOUNT_REPOSITORY,
      useClass: ProviderAccountPrismaRepository,
    },

    // EXTRACTOR_MAP — factory that maps provider slug → extractor instance
    {
      provide: 'EXTRACTOR_MAP',
      useFactory: (...extractors: IProviderExtractor[]) => {
        const map = new Map<string, IProviderExtractor>();
        for (const ext of extractors) {
          map.set(ext.providerSlug, ext);
        }
        return map;
      },
      inject: [BetboardExtractor, SmarticoExtractor, OtgExtractor],
    },
  ],
})
export class SyncModule {}
