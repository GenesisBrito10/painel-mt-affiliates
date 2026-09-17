import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Fastify-compatible ThrottlerGuard with Cloudflare + Nginx proxy support.
 *
 * Priority order for real client IP resolution:
 *   1. CF-Connecting-IP  — set by Cloudflare with the original client IP
 *   2. X-Forwarded-For   — set by Nginx (first entry = real client IP)
 *   3. socket.remoteAddress — direct connection fallback
 *
 * Without this, all users share the same rate-limit bucket because every
 * request arrives from the proxy IP instead of the real client IP.
 */
@Injectable()
export class FastifyThrottlerGuard extends ThrottlerGuard {
  getRequestResponse(context: ExecutionContext) {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const reply = http.getResponse();
    return { req: request, res: reply };
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req['headers'] as Record<string, string | string[] | undefined>;

    // Cloudflare sets this to the real visitor IP — highest priority
    const cfIp = headers['cf-connecting-ip'];
    if (cfIp && typeof cfIp === 'string' && cfIp.trim()) {
      return cfIp.trim();
    }

    // Nginx typically sets X-Forwarded-For: <client>, <proxy1>, ...
    const forwarded = headers['x-forwarded-for'];
    if (forwarded) {
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
        .split(',')[0]
        .trim();
      if (first) return first;
    }

    // Direct connection fallback
    const socket = req['socket'] as { remoteAddress?: string } | undefined;
    return socket?.remoteAddress ?? 'unknown';
  }
}
