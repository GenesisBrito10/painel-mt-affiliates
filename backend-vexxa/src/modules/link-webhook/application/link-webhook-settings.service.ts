import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CryptoService } from '../../shared/crypto.service.js';
import type { JwtPayload } from '../../auth/index.js';
import type { UpdateLinkWebhookSettingsDto } from './dto/link-webhook.dto.js';
import { assertPublicHttpsUrl } from './webhook-url.util.js';
import {
  ALL_LINK_WEBHOOK_EVENTS,
  type LinkWebhookEvent,
} from '../domain/types/link-webhook.types.js';

export interface ResolvedWebhookTarget {
  ownerUserId: string | null;
  webhookUrl: string;
  /** Decrypted plaintext secret (empty string when none configured). */
  secret: string;
  events: string[];
}

@Injectable()
export class LinkWebhookSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  ownerIdForActor(actor: JwtPayload): string | null {
    return actor.role === UserRole.ADMIN || actor.role === UserRole.SUPERADMIN
      ? null
      : actor.sub;
  }

  async getSettingsForActor(actor: JwtPayload) {
    const ownerUserId = this.ownerIdForActor(actor);
    const row = await this.ensureSettingsForOwner(ownerUserId);
    return this.toResponse(row);
  }

  async updateSettings(actor: JwtPayload, dto: UpdateLinkWebhookSettingsDto) {
    const ownerUserId = this.ownerIdForActor(actor);
    const current = await this.ensureSettingsForOwner(ownerUserId);

    const webhookUrl = dto.webhookUrl?.trim();
    const webhookSecret = dto.webhookSecret?.trim();

    if (webhookUrl) {
      // SSRF guard — reject internal/private targets before we ever call them.
      assertPublicHttpsUrl(webhookUrl);
    }

    const row = await this.prisma.linkWebhookSettings.update({
      where: { id: current.id },
      data: {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(webhookUrl !== undefined ? { webhookUrl } : {}),
        // Encrypt at rest. Empty string clears the secret.
        ...(webhookSecret !== undefined
          ? {
              webhookSecret: webhookSecret
                ? this.crypto.encrypt(webhookSecret)
                : '',
            }
          : {}),
        ...(dto.events !== undefined ? { events: dto.events } : {}),
      },
    });

    return this.toResponse(row);
  }

  async getSettingsRow(ownerUserId: string | null) {
    const row = await this.ensureSettingsForOwner(ownerUserId);
    return {
      ...row,
      // Decrypt for internal callers (test send / delivery).
      webhookSecret: this.safeDecrypt(row.webhookSecret),
    };
  }

  /** Targets subscribed to a given event, with decrypted secrets. */
  async listTargetsForEvent(
    event: LinkWebhookEvent,
  ): Promise<ResolvedWebhookTarget[]> {
    const rows = await this.prisma.linkWebhookSettings.findMany({
      where: { enabled: true, webhookUrl: { not: '' } },
      select: {
        ownerUserId: true,
        webhookUrl: true,
        webhookSecret: true,
        events: true,
      },
    });

    return rows
      .filter((row) => row.events.includes(event))
      .map((row) => ({
        ownerUserId: row.ownerUserId,
        webhookUrl: row.webhookUrl,
        secret: this.safeDecrypt(row.webhookSecret),
        events: row.events,
      }));
  }

  private async ensureSettingsForOwner(ownerUserId: string | null) {
    const existing = await this.prisma.linkWebhookSettings.findFirst({
      where: { ownerUserId },
    });
    if (existing) return existing;

    return this.prisma.linkWebhookSettings.create({
      data: { ownerUserId },
    });
  }

  private safeDecrypt(stored: string): string {
    if (!stored) return '';
    try {
      return this.crypto.decrypt(stored);
    } catch {
      // Legacy plaintext rows (pre-encryption) — return as-is.
      return stored;
    }
  }

  private toResponse(row: {
    id: string;
    ownerUserId: string | null;
    enabled: boolean;
    webhookUrl: string;
    webhookSecret: string;
    events: string[];
    updatedAt: Date;
  }) {
    const hasSecret = row.webhookSecret.length > 0;
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      scope: row.ownerUserId ? 'network' : 'global',
      enabled: row.enabled,
      webhookUrl: row.webhookUrl,
      // Never echo the secret — write-only.
      webhookSecret: hasSecret ? '••••••••' : '',
      hasSecret,
      events: row.events,
      availableEvents: ALL_LINK_WEBHOOK_EVENTS,
      updatedAt: row.updatedAt,
    };
  }
}
