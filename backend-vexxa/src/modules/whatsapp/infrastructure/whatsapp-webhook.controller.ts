import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { WhatsappConnectionService } from '../application/whatsapp-connection.service.js';
import type { WhatsappConnectionStatus } from '../domain/types/whatsapp.types.js';

/**
 * Recebe eventos da Evolution GO (registrados via webhookUrl no /instance/connect).
 * Protegido por token na query (?token=). O poll de status é o fallback
 * confiável caso eventos não cheguem.
 */
@ApiExcludeController()
@Controller({ path: 'webhooks/whatsapp', version: '1' })
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly connectionService: WhatsappConnectionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Query('token') token: string | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<{ received: boolean }> {
    this.assertToken(token);

    const status = extractStatus(body);
    if (status) {
      const phone = extractPhone(body);
      await this.connectionService.applyStatus(status, phone);
      this.logger.debug(`Webhook WhatsApp aplicou status=${status}`);
    }
    return { received: true };
  }

  private assertToken(token: string | undefined): void {
    const expected = this.config.get<string>('WHATSAPP_WEBHOOK_TOKEN') ?? '';
    if (!expected || !token) throw new UnauthorizedException('token inválido');
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('token inválido');
    }
  }
}

// ─── Parsing defensivo do payload de evento ──────────────────────────────────

function deepFindString(
  obj: unknown,
  keys: string[],
  depth = 0,
): string | undefined {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    if (typeof o[k] === 'string' && (o[k] as string).length > 0) {
      return o[k] as string;
    }
  }
  for (const v of Object.values(o)) {
    const found = deepFindString(v, keys, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function extractStatus(
  body: Record<string, unknown>,
): WhatsappConnectionStatus | null {
  const raw = (
    deepFindString(body, [
      'state',
      'status',
      'connection',
      'connectionStatus',
    ]) ?? ''
  ).toLowerCase();
  if (!raw) return null;
  if (['open', 'connected', 'online'].includes(raw)) return 'open';
  if (['connecting', 'pairing', 'qr', 'starting'].includes(raw))
    return 'connecting';
  if (['close', 'closed', 'disconnected', 'offline', 'logout'].includes(raw))
    return 'close';
  return null;
}

function extractPhone(body: Record<string, unknown>): string | null {
  return (
    deepFindString(body, ['phone', 'phoneNumber', 'number', 'wid']) ?? null
  );
}
