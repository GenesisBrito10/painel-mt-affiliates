import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../../../auth/index.js';
import { SupportChatEvents } from '../../application/support-chat-events.service.js';
import { SupportChatService } from '../../application/support-chat.service.js';
import { createSocketAuthMiddleware } from './socket-auth.middleware.js';

@WebSocketGateway({
  namespace: '/support',
  path: '/api/socket.io',
  cors: false,
  transports: ['websocket', 'polling'],
})
export class SupportChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private eventsSubscription?: Subscription;
  private readonly supportSocketsByAgent = new Map<string, Set<string>>();

  constructor(
    private readonly supportChat: SupportChatService,
    private readonly jwtService: JwtService,
    private readonly events: SupportChatEvents,
  ) {}

  afterInit(server: Server): void {
    server.use(createSocketAuthMiddleware(this.jwtService));
    this.eventsSubscription?.unsubscribe();
    this.eventsSubscription = this.events.events$.subscribe((event) => {
      if (event.type === 'message:new') {
        this.server
          .to(`conversation:${event.message.conversationId}`)
          .to('admin:support')
          .emit('message:new', event.message);
        return;
      }

      if (event.type === 'message:updated') {
        this.server
          .to(`conversation:${event.message.conversationId}`)
          .to('admin:support')
          .emit('message:updated', event.message);
        return;
      }

      if (event.type === 'conversation:closed') {
        this.server
          .to(`conversation:${event.conversation.id}`)
          .to('admin:support')
          .emit('conversation:closed', event.conversation);
        return;
      }

      if (event.type === 'conversation:updated') {
        let target = this.server
          .to(`conversation:${event.conversation.id}`)
          .to('admin:support');
        if (event.conversation.agentId) {
          target = target.to(`agent:${event.conversation.agentId}`);
        }
        target.emit('conversation:updated', event.conversation);
        return;
      }

      if (event.type === 'conversation:reopened') {
        let target = this.server
          .to(`conversation:${event.conversation.id}`)
          .to('admin:support');
        if (event.conversation.agentId) {
          target = target.to(`agent:${event.conversation.agentId}`);
        }
        target.emit('conversation:reopened', event.conversation);
        return;
      }

      if (event.type === 'conversation:created') {
        this.server.to('admin:support').emit('conversation:created', event.conversation);
        if (event.conversation.agentId) {
          this.server
            .to(`agent:${event.conversation.agentId}`)
            .emit('conversation:assigned', event.conversation);
        }
        return;
      }

      if (event.type === 'conversation:assigned') {
        let target = this.server
          .to('admin:support')
          .to(`conversation:${event.conversation.id}`);
        if (event.conversation.agentId) {
          target = target.to(`agent:${event.conversation.agentId}`);
        }
        target.emit('conversation:assigned', event.conversation);
        return;
      }

      this.server.to('admin:support').emit('agent:status-changed', event.status);
      this.server.to(`agent:${event.status.agentId}`).emit('agent:status-changed', event.status);
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const user = client.data['user'] as JwtPayload | undefined;
    if (!user) {
      client.disconnect(true);
      return;
    }

    if (user.role === UserRole.SUPPORT) {
      await client.join(`agent:${user.sub}`);
      this.trackSupportSocket(user.sub, client.id);
      await this.supportChat.setAgentAvailability(user.sub, true);
    }

    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN) {
      await client.join('admin:support');
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const user = client.data['user'] as JwtPayload | undefined;
    if (!user || user.role !== UserRole.SUPPORT) {
      return;
    }

    this.untrackSupportSocket(user.sub, client.id);
    if (this.supportSocketsByAgent.get(user.sub)?.size) {
      return;
    }

    await this.supportChat.setAgentAvailability(user.sub, false);
  }

  @SubscribeMessage('conversation:join')
  async handleConversationJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const user = this.getUser(client);
    await this.supportChat.getConversationForUser(data.conversationId, user);
    await client.join(`conversation:${data.conversationId}`);
  }

  @SubscribeMessage('conversation:leave')
  async handleConversationLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    await client.leave(`conversation:${data.conversationId}`);
  }

  @SubscribeMessage('message:send')
  async handleMessageSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      conversationId: string;
      content?: string;
      attachmentUrl?: string;
      attachmentMimeType?: string;
      attachmentName?: string;
      attachmentSize?: number;
    },
  ): Promise<void> {
    const user = this.getUser(client);
    const { conversationId, ...payload } = data;
    await this.supportChat.sendMessage(conversationId, user, payload);
  }

  @SubscribeMessage('message:edit')
  async handleMessageEdit(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      conversationId: string;
      messageId: string;
      content: string;
    },
  ): Promise<void> {
    const user = this.getUser(client);
    await this.supportChat.editMessage(
      data.conversationId,
      data.messageId,
      user,
      data.content,
    );
  }

  @SubscribeMessage('conversation:close')
  async handleConversationClose(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const user = this.getUser(client);
    await this.supportChat.closeConversation(
      data.conversationId,
      user,
    );
  }

  @SubscribeMessage('agent:set-available')
  async handleAgentSetAvailable(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { available: boolean },
  ): Promise<void> {
    const user = this.getUser(client);
    if (user.role !== UserRole.SUPPORT) return;

    await this.supportChat.setAgentAvailability(
      user.sub,
      Boolean(data.available),
    );
  }

  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const user = this.getUser(client);
    await this.supportChat.getConversationForUser(data.conversationId, user);
    client.to(`conversation:${data.conversationId}`).emit('typing:started', {
      conversationId: data.conversationId,
      userId: user.sub,
    });
  }

  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ): Promise<void> {
    const user = this.getUser(client);
    await this.supportChat.getConversationForUser(data.conversationId, user);
    client.to(`conversation:${data.conversationId}`).emit('typing:stopped', {
      conversationId: data.conversationId,
      userId: user.sub,
    });
  }

  private getUser(client: Socket): JwtPayload {
    return client.data['user'] as JwtPayload;
  }

  private trackSupportSocket(agentId: string, socketId: string): void {
    const sockets = this.supportSocketsByAgent.get(agentId) ?? new Set<string>();
    sockets.add(socketId);
    this.supportSocketsByAgent.set(agentId, sockets);
  }

  private untrackSupportSocket(agentId: string, socketId: string): void {
    const sockets = this.supportSocketsByAgent.get(agentId);
    if (!sockets) return;
    sockets.delete(socketId);
    if (!sockets.size) {
      this.supportSocketsByAgent.delete(agentId);
    }
  }
}
