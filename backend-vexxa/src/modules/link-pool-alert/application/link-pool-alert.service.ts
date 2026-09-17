import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../shared/shared.module.js';
import { NotificationService } from '../../notification/index.js';
import { EvolutionClient } from '../../whatsapp/infrastructure/clients/evolution.client.js';
import { WhatsappSettingsService } from '../../whatsapp/application/whatsapp-settings.service.js';

/**
 * Alerta de "planilha de links cheia" (sem links livres) por casa.
 *
 * Cada scheduler chama `checkPool(slug, houseName, freeCount)` por ciclo. Quando
 * os links livres caem até o limite configurado (`linkPoolAlertThreshold`),
 * dispara **uma única vez**: mensagem WhatsApp pro número configurado +
 * notificação push pros admins. O "uma vez" é garantido por uma flag no Redis
 * (`linkpool:alert:{slug}`), que é apagada quando a planilha é reabastecida
 * (`freeCount > threshold`) — re-armando o alerta pro próximo esvaziamento.
 *
 * Nunca lança: qualquer falha (Redis, Evolution, push) é logada e engolida pra
 * não derrubar o backfill que o chamou.
 */
@Injectable()
export class LinkPoolAlertService {
  private readonly logger = new Logger(LinkPoolAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: WhatsappSettingsService,
    private readonly evolution: EvolutionClient,
    private readonly notifications: NotificationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private alertKey(slug: string): string {
    return `linkpool:alert:${slug}`;
  }

  async checkPool(
    slug: string,
    houseName: string,
    freeCount: number,
  ): Promise<void> {
    try {
      const cfg = await this.settings.getSettings();
      if (!cfg.linkPoolAlertEnabled) return;

      const threshold = cfg.linkPoolAlertThreshold ?? 0;
      const key = this.alertKey(slug);

      if (freeCount > threshold) {
        // Reabastecida (acima do limite) → re-arma o alerta.
        await this.redis.del(key);
        return;
      }

      // Abaixo/no limite → arma a flag de forma atômica. Se já existia, já
      // avisamos antes — não reenvia.
      const armed = await this.redis.set(key, '1', 'NX');
      if (armed !== 'OK') return;

      this.logger.warn(
        `Pool ${slug} atingiu o limite (livres=${freeCount} <= ${threshold}) — disparando alerta`,
      );

      const [waSent] = await Promise.all([
        this.sendWhatsapp(cfg.linkPoolAlertNumber, houseName, freeCount),
        this.notifyAdmins(houseName, freeCount),
      ]);

      // Se o WhatsApp falhou (número inválido, instância fora), libera a flag
      // pra tentar de novo no próximo ciclo — senão uma falha suprimiria o
      // alerta até a planilha ser reabastecida.
      if (!waSent) await this.redis.del(key);
    } catch (err) {
      this.logger.error(
        `Falha ao checar/alertar pool ${slug}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async sendWhatsapp(
    number: string | null,
    houseName: string,
    freeCount: number,
  ): Promise<boolean> {
    if (!number) return false;
    try {
      const token = await this.settings.resolveInstanceToken();
      // Normaliza o número (DDI 55 + quirk do 9º dígito) e confirma que existe
      // no WhatsApp antes de enviar. Mesma forma usada na validação do painel.
      const target = await this.evolution.resolveBrNumber(number, token);
      if (!target) {
        this.logger.warn(
          `Alerta WhatsApp não enviado (${houseName}): número '${number}' não existe no WhatsApp`,
        );
        return false;
      }
      const text =
        `⚠️ *Links esgotados — ${houseName}*\n\n` +
        `A planilha de links da ${houseName} está sem links livres ` +
        `(restam ${freeCount}). Reabasteça a planilha para liberar novas ` +
        `solicitações de afiliados.`;
      await this.evolution.sendText({
        number: target,
        text,
        instanceToken: token,
      });
      this.logger.log(`Alerta WhatsApp enviado para ${target} (${houseName})`);
      return true;
    } catch (err) {
      this.logger.warn(
        `Falha ao enviar alerta WhatsApp (${houseName}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private async notifyAdmins(
    houseName: string,
    freeCount: number,
  ): Promise<void> {
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
          type: NotificationType.LINK_POOL_FULL,
          title: `📋 Links esgotados — ${houseName}`,
          message: `A planilha de links da ${houseName} ficou sem links livres (restam ${freeCount}). Reabasteça para liberar novas solicitações.`,
          metadata: { source: 'link-pool-alert', house: houseName, freeCount },
        })),
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `Falha ao notificar admins do pool cheio (${houseName}): ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    this.logger.log(
      `Notificado pool cheio (${houseName}) a ${admins.length} admin(s)`,
    );
  }
}
