import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupportChatService } from './support-chat.service.js';

@Injectable()
export class SupportChatBusinessHoursService {
  private readonly logger = new Logger(SupportChatBusinessHoursService.name);

  constructor(private readonly supportChat: SupportChatService) {}

  /** End of morning shift — 12:00 BRT (15:00 UTC), Mon–Fri */
  @Cron('0 15 * * 1-5', { name: 'support-chat-close-waiting-noon' })
  async closeWaitingAtNoon(): Promise<void> {
    await this.run('noon');
  }

  /** End of afternoon shift — 18:00 BRT (21:00 UTC), Mon–Fri */
  @Cron('0 21 * * 1-5', { name: 'support-chat-close-waiting-evening' })
  async closeWaitingAtEvening(): Promise<void> {
    await this.run('evening');
  }

  private async run(shift: 'noon' | 'evening'): Promise<void> {
    try {
      const closed = await this.supportChat.autoCloseWaitingConversations();
      if (closed > 0) {
        this.logger.log(
          `Auto-closed ${closed} WAITING conversation(s) at end of ${shift} shift.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Business-hours auto-close failed (${shift}): ${(error as Error).message}`,
      );
    }
  }
}
