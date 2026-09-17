import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { assertPublicHttpsUrl } from './webhook-url.util.js';

describe('assertPublicHttpsUrl', () => {
  it('accepts a normal public https URL', () => {
    expect(() =>
      assertPublicHttpsUrl('https://hooks.partner.com/webhook'),
    ).not.toThrow();
  });

  it('rejects non-https schemes', () => {
    expect(() => assertPublicHttpsUrl('http://hooks.partner.com')).toThrow(
      BadRequestException,
    );
    expect(() => assertPublicHttpsUrl('ftp://hooks.partner.com')).toThrow(
      BadRequestException,
    );
  });

  it('allows http only when explicitly permitted', () => {
    expect(() =>
      assertPublicHttpsUrl('http://hooks.partner.com', { allowInsecure: true }),
    ).not.toThrow();
  });

  it('rejects localhost and internal hostnames', () => {
    for (const url of [
      'https://localhost/hook',
      'https://api.internal/hook',
      'https://db.local/hook',
    ]) {
      expect(() => assertPublicHttpsUrl(url)).toThrow(BadRequestException);
    }
  });

  it('rejects private and loopback IPv4', () => {
    for (const url of [
      'https://127.0.0.1/hook',
      'https://10.0.0.5/hook',
      'https://192.168.1.1/hook',
      'https://172.16.4.4/hook',
      'https://169.254.1.1/hook',
      'https://100.64.0.1/hook',
      'https://0.0.0.0/hook',
    ]) {
      expect(() => assertPublicHttpsUrl(url)).toThrow(BadRequestException);
    }
  });

  it('rejects private/loopback IPv6', () => {
    for (const url of [
      'https://[::1]/hook',
      'https://[fd00::1]/hook',
      'https://[fe80::1]/hook',
    ]) {
      expect(() => assertPublicHttpsUrl(url)).toThrow(BadRequestException);
    }
  });

  it('rejects malformed URLs', () => {
    expect(() => assertPublicHttpsUrl('not a url')).toThrow(
      BadRequestException,
    );
  });
});
