import { Injectable, Logger, Inject } from '@nestjs/common';
import { CryptoService } from '../../shared/index.js';
import {
  PROVIDER_ACCOUNT_REPOSITORY,
  type IProviderAccountRepository,
} from '../domain/repositories/provider-account.repository.js';
import {
  ProviderAccountNotFoundException,
  HouseAlreadyAssociatedException,
  ProviderAccountConflictException,
  HouseNotFoundException,
} from '../domain/exceptions/provider-account.exceptions.js';
import {
  CreateProviderAccountDto,
  UpdateProviderAccountDto,
  AddHouseDto,
  HouseResponseDto,
  ProviderAccountResponseDto,
} from './dto/provider-account.dto.js';
import type { AccountWithHouses } from '../domain/types/provider-account.types.js';

@Injectable()
export class ProviderAccountService {
  private readonly logger = new Logger(ProviderAccountService.name);

  constructor(
    @Inject(PROVIDER_ACCOUNT_REPOSITORY)
    private readonly repo: IProviderAccountRepository,
    private readonly crypto: CryptoService,
  ) {}

  async create(dto: CreateProviderAccountDto): Promise<ProviderAccountResponseDto> {
    const exists = await this.repo.findByNameAndProvider(dto.name, dto.provider);
    if (exists) throw new ProviderAccountConflictException('Account name already exists for this provider');

    // Batch house validation (fix M04 — single query)
    if (dto.houses?.length) {
      const slugs = dto.houses.map((h) => h.bettingHouseSlug);
      for (const slug of slugs) {
        const exists = await this.repo.bettingHouseExists(slug);
        if (!exists) throw new HouseNotFoundException(slug);
      }
    }

    const account = await this.repo.create({
      name: dto.name,
      provider: dto.provider,
      apiBaseUrl: dto.apiBaseUrl,
      email: dto.email,
      encryptedPassword: this.crypto.encrypt(dto.password),
      houses: dto.houses?.map((h) => ({
        bettingHouseSlug: h.bettingHouseSlug,
        bookmarkerId: h.bookmarkerId,
        extraConfig: (h.extraConfig ?? {}) as object,
      })),
    });

    this.logger.log(`Provider account created: ${account.name} (${account.provider})`);
    return this.toResponse(account);
  }

  async findAll(): Promise<ProviderAccountResponseDto[]> {
    const accounts = await this.repo.findAll();
    return accounts.map((a) => this.toResponse(a));
  }

  async findById(id: string): Promise<ProviderAccountResponseDto> {
    const account = await this.repo.findById(id);
    if (!account) throw new ProviderAccountNotFoundException(id);
    return this.toResponse(account);
  }

  async findByHouse(slug: string): Promise<ProviderAccountResponseDto[]> {
    const accounts = await this.repo.findByHouseSlug(slug);
    return accounts.map((a) => this.toResponse(a));
  }

  async update(id: string, dto: UpdateProviderAccountDto): Promise<ProviderAccountResponseDto> {
    const existing = await this.repo.findById(id);
    if (!existing) throw new ProviderAccountNotFoundException(id);

    if (dto.name) {
      const dup = await this.repo.findByNameAndProvider(dto.name, existing.provider);
      if (dup && dup.id !== id) throw new ProviderAccountConflictException('Name already taken for this provider');
    }

    const account = await this.repo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.apiBaseUrl !== undefined && { apiBaseUrl: dto.apiBaseUrl }),
      ...(dto.active !== undefined && { active: dto.active }),
      ...(dto.email !== undefined && { email: dto.email }),
      ...(dto.password !== undefined && { encryptedPassword: this.crypto.encrypt(dto.password) }),
    });

    return this.toResponse(account);
  }

  async delete(id: string): Promise<void> {
    const exists = await this.repo.findById(id);
    if (!exists) throw new ProviderAccountNotFoundException(id);
    await this.repo.delete(id);
    this.logger.log(`Provider account deleted: ${id}`);
  }

  async addHouse(accountId: string, dto: AddHouseDto): Promise<ProviderAccountResponseDto> {
    const account = await this.repo.findById(accountId);
    if (!account) throw new ProviderAccountNotFoundException(accountId);

    const houseExists = await this.repo.bettingHouseExists(dto.bettingHouseSlug);
    if (!houseExists) throw new HouseNotFoundException(dto.bettingHouseSlug);

    const dup = await this.repo.findHouseAssociation(accountId, dto.bettingHouseSlug);
    if (dup) throw new HouseAlreadyAssociatedException(dto.bettingHouseSlug);

    await this.repo.addHouse(accountId, {
      bettingHouseSlug: dto.bettingHouseSlug,
      bookmarkerId: dto.bookmarkerId,
      extraConfig: (dto.extraConfig ?? {}) as object,
    });

    return this.findById(accountId);
  }

  async removeHouse(accountId: string, slug: string): Promise<void> {
    const link = await this.repo.findHouseAssociation(accountId, slug);
    if (!link) throw new ProviderAccountNotFoundException();
    await this.repo.removeHouse(link.id);
  }

  // ─── Private mappers ──────────────────────────────────────────────────────

  private toResponse(account: AccountWithHouses): ProviderAccountResponseDto {
    const dto = new ProviderAccountResponseDto();
    dto.id = account.id;
    dto.name = account.name;
    dto.provider = account.provider;
    dto.apiBaseUrl = account.apiBaseUrl;
    dto.emailMasked = this.maskEmail(account.email);
    dto.active = account.active;
    dto.lastUsedAt = account.lastUsedAt;
    dto.lastError = account.lastError;
    dto.createdAt = account.createdAt;
    dto.houses = account.houses.map((h) => {
      const hDto = new HouseResponseDto();
      hDto.bettingHouseSlug = h.bettingHouseSlug;
      hDto.bettingHouseName = h.bettingHouse.name;
      hDto.bookmarkerId = h.bookmarkerId;
      hDto.active = h.active;
      return hDto;
    });
    return dto;
  }

  private maskEmail(email: string): string {
    const [user, domain] = email.split('@');
    if (!user || !domain) return '***@***.***';
    const maskedUser = user.length <= 3 ? '***' : `${user.slice(0, 3)}***`;
    const parts = domain.split('.');
    const tld = parts.slice(1).join('.');
    const maskedDomain = (parts[0]?.length ?? 0) <= 3 ? '***' : `${parts[0]!.slice(0, 3)}***`;
    return `${maskedUser}@${maskedDomain}.${tld}`;
  }
}
