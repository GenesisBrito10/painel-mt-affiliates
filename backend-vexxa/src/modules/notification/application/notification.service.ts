import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Notification, PushSubscription } from '@prisma/client';
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
  type NotificationCreateData,
} from '../domain/ports/notification.repository.js';
import {
  NotificationNotFoundException,
  NotificationAccessDeniedException,
  PushSubscriptionAlreadyExistsException,
  PushSubscriptionNotFoundException,
} from '../domain/exceptions/notification.exceptions.js';
import {
  NOTIFICATION_QUEUE,
  PUSH_BATCH_JOB,
} from '../domain/types/notification.types.js';
import type { ListNotificationsDto } from './dto/list-notifications.dto.js';
import type { BroadcastNotificationDto } from './dto/broadcast-notification.dto.js';
import type { RegisterPushSubscriptionDto } from './dto/push-subscription.dto.js';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly queue: Queue,
  ) {}

  // ─── List notifications for the authenticated user ───────────────────────

  async listByUser(
    userId: string,
    dto: ListNotificationsDto,
  ): Promise<{ data: Notification[]; total: number; nextCursor: string | null }> {
    return this.repo.findByUser({
      userId,
      read: dto.read,
      type: dto.type,
      cursor: dto.cursor,
      limit: dto.limit,
    });
  }

  // ─── Unread count ─────────────────────────────────────────────────────────

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.repo.countUnread(userId);
    return { count };
  }

  // ─── Create single notification (cross-module use) ────────────────────────

  async create(input: NotificationCreateData): Promise<Notification> {
    const notification = await this.repo.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata,
    });

    // Dispatch push notification fire-and-forget
    this.queue
      .add(PUSH_BATCH_JOB, {
        userIds: [input.userId],
        payload: this.buildPushPayload(input.title, input.message),
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `Push dispatch failed for user ${input.userId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    return notification;
  }

  // ─── Create many notifications (cross-module batch use) ──────────────────

  async createMany(inputs: NotificationCreateData[]): Promise<number> {
    if (inputs.length === 0) return 0;

    const count = await this.repo.createMany(inputs);

    // Dispatch push for all unique users fire-and-forget
    const uniqueUserIds = [...new Set(inputs.map((i) => i.userId))];
    if (uniqueUserIds.length > 0 && inputs[0]) {
      this.queue
        .add(PUSH_BATCH_JOB, {
          userIds: uniqueUserIds,
          payload: this.buildPushPayload(inputs[0].title, inputs[0].message),
        })
        .catch((err: unknown) =>
          this.logger.warn(
            `Batch push dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    return count;
  }

  // ─── Broadcast to all active affiliates (admin only) ─────────────────────

  async broadcast(dto: BroadcastNotificationDto): Promise<{ count: number }> {
    const userIds = await this.repo.findActiveAffiliateIds();

    if (userIds.length === 0) {
      this.logger.warn('Broadcast called but no active affiliates found');
      return { count: 0 };
    }

    const data: NotificationCreateData[] = userIds.map((userId) => ({
      userId,
      type: dto.type,
      title: dto.title,
      message: dto.message,
      metadata: dto.metadata,
    }));

    const count = await this.repo.createMany(data);

    // Enqueue push batch via BullMQ
    await this.queue.add(PUSH_BATCH_JOB, {
      userIds,
      payload: this.buildPushPayload(dto.title, dto.message),
    });

    this.logger.log(`Broadcast sent to ${count} affiliates`);
    return { count };
  }

  // ─── Mark single notification as read ────────────────────────────────────

  async markAsRead(userId: string, notificationId: string): Promise<Notification> {
    const notification = await this.repo.findById(notificationId);

    if (!notification) throw new NotificationNotFoundException(notificationId);
    if (notification.userId !== userId) throw new NotificationAccessDeniedException();

    return this.repo.markAsRead(notificationId);
  }

  // ─── Mark all as read ─────────────────────────────────────────────────────

  async markAllAsRead(userId: string): Promise<{ count: number }> {
    const count = await this.repo.markAllAsRead(userId);
    return { count };
  }

  // ─── Delete notification ──────────────────────────────────────────────────

  async delete(userId: string, notificationId: string): Promise<void> {
    const notification = await this.repo.findById(notificationId);

    if (!notification) throw new NotificationNotFoundException(notificationId);
    if (notification.userId !== userId) throw new NotificationAccessDeniedException();

    await this.repo.delete(notificationId);
  }

  // ─── Push subscriptions ───────────────────────────────────────────────────

  async registerPush(
    userId: string,
    dto: RegisterPushSubscriptionDto,
  ): Promise<PushSubscription> {
    const existing = await this.repo.findPushSubscriptionByEndpoint(userId, dto.endpoint);

    if (existing) throw new PushSubscriptionAlreadyExistsException();

    return this.repo.createPushSubscription({
      userId,
      endpoint: dto.endpoint,
      p256dh: dto.p256dh,
      auth: dto.auth,
    });
  }

  async removePush(userId: string, subscriptionId: string): Promise<void> {
    const subscriptions = await this.repo.findPushSubscriptionsByUser(userId);
    const sub = subscriptions.find((s) => s.id === subscriptionId);

    if (!sub) throw new PushSubscriptionNotFoundException(subscriptionId);

    await this.repo.deletePushSubscription(subscriptionId);
  }

  // ─── Internal helpers (used by processor) ─────────────────────────────────

  async getPushSubscriptionsForUsers(userIds: string[]): Promise<PushSubscription[]> {
    return this.repo.findPushSubscriptionsByUsers(userIds);
  }

  async deletePushSubscriptionById(id: string): Promise<void> {
    await this.repo.deletePushSubscription(id);
  }

  async deleteOlderThan(days: number): Promise<number> {
    return this.repo.deleteOlderThan(days);
  }

  async getSnapshotData(
    userId: string,
    bettingHouse: string,
  ) {
    return this.repo.findSnapshot(userId, bettingHouse);
  }

  async upsertSnapshot(data: {
    userId: string;
    bettingHouse: string;
    clicks: number;
    registrations: number;
    ftds: number;
    cpaQualified: number;
  }) {
    return this.repo.upsertSnapshot(data);
  }

  async deleteByPrizeId(prizeId: string, userIds: string[]): Promise<number> {
    return this.repo.deleteByMetadata(prizeId, userIds);
  }

  // ─── Send test push notification to the caller ───────────────────────────

  async sendTestPush(userId: string): Promise<{ sent: number }> {
    const subscriptions = await this.repo.findPushSubscriptionsByUser(userId);

    if (subscriptions.length === 0) {
      return { sent: 0 };
    }

    await this.queue.add(PUSH_BATCH_JOB, {
      userIds: [userId],
      payload: {
        title: '🔔 MT Affiliates',
        body: 'Notificações push ativadas com sucesso!',
      },
    });

    return { sent: subscriptions.length };
  }

  async findActiveAffiliateIds(): Promise<string[]> {
    return this.repo.findActiveAffiliateIds();
  }

  private buildPushPayload(title: string, message: string): { title: string; body: string } {
    return {
      title: this.stripEmailsForPush(title),
      body: this.stripEmailsForPush(message),
    };
  }

  private stripEmailsForPush(text: string): string {
    return text
      .replace(/\s*\([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\)/gi, '')
      .replace(this.emailPattern, '')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/\(\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}
