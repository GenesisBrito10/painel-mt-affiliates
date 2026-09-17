import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { isWithinBusinessHours } from '../domain/business-hours.util.js';
import { SupportChatService } from './support-chat.service.js';

@Injectable()
export class SupportChatTimeoutService {
  private readonly logger = new Logger(SupportChatTimeoutService.name);

  constructor(private readonly supportChat: SupportChatService) {}

  /** Verifica conversas WAITING_USER sem resposta há mais de 1 hora, a cada 5 min nos dias úteis */
  @Cron('*/5 * * * 1-5', { name: 'support-chat-timeout-waiting-user' })
  async closeTimedOutConversations(): Promise<void> {
    if (!isWithinBusinessHours()) return;

    try {
      const closed = await this.supportChat.autoCloseTimedOutConversations();
      if (closed > 0) {
        this.logger.log(
          `Auto-closed ${closed} WAITING_USER conversation(s) due to 1-hour inactivity timeout.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Timeout auto-close failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Drains the WAITING queue at the start of each business-hours window
   * so conversations that arrived outside business hours are assigned
   * as soon as agents become available.
   *
   * Fires at 09:00 (morning opening) and 14:00 (afternoon opening),
   * Monday–Friday, America/Sao_Paulo.
   */
  @Cron('0 9 * * 1-5', { name: 'support-chat-drain-queue-morning', timeZone: 'America/Sao_Paulo' })
  async drainQueueMorning(): Promise<void> {
    await this.drainQueue('morning');
  }

  @Cron('0 14 * * 1-5', { name: 'support-chat-drain-queue-afternoon', timeZone: 'America/Sao_Paulo' })
  async drainQueueAfternoon(): Promise<void> {
    await this.drainQueue('afternoon');
  }

  private async drainQueue(window: 'morning' | 'afternoon'): Promise<void> {
    try {
      await this.supportChat.assignWaitingConversations();
      this.logger.log(`Queue drained at ${window} opening.`);
    } catch (error) {
      this.logger.error(
        `Queue drain failed at ${window} opening: ${(error as Error).message}`,
      );
    }
  }
}
