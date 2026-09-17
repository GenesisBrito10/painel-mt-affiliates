import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';

/**
 * SSRF guard for outbound webhook URLs. Rejects non-HTTPS schemes and hosts
 * that point at loopback / private / link-local / reserved ranges so a third
 * party can't register a URL that makes us call internal services.
 *
 * Hostname-based (literal IPs + obvious internal names). DNS-rebinding is not
 * fully solved here; the queue worker additionally runs in an egress-limited
 * network. Allow `http` only when ALLOW_INSECURE_WEBHOOKS=1 (local/dev).
 */
export function assertPublicHttpsUrl(
  raw: string,
  opts: { allowInsecure?: boolean } = {},
): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('URL do webhook inválida');
  }

  const allowInsecure =
    opts.allowInsecure ?? process.env.ALLOW_INSECURE_WEBHOOKS === '1';

  if (
    url.protocol !== 'https:' &&
    !(allowInsecure && url.protocol === 'http:')
  ) {
    throw new BadRequestException('A URL do webhook deve usar HTTPS');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    throw new BadRequestException(
      'A URL do webhook não pode apontar para um host interno',
    );
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 && isPrivateIPv4(host)) {
    throw new BadRequestException(
      'A URL do webhook não pode apontar para um IP privado',
    );
  }
  if (ipVersion === 6 && isPrivateIPv6(host)) {
    throw new BadRequestException(
      'A URL do webhook não pode apontar para um IP privado',
    );
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true; // loopback / unspecified
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local fc00::/7
  if (v.startsWith('fe80')) return true; // link-local
  // IPv4-mapped (::ffff:a.b.c.d)
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}
