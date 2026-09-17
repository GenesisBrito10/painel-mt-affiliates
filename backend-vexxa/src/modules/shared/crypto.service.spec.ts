import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CryptoService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => 'test-key-must-be-at-least-32-chars!!',
          },
        },
      ],
    }).compile();
    service = module.get<CryptoService>(CryptoService);
  });

  it('should encrypt and decrypt roundtrip', () => {
    const plain = 'admin@vexxacompany.com';
    const encrypted = service.encrypt(plain);
    expect(service.decrypt(encrypted)).toBe(plain);
  });

  it('should produce different ciphertext for same input (random IV)', () => {
    const plain = 'test@test.com';
    expect(service.encrypt(plain)).not.toBe(service.encrypt(plain));
  });

  it('should throw on invalid encrypted format', () => {
    expect(() => service.decrypt('invalid-no-colons')).toThrow(
      'Invalid encrypted format',
    );
  });

  it('should handle empty string', () => {
    const encrypted = service.encrypt('');
    expect(service.decrypt(encrypted)).toBe('');
  });
});
