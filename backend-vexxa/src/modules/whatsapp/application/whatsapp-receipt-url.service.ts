import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

const PURPOSE = 'whatsapp_receipt';
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 min

/**
 * Gera e valida URLs assinadas temporárias para o PNG do comprovante.
 * A assinatura (HMAC-SHA256) cobre `withdrawalId | exp | purpose`. O endpoint
 * público só serve `image/png`, nunca dados do saque.
 */
@Injectable()
export class WhatsappReceiptUrlService {
  private readonly logger = new Logger(WhatsappReceiptUrlService.name);

  constructor(private readonly config: ConfigService) {}

  private secret(): string {
    return this.config.get<string>('WHATSAPP_RECEIPT_SIGNING_SECRET') ?? '';
  }

  private publicBase(): string {
    const base =
      this.config.get<string>('WHATSAPP_PUBLIC_API_URL') ??
      this.config.get<string>('APP_PUBLIC_URL') ??
      '';
    return base.replace(/\/+$/, '');
  }

  private sign(withdrawalId: string, exp: number): string {
    return createHmac('sha256', this.secret())
      .update(`${withdrawalId}|${exp}|${PURPOSE}`)
      .digest('hex');
  }

  /** Monta a URL assinada para enviar à Evolution no /send/media. */
  buildSignedUrl(withdrawalId: string, ttlMs = DEFAULT_TTL_MS): string | null {
    if (!this.secret() || !this.publicBase()) return null;
    const exp = Date.now() + ttlMs;
    const sig = this.sign(withdrawalId, exp);
    const qs = new URLSearchParams({ exp: String(exp), sig });
    return `${this.publicBase()}/api/v1/whatsapp/receipt/${encodeURIComponent(withdrawalId)}?${qs.toString()}`;
  }

  /** Valida expiração + assinatura (comparação segura). */
  verify(withdrawalId: string, exp: number, sig: string): boolean {
    if (!this.secret()) return false;
    if (!Number.isFinite(exp) || exp < Date.now()) return false; // expirada
    const expected = this.sign(withdrawalId, exp);
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || a.length === 0) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
