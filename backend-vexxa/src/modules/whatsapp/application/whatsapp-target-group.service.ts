import { Injectable, Logger } from '@nestjs/common';
import type { WhatsappTargetGroup } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EvolutionClient } from '../infrastructure/clients/evolution.client.js';
import { WhatsappSettingsService } from './whatsapp-settings.service.js';

/**
 * Gerencia o conjunto de grupos/comunidades de destino dos comprovantes. O MESMO
 * comprovante é enviado para TODOS. `groupId` é @unique no banco → não há grupo
 * repetido. Ao adicionar, busca a foto do grupo na Evolution p/ exibir no admin.
 */
@Injectable()
export class WhatsappTargetGroupService {
  private readonly logger = new Logger(WhatsappTargetGroupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionClient,
    private readonly settingsService: WhatsappSettingsService,
  ) {}

  list(): Promise<WhatsappTargetGroup[]> {
    return this.prisma.whatsappTargetGroup.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Adiciona (ou atualiza) um grupo. Upsert por groupId → dedupe automático. */
  async add(groupId: string, name: string): Promise<WhatsappTargetGroup> {
    const pictureUrl = await this.resolvePhoto(groupId);
    return this.prisma.whatsappTargetGroup.upsert({
      where: { groupId },
      create: { groupId, name, pictureUrl },
      update: { name, ...(pictureUrl ? { pictureUrl } : {}) },
    });
  }

  async remove(groupId: string): Promise<void> {
    await this.prisma.whatsappTargetGroup
      .delete({ where: { groupId } })
      .catch(() => undefined); // idempotente — já removido
  }

  /** Re-busca a foto de um grupo já salvo. */
  async refreshPhoto(groupId: string): Promise<WhatsappTargetGroup | null> {
    const pictureUrl = await this.resolvePhoto(groupId);
    if (!pictureUrl) return null;
    return this.prisma.whatsappTargetGroup.update({
      where: { groupId },
      data: { pictureUrl },
    });
  }

  private async resolvePhoto(groupId: string): Promise<string | null> {
    try {
      const token = await this.settingsService.resolveInstanceToken();
      return await this.evolution.getGroupPhoto(groupId, token);
    } catch (err) {
      this.logger.warn(
        `Falha ao buscar foto do grupo ${groupId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
