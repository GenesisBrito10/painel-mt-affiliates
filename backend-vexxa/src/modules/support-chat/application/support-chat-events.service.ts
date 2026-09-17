import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type {
  SupportAgentAvailabilityDto,
  SupportConversationDto,
  SupportMessageDto,
} from '../domain/types/support-chat.types.js';

export type SupportChatEvent =
  | { type: 'conversation:created'; conversation: SupportConversationDto }
  | { type: 'conversation:assigned'; conversation: SupportConversationDto }
  | { type: 'conversation:updated'; conversation: SupportConversationDto }
  | { type: 'conversation:reopened'; conversation: SupportConversationDto }
  | { type: 'conversation:closed'; conversation: SupportConversationDto }
  | { type: 'message:new'; message: SupportMessageDto }
  | { type: 'message:updated'; message: SupportMessageDto }
  | { type: 'agent:status-changed'; status: SupportAgentAvailabilityDto };

@Injectable()
export class SupportChatEvents {
  private readonly eventsSubject = new Subject<SupportChatEvent>();

  readonly events$ = this.eventsSubject.asObservable();

  emit(event: SupportChatEvent): void {
    this.eventsSubject.next(event);
  }
}
