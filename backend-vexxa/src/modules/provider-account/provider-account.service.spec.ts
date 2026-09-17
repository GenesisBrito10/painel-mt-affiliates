import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProviderAccountService } from './application/provider-account.service.js';
import {
  ProviderAccountNotFoundException,
  HouseAlreadyAssociatedException,
  ProviderAccountConflictException,
  HouseNotFoundException,
} from './domain/exceptions/provider-account.exceptions.js';

// Direct instantiation (no NestJS container) — faster and simpler for unit tests
const mockCrypto = {
  encrypt: vi.fn((v: string) => `enc_${v}`),
  decrypt: vi.fn((v: string) => v.replace('enc_', '')),
};

const mockAccount = {
  id: 'acc-uuid-1',
  name: 'VEXXA',
  provider: 'betboard',
  apiBaseUrl: 'https://api.betboard.com.br/api',
  email: 'admin@vexxa.com',           // decrypted — used by toResponse/maskEmail
  encryptedEmail: 'enc_admin@vexxa.com',
  encryptedPassword: 'enc_secret',
  active: true,
  lastUsedAt: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  houses: [],
};

const makeRepo = () => ({
  findByNameAndProvider: vi.fn(),
  findById: vi.fn(),
  findByIdRaw: vi.fn(),
  findAll: vi.fn(),
  findByHouseSlug: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findHouseAssociation: vi.fn(),
  addHouse: vi.fn(),
  removeHouse: vi.fn(),
  bettingHouseExists: vi.fn(),
  markUsed: vi.fn(),
});

describe('ProviderAccountService', () => {
  let service: ProviderAccountService;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    // Direct instantiation bypasses NestJS DI — cleaner for unit tests
    service = new ProviderAccountService(repo as never, mockCrypto as never);
  });

  afterEach(() => vi.clearAllMocks());

  it('create encrypts password (email stored as plaintext)', async () => {
    repo.findByNameAndProvider.mockResolvedValue(null);
    repo.bettingHouseExists.mockResolvedValue(true);
    repo.create.mockResolvedValue({ ...mockAccount, houses: [] });

    await service.create({
      name: 'VEXXA',
      provider: 'betboard',
      apiBaseUrl: 'https://api.betboard.com.br/api',
      email: 'admin@vexxa.com',
      password: 'secret123',
    });

    // Only password is encrypted — email is stored plaintext
    expect(mockCrypto.encrypt).toHaveBeenCalledTimes(1);
    expect(mockCrypto.encrypt).toHaveBeenCalledWith('secret123');
  });

  it('create throws ProviderAccountConflictException when name+provider exists', async () => {
    repo.findByNameAndProvider.mockResolvedValue(mockAccount);
    await expect(
      service.create({ name: 'VEXXA', provider: 'betboard', apiBaseUrl: 'x', email: 'a@b.com', password: 'pass' }),
    ).rejects.toThrow(ProviderAccountConflictException);
  });

  it('create throws HouseNotFoundException for invalid house slug', async () => {
    repo.findByNameAndProvider.mockResolvedValue(null);
    repo.bettingHouseExists.mockResolvedValue(false);
    await expect(
      service.create({
        name: 'TEST', provider: 'betboard', apiBaseUrl: 'x', email: 'x@y.com', password: 'pass',
        houses: [{ bettingHouseSlug: 'nonexistent', bookmarkerId: 'bk-1' }],
      }),
    ).rejects.toThrow(HouseNotFoundException);
  });

  it('findAll returns emailMasked and never encryptedEmail/encryptedPassword', async () => {
    repo.findAll.mockResolvedValue([{ ...mockAccount, houses: [] }]);
    const results = await service.findAll();
    expect(results[0]).toHaveProperty('emailMasked');
    expect(results[0]).not.toHaveProperty('encryptedEmail');
    expect(results[0]).not.toHaveProperty('encryptedPassword');
  });

  it('update encrypts password when changed', async () => {
    repo.findById.mockResolvedValue({ ...mockAccount, houses: [] });
    repo.update.mockResolvedValue({ ...mockAccount, houses: [] });
    await service.update('acc-uuid-1', { password: 'new-secret' });
    // Only password is encrypted — email remains plaintext in this service
    expect(mockCrypto.encrypt).toHaveBeenCalledWith('new-secret');
  });

  it('addHouse throws HouseAlreadyAssociatedException when already linked', async () => {
    repo.findById.mockResolvedValue({ ...mockAccount, houses: [] });
    repo.bettingHouseExists.mockResolvedValue(true);
    repo.findHouseAssociation.mockResolvedValue({ id: 'existing' });
    await expect(service.addHouse('acc-uuid-1', { bettingHouseSlug: 'esportivabet', bookmarkerId: 'bk-1' }))
      .rejects.toThrow(HouseAlreadyAssociatedException);
  });

  it('removeHouse throws ProviderAccountNotFoundException when association not found', async () => {
    repo.findHouseAssociation.mockResolvedValue(null);
    await expect(service.removeHouse('acc-uuid-1', 'esportivabet'))
      .rejects.toThrow(ProviderAccountNotFoundException);
  });

  it('delete throws ProviderAccountNotFoundException when account does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.delete('non-existent'))
      .rejects.toThrow(ProviderAccountNotFoundException);
  });

  it('findById throws ProviderAccountNotFoundException when not found', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findById('bad-id'))
      .rejects.toThrow(ProviderAccountNotFoundException);
  });
});
