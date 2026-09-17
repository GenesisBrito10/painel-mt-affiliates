import { Module } from '@nestjs/common';
import { ProviderAccountService } from './application/provider-account.service.js';
import { ProviderAccountCredentialService } from './application/provider-account-credential.service.js';
import { ProviderAccountController } from './infrastructure/provider-account.controller.js';
import { ProviderAccountPrismaRepository } from './infrastructure/persistence/provider-account.prisma-repository.js';
import { PROVIDER_ACCOUNT_REPOSITORY } from './domain/repositories/provider-account.repository.js';

@Module({
  controllers: [ProviderAccountController],
  providers: [
    ProviderAccountService,
    ProviderAccountCredentialService,
    { provide: PROVIDER_ACCOUNT_REPOSITORY, useClass: ProviderAccountPrismaRepository },
  ],
  exports: [ProviderAccountCredentialService],
})
export class ProviderAccountModule {}
