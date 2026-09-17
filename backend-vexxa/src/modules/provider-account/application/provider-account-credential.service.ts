import { Injectable, Inject } from '@nestjs/common';
import { CryptoService } from '../../shared/index.js';
import {
  PROVIDER_ACCOUNT_REPOSITORY,
  type IProviderAccountRepository,
} from '../domain/repositories/provider-account.repository.js';
import { ProviderAccountNotFoundException } from '../domain/exceptions/provider-account.exceptions.js';
import type { DecryptedAccountCredentials } from '../domain/types/provider-account.types.js';

// Internal service — only exported for SyncModule use via ProviderAccountModule exports.
// Never inject this in HTTP-facing controllers.
@Injectable()
export class ProviderAccountCredentialService {
  constructor(
    @Inject(PROVIDER_ACCOUNT_REPOSITORY)
    private readonly repo: IProviderAccountRepository,
    private readonly crypto: CryptoService,
  ) {}

  async getDecryptedCredentials(accountId: string): Promise<DecryptedAccountCredentials> {
    const account = await this.repo.findByIdRaw(accountId);
    if (!account) throw new ProviderAccountNotFoundException(accountId);

    return {
      email: account.email,
      password: this.crypto.decrypt(account.encryptedPassword),
      apiBaseUrl: account.apiBaseUrl,
    };
  }

  async markUsed(accountId: string, error?: string): Promise<void> {
    await this.repo.markUsed(accountId, error);
  }
}
