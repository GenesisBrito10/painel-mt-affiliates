import { describe, expect, it } from 'vitest';
import { SUPPORTED_PROVIDERS } from './provider-account.types.js';

describe('SUPPORTED_PROVIDERS', () => {
  it('accepts OTG provider accounts', () => {
    expect(SUPPORTED_PROVIDERS).toContain('otg');
  });
});
