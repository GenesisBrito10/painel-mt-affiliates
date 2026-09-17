import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { IProviderAccountRepository } from '../../domain/repositories/provider-account.repository.js';
import type { AccountWithHouses } from '../../domain/types/provider-account.types.js';
import type { ProviderAccount } from '@prisma/client';

const INCLUDE_HOUSES = { houses: { include: { bettingHouse: true } } } as const;

@Injectable()
export class ProviderAccountPrismaRepository implements IProviderAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByNameAndProvider(name: string, provider: string): Promise<ProviderAccount | null> {
    return this.prisma.providerAccount.findUnique({
      where: { uq_account_name_provider: { name, provider } },
    });
  }

  async findById(id: string): Promise<AccountWithHouses | null> {
    return this.prisma.providerAccount.findUnique({ where: { id }, include: INCLUDE_HOUSES });
  }

  async findByIdRaw(id: string): Promise<ProviderAccount | null> {
    return this.prisma.providerAccount.findUnique({ where: { id } });
  }

  async findAll(): Promise<AccountWithHouses[]> {
    return this.prisma.providerAccount.findMany({
      include: INCLUDE_HOUSES,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByHouseSlug(slug: string): Promise<AccountWithHouses[]> {
    return this.prisma.providerAccount.findMany({
      where: { houses: { some: { bettingHouseSlug: slug } } },
      include: INCLUDE_HOUSES,
    });
  }

  async create(data: {
    name: string;
    provider: string;
    apiBaseUrl: string;
    email: string;
    encryptedPassword: string;
    houses?: { bettingHouseSlug: string; bookmarkerId: string; extraConfig: object }[];
  }): Promise<AccountWithHouses> {
    return this.prisma.$transaction(async (tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0]) => {
      return tx.providerAccount.create({
        data: {
          name: data.name,
          provider: data.provider,
          apiBaseUrl: data.apiBaseUrl,
          email: data.email,
          encryptedPassword: data.encryptedPassword,
          houses: data.houses?.length ? { create: data.houses } : undefined,
        },
        include: INCLUDE_HOUSES,
      });
    });
  }

  async update(id: string, data: {
    name?: string;
    apiBaseUrl?: string;
    active?: boolean;
    email?: string;
    encryptedPassword?: string;
  }): Promise<AccountWithHouses> {
    return this.prisma.providerAccount.update({ where: { id }, data, include: INCLUDE_HOUSES });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.providerAccount.delete({ where: { id } });
  }

  async findHouseAssociation(providerAccountId: string, bettingHouseSlug: string): Promise<{ id: string } | null> {
    return this.prisma.providerAccountHouse.findUnique({
      where: { uq_account_house: { providerAccountId, bettingHouseSlug } },
      select: { id: true },
    });
  }

  async addHouse(providerAccountId: string, data: {
    bettingHouseSlug: string;
    bookmarkerId: string;
    extraConfig: object;
  }): Promise<void> {
    await this.prisma.providerAccountHouse.create({
      data: { providerAccountId, ...data },
    });
  }

  async removeHouse(houseAssociationId: string): Promise<void> {
    await this.prisma.providerAccountHouse.delete({ where: { id: houseAssociationId } });
  }

  async bettingHouseExists(slug: string): Promise<boolean> {
    const count = await this.prisma.bettingHouse.count({ where: { slug } });
    return count > 0;
  }

  async markUsed(id: string, error?: string): Promise<void> {
    await this.prisma.providerAccount.update({
      where: { id },
      data: {
        lastUsedAt: new Date(),
        lastError: error ?? null,
      },
    });
  }
}
