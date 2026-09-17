import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { SuperbetLinkPoolModule } from '../superbet-link-pool/index.js';
import { BetnacionalLinkPoolModule } from '../betnacional-link-pool/index.js';
import { HiperbetLinkPoolModule } from '../hiperbet-link-pool/index.js';
import { BetanoLinkPoolModule } from '../betano-link-pool/index.js';
import { BetanoDiarioLinkPoolModule } from '../betano-diario-link-pool/index.js';
import { EsportivaLinkPoolModule } from '../esportiva-link-pool/index.js';
import { EsportivaDiarioLinkPoolModule } from '../esportiva-diario-link-pool/index.js';
import { SportingbetLinkPoolModule } from '../sportingbet-link-pool/index.js';
import { SportingbetDiarioLinkPoolModule } from '../sportingbet-diario-link-pool/index.js';
import { PinbetDiarioLinkPoolModule } from '../pinbet-diario-link-pool/index.js';
import { PinbetMensalLinkPoolModule } from '../pinbet-mensal-link-pool/index.js';
import { LinkWebhookModule } from '../link-webhook/index.js';
import { NotificationModule } from '../notification/notification.module.js';
import { LinkRequestController } from './infrastructure/link-request.controller.js';
import { HouseLinkRuleController } from './infrastructure/house-link-rule.controller.js';
import { LinkRequestService } from './application/link-request.service.js';
import { DealEligibilityService } from './application/deal-eligibility.service.js';
import { CpaResolutionService } from './application/cpa-resolution.service.js';
import { LinkDependencyService } from './application/link-dependency.service.js';
import { LinkAssignmentLogService } from './application/link-assignment-log.service.js';
import { HouseLinkRuleService } from './application/house-link-rule.service.js';
import { LinkBackfillService } from './application/link-backfill.service.js';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    SuperbetLinkPoolModule,
    BetnacionalLinkPoolModule,
    HiperbetLinkPoolModule,
    BetanoLinkPoolModule,
    BetanoDiarioLinkPoolModule,
    EsportivaLinkPoolModule,
    EsportivaDiarioLinkPoolModule,
    SportingbetLinkPoolModule,
    SportingbetDiarioLinkPoolModule,
    PinbetDiarioLinkPoolModule,
    PinbetMensalLinkPoolModule,
    LinkWebhookModule,
    NotificationModule,
  ],
  controllers: [LinkRequestController, HouseLinkRuleController],
  providers: [
    LinkRequestService,
    DealEligibilityService,
    CpaResolutionService,
    LinkDependencyService,
    LinkAssignmentLogService,
    HouseLinkRuleService,
    LinkBackfillService,
  ],
  exports: [LinkRequestService, HouseLinkRuleService],
})
export class LinkRequestModule {}
