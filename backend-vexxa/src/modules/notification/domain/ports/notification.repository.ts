import type {
  Notification,
  NotificationSnapshot,
  PushSubscription,
  NotificationType,
} from '@prisma/client';

// ─── Injection Token ──────────────────────────────────────────────────────────

export const NOTIFICATION_REPOSITORY = Symbol('INotificationRepository');

// ─── Query Filters ────────────────────────────────────────────────────────────

export interface NotificationFilters {
  userId: string;
  read?: boolean;
  type?: NotificationType;
  cursor?: string;
  limit?: number;
}

export interface PaginatedNotifications {
  data: Notification[];
  total: number;
  nextCursor: string | null;
}

// ─── Create Input ─────────────────────────────────────────────────────────────

export interface NotificationCreateData {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// ─── Repository Port ──────────────────────────────────────────────────────────

export interface INotificationRepository {
  // Notification CRUD
  findById(id: string): Promise<Notification | null>;
  findByUser(filters: NotificationFilters): Promise<PaginatedNotifications>;
  countUnread(userId: string): Promise<number>;
  create(data: NotificationCreateData): Promise<Notification>;
  createMany(data: NotificationCreateData[]): Promise<number>;
  markAsRead(id: string): Promise<Notification>;
  markAllAsRead(userId: string): Promise<number>;
  delete(id: string): Promise<void>;
  deleteOlderThan(days: number): Promise<number>;
  deleteByMetadata(prizeId: string, userIds: string[]): Promise<number>;

  // PushSubscription
  findPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]>;
  findPushSubscriptionsByUsers(userIds: string[]): Promise<PushSubscription[]>;
  findPushSubscriptionByEndpoint(userId: string, endpoint: string): Promise<PushSubscription | null>;
  createPushSubscription(data: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }): Promise<PushSubscription>;
  deletePushSubscription(id: string): Promise<void>;

  // NotificationSnapshot
  findSnapshot(userId: string, bettingHouse: string): Promise<NotificationSnapshot | null>;
  upsertSnapshot(data: {
    userId: string;
    bettingHouse: string;
    clicks: number;
    registrations: number;
    ftds: number;
    cpaQualified: number;
  }): Promise<NotificationSnapshot>;

  // Broadcast helper
  findActiveAffiliateIds(): Promise<string[]>;
}
