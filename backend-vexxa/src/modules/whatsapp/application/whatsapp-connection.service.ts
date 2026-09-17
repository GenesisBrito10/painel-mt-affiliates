import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationService } from '../../notification/index.js';
import { EvolutionClient } from '../infrastructure/clients/evolution.client.js';
import { WhatsappSettingsService } from './whatsapp-settings.service.js';
import type {
  EvolutionGroup,
  WhatsappConnectionStatus,
} from '../domain/types/whatsapp.types.js';

const DEFAULT_SUBSCRIBE = ['connection.update', 'CONNECTION_UPDATE'];

export interface ConnectionView {
  status: WhatsappConnectionStatus;
  instanceName: string;
  phoneNumber: string | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  circuitOpenUntil: Date | null;
  consecutiveFailures: number;
  selectedGroupId: string | null;
  selectedGroupName: string | null;
  enabled: boolean;
}

/**
 * Conexão da instância única: create/connect/qr/status/reconnect/disconnect +
 * listagem de grupos. Centraliza a aplicação de novo status (poll/manual) e a
 * notificação de desconexão (com cooldown).
 */
@Injectable()
export class WhatsappConnectionService {
  private readonly logger = new Logger(WhatsappConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly evolution: EvolutionClient,
    private readonly settingsService: WhatsappSettingsService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Token da instância (header das chamadas instance-scoped). Se ainda não
   * estiver salvo, resolve via /instance/all (key global) por nome e cacheia.
   */
  private async instanceToken(): Promise<string | undefined> {
    return this.settingsService.resolveInstanceToken();
  }

  private buildWebhookUrl(): string | undefined {
    const base =
      this.config.get<string>('WHATSAPP_PUBLIC_API_URL') ??
      this.config.get<string>('APP_PUBLIC_URL');
    const token = this.config.get<string>('WHATSAPP_WEBHOOK_TOKEN');
    if (!base || !token) return undefined;
    return `${base.replace(/\/+$/, '')}/api/v1/webhooks/whatsapp?token=${encodeURIComponent(token)}`;
  }

  // ─── Connect / QR ─────────────────────────────────────────────────────────

  async connect(): Promise<{
    status: WhatsappConnectionStatus;
    qrcode?: string;
  }> {
    const settings = await this.settingsService.ensureSettings();
    const name = settings.instanceName || this.evolution.instanceName;

    // Cria a instância (idempotente — ignora erro de "já existe").
    try {
      const created = await this.evolution.createInstance(name);
      const token = pickToken(created);
      if (token) await this.settingsService.setInstanceToken(token);
    } catch (err) {
      this.logger.debug(
        `createInstance ignorado: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.evolution.connect({
      instanceToken: await this.instanceToken(),
      webhookUrl: this.buildWebhookUrl(),
      subscribe: DEFAULT_SUBSCRIBE,
    });

    const qr = await this.evolution.getQr(await this.instanceToken());
    const synced = await this.syncStatus();
    return { status: synced.status, qrcode: qr.qrcode };
  }

  async getQrCode(): Promise<{ qrcode?: string; pairingCode?: string }> {
    const qr = await this.evolution.getQr(await this.instanceToken());
    return { qrcode: qr.qrcode, pairingCode: qr.pairingCode };
  }

  async reconnect(): Promise<{ status: WhatsappConnectionStatus }> {
    await this.evolution.reconnect(await this.instanceToken());
    const synced = await this.syncStatus();
    return { status: synced.status };
  }

  async disconnect(): Promise<{ status: WhatsappConnectionStatus }> {
    await this.evolution.disconnect(await this.instanceToken());
    const synced = await this.syncStatus();
    return { status: synced.status };
  }

  async listGroups(): Promise<EvolutionGroup[]> {
    return this.evolution.listGroups(await this.instanceToken());
  }

  // ─── Status sync (poll + manual) ────────────────────────────────────────────

  /** Busca status na Evolution, persiste e dispara notificação de desconexão. */
  async syncStatus(): Promise<ConnectionView> {
    let status: WhatsappConnectionStatus = 'error';
    let phone: string | null = null;
    try {
      const res = await this.evolution.getStatus(await this.instanceToken());
      status = res.status;
      phone = res.phoneNumber;
    } catch (err) {
      this.logger.warn(
        `getStatus falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      status = 'error';
    }
    return this.applyStatus(status, phone);
  }

  /** Aplica novo status, detecta transição open→close e notifica admins. */
  async applyStatus(
    status: WhatsappConnectionStatus,
    phone: string | null,
  ): Promise<ConnectionView> {
    const prev = await this.settingsService.getConnectionState();
    const now = new Date();

    const patch: Parameters<
      WhatsappSettingsService['updateConnectionState']
    >[0] = { status };
    if (phone) patch.phoneNumber = phone;
    if (status === 'open' && prev.status !== 'open')
      patch.lastConnectedAt = now;
    if (status === 'close' && prev.status !== 'close')
      patch.lastDisconnectedAt = now;

    await this.settingsService.updateConnectionState(patch);

    // Transição open/connecting → close = desconexão → notifica (com cooldown).
    if (status === 'close' && prev.status !== 'close') {
      await this.notifyDisconnect(prev.lastDisconnectNotifiedAt);
    }

    return this.buildView();
  }

  private async notifyDisconnect(lastNotifiedAt: Date | null): Promise<void> {
    const cooldownSec =
      this.config.get<number>('WHATSAPP_DISCONNECT_COOLDOWN_SECONDS') ?? 1800;
    if (
      lastNotifiedAt &&
      Date.now() - lastNotifiedAt.getTime() < cooldownSec * 1000
    ) {
      return; // dentro do cooldown — evita spam
    }

    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.SUPERADMIN] },
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (admins.length === 0) return;

    await this.notifications
      .createMany(
        admins.map((a) => ({
          userId: a.id,
          type: NotificationType.WHATSAPP_DISCONNECTED,
          title: '⚠️ WhatsApp desconectado',
          message:
            'O número de WhatsApp usado para envio dos comprovantes foi desconectado. Reconecte o número para continuar os envios automáticos.',
        })),
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `Falha ao notificar admins da desconexão: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    await this.settingsService.updateConnectionState({
      lastDisconnectNotifiedAt: new Date(),
    });
    this.logger.log(`Notificada desconexão a ${admins.length} admin(s)`);
  }

  /** Notifica admins que o circuit breaker abriu (envios pausados). */
  async notifyCircuitOpen(consecutiveFailures: number): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.SUPERADMIN] },
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (admins.length === 0) return;
    await this.notifications
      .createMany(
        admins.map((a) => ({
          userId: a.id,
          type: NotificationType.GENERAL,
          title: '⛔ Envios de comprovante pausados',
          message: `Os envios automáticos de comprovante foram pausados após ${consecutiveFailures} falhas consecutivas. Verifique a conexão do WhatsApp.`,
        })),
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `Falha ao notificar circuit breaker: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /**
   * Limpa o token de instância cacheado e re-resolve via /instance/all. Usar
   * quando a instância foi reconectada/recriada na Evolution e o token salvo
   * ficou velho (todas as chamadas instance-scoped passam a dar 401). Após
   * limpar, busca o token novo pelo nome e sincroniza o status.
   */
  async refreshInstanceCache(): Promise<
    ConnectionView & { tokenResolved: boolean }
  > {
    await this.settingsService.setInstanceToken(null);
    const token = await this.settingsService.resolveInstanceToken();
    this.logger.log(
      `Cache da instância WhatsApp limpo — token ${token ? 're-resolvido' : 'NÃO resolvido'}`,
    );
    const view = await this.syncStatus();
    return { ...view, tokenResolved: !!token };
  }

  /** Zera o circuit breaker — retoma os envios imediatamente. */
  async resetCircuitBreaker(): Promise<ConnectionView> {
    await this.settingsService.updateConnectionState({
      circuitOpenUntil: null,
      consecutiveFailures: 0,
    });
    this.logger.log('Circuit breaker WhatsApp resetado manualmente');
    return this.buildView();
  }

  async buildView(): Promise<ConnectionView> {
    const [settings, state] = await Promise.all([
      this.settingsService.getSettings(),
      this.settingsService.getConnectionState(),
    ]);
    return {
      status: state.status as WhatsappConnectionStatus,
      instanceName: settings.instanceName || this.evolution.instanceName,
      phoneNumber: state.phoneNumber,
      lastConnectedAt: state.lastConnectedAt,
      lastDisconnectedAt: state.lastDisconnectedAt,
      circuitOpenUntil: state.circuitOpenUntil,
      consecutiveFailures: state.consecutiveFailures,
      selectedGroupId: settings.selectedGroupId,
      selectedGroupName: settings.selectedGroupName,
      enabled: settings.enabled,
    };
  }
}

function pickToken(raw: Record<string, unknown>): string | undefined {
  for (const k of ['token', 'apikey', 'hash', 'instanceToken']) {
    const v = raw[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const wrap of ['instance', 'data', 'result']) {
    const inner = raw[wrap];
    if (inner && typeof inner === 'object') {
      const found = pickToken(inner as Record<string, unknown>);
      if (found) return found;
    }
  }
  return undefined;
}
