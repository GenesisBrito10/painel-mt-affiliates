import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Prisma,
  WhatsappConnectionState,
  WhatsappSettings,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EvolutionClient } from '../infrastructure/clients/evolution.client.js';
import { DEFAULT_TEMPLATE } from '../domain/types/whatsapp.types.js';
import { validateTemplate } from './whatsapp-template.js';

export interface UpdateSettingsInput {
  selectedGroupId?: string | null;
  selectedGroupName?: string | null;
  messageTemplate?: string;
  sendMedia?: boolean;
  delayMinSeconds?: number;
  delayMaxSeconds?: number;
  maxAttempts?: number;
  maxWaitConnectionMinutes?: number;
  failureCooldownSeconds?: number;
  enabled?: boolean;
  linkPoolAlertNumber?: string | null;
  linkPoolAlertThreshold?: number;
  linkPoolAlertEnabled?: boolean;
}

/**
 * Gerencia as linhas singleton de configuração (WhatsappSettings) e de estado
 * de runtime (WhatsappConnectionState). Toda a feature usa estas duas linhas.
 */
@Injectable()
export class WhatsappSettingsService {
  private readonly logger = new Logger(WhatsappSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly evolution: EvolutionClient,
  ) {}

  // ─── Settings (config) ──────────────────────────────────────────────────────

  async ensureSettings(): Promise<WhatsappSettings> {
    const existing = await this.prisma.whatsappSettings.findFirst();
    if (existing) return existing;
    return this.prisma.whatsappSettings.create({
      data: {
        instanceName: this.config.get<string>('EVOLUTION_INSTANCE_NAME') ?? '',
        messageTemplate: DEFAULT_TEMPLATE,
        delayMinSeconds:
          this.config.get<number>('WHATSAPP_DELAY_MIN_SECONDS') ?? 20,
        delayMaxSeconds:
          this.config.get<number>('WHATSAPP_DELAY_MAX_SECONDS') ?? 90,
        maxAttempts: this.config.get<number>('WHATSAPP_MAX_ATTEMPTS') ?? 5,
        maxWaitConnectionMinutes:
          this.config.get<number>('WHATSAPP_MAX_WAIT_CONNECTION_MINUTES') ??
          1440,
        failureCooldownSeconds:
          this.config.get<number>('WHATSAPP_DISCONNECT_COOLDOWN_SECONDS') ??
          300,
      },
    });
  }

  getSettings(): Promise<WhatsappSettings> {
    return this.ensureSettings();
  }

  async updateSettings(input: UpdateSettingsInput): Promise<WhatsappSettings> {
    const current = await this.ensureSettings();
    if (input.messageTemplate !== undefined) {
      validateTemplate(input.messageTemplate);
    }
    const data: Prisma.WhatsappSettingsUpdateInput = {};
    if (input.selectedGroupId !== undefined)
      data.selectedGroupId = input.selectedGroupId;
    if (input.selectedGroupName !== undefined)
      data.selectedGroupName = input.selectedGroupName;
    if (input.messageTemplate !== undefined)
      data.messageTemplate = input.messageTemplate;
    if (input.sendMedia !== undefined) data.sendMedia = input.sendMedia;
    if (input.delayMinSeconds !== undefined)
      data.delayMinSeconds = input.delayMinSeconds;
    if (input.delayMaxSeconds !== undefined)
      data.delayMaxSeconds = input.delayMaxSeconds;
    if (input.maxAttempts !== undefined) data.maxAttempts = input.maxAttempts;
    if (input.maxWaitConnectionMinutes !== undefined)
      data.maxWaitConnectionMinutes = input.maxWaitConnectionMinutes;
    if (input.failureCooldownSeconds !== undefined)
      data.failureCooldownSeconds = input.failureCooldownSeconds;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.linkPoolAlertNumber !== undefined)
      data.linkPoolAlertNumber = input.linkPoolAlertNumber;
    if (input.linkPoolAlertThreshold !== undefined)
      data.linkPoolAlertThreshold = input.linkPoolAlertThreshold;
    if (input.linkPoolAlertEnabled !== undefined)
      data.linkPoolAlertEnabled = input.linkPoolAlertEnabled;

    return this.prisma.whatsappSettings.update({
      where: { id: current.id },
      data,
    });
  }

  async setSelectedGroup(id: string, name: string): Promise<WhatsappSettings> {
    return this.updateSettings({
      selectedGroupId: id,
      selectedGroupName: name,
    });
  }

  async setInstanceToken(token: string | null): Promise<void> {
    const current = await this.ensureSettings();
    await this.prisma.whatsappSettings.update({
      where: { id: current.id },
      data: { instanceToken: token },
    });
  }

  // ─── Connection state (runtime) ──────────────────────────────────────────────

  async ensureConnectionState(): Promise<WhatsappConnectionState> {
    const existing = await this.prisma.whatsappConnectionState.findFirst();
    if (existing) return existing;
    return this.prisma.whatsappConnectionState.create({ data: {} });
  }

  getConnectionState(): Promise<WhatsappConnectionState> {
    return this.ensureConnectionState();
  }

  async updateConnectionState(
    patch: Prisma.WhatsappConnectionStateUpdateInput,
  ): Promise<WhatsappConnectionState> {
    const current = await this.ensureConnectionState();
    return this.prisma.whatsappConnectionState.update({
      where: { id: current.id },
      data: patch,
    });
  }

  // ─── Resolução do token da instância ─────────────────────────────────────────

  /**
   * Token da instância (header das chamadas instance-scoped: /status, /qr,
   * /group, /send/*). A key GLOBAL recebe 401 nesses endpoints. Se ainda não
   * estiver salvo, resolve via /instance/all (key global) pelo nome, cacheia em
   * `settings.instanceToken` e atualiza o phone do connection-state.
   */
  async resolveInstanceToken(): Promise<string | undefined> {
    const s = await this.getSettings();
    if (s.instanceToken) return s.instanceToken;
    const name = s.instanceName || this.evolution.instanceName;
    if (!name) return undefined;
    try {
      const inst = await this.evolution.findInstance(name);
      if (inst?.token) {
        await this.setInstanceToken(inst.token);
        if (inst.phone) {
          await this.updateConnectionState({ phoneNumber: inst.phone });
        }
        return inst.token;
      }
    } catch (err) {
      this.logger.warn(
        `Falha ao resolver token da instância: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return undefined;
  }
}
