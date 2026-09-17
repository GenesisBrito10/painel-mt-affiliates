import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type {
  INotificationRepository,
  NotificationFilters,
  PaginatedNotifications,
  NotificationCreateData,
} from '../../domain/ports/notification.repository.js';
import type {
  Notification,
  NotificationSnapshot,
  PushSubscription,
} from '@prisma/client';

@Injectable()
export class NotificationPrismaRepository implements INotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Notification CRUD ────────────────────────────────────────────────────

  async findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  async findByUser(filters: NotificationFilters): Promise<PaginatedNotifications> {
    const limit = filters.limit ?? 20;

    const where = {
      userId: filters.userId,
      ...(filters.read !== undefined && { read: filters.read }),
      ...(filters.type && { type: filters.type }),
    };

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(filters.cursor && {
          cursor: { id: filters.cursor },
          skip: 1,
        }),
      }),
      this.prisma.notification.count({ where: { userId: filters.userId } }),
    ]);

    const hasNextPage = data.length > limit;
    const items = hasNextPage ? data.slice(0, limit) : data;
    const nextCursor = hasNextPage ? (items[items.length - 1]?.id ?? null) : null;

    return { data: items, total, nextCursor };
  }

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  async create(data: NotificationCreateData): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (data.metadata ?? null) as any,
      },
    });
  }

  async createMany(data: NotificationCreateData[]): Promise<number> {
    const result = await this.prisma.notification.createMany({
      data: data.map((d) => ({
        userId: d.userId,
        type: d.type,
        title: d.title,
        message: d.message,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (d.metadata ?? null) as any,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async markAsRead(id: string): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return result.count;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.notification.delete({ where: { id } });
  }

  async deleteOlderThan(days: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const result = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }

  async deleteByMetadata(prizeId: string, userIds: string[]): Promise<number> {
    const result = await this.prisma.notification.deleteMany({
      where: {
        userId: { in: userIds },
        metadata: { path: ['prizeId'], equals: prizeId },
      },
    });
    return result.count;
  }

  // ─── PushSubscription ─────────────────────────────────────────────────────

  async findPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]> {
    return this.prisma.pushSubscription.findMany({ where: { userId } });
  }

  async findPushSubscriptionsByUsers(userIds: string[]): Promise<PushSubscription[]> {
    return this.prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
    });
  }

  async findPushSubscriptionByEndpoint(
    userId: string,
    endpoint: string,
  ): Promise<PushSubscription | null> {
    return this.prisma.pushSubscription.findUnique({
      where: { userId_endpoint: { userId, endpoint } },
    });
  }

  async createPushSubscription(data: {
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }): Promise<PushSubscription> {
    return this.prisma.pushSubscription.create({ data });
  }

  async deletePushSubscription(id: string): Promise<void> {
    await this.prisma.pushSubscription.delete({ where: { id } });
  }

  // ─── NotificationSnapshot ─────────────────────────────────────────────────

  async findSnapshot(userId: string, bettingHouse: string): Promise<NotificationSnapshot | null> {
    return this.prisma.notificationSnapshot.findUnique({
      where: { userId_bettingHouse: { userId, bettingHouse } },
    });
  }

  async upsertSnapshot(data: {
    userId: string;
    bettingHouse: string;
    clicks: number;
    registrations: number;
    ftds: number;
    cpaQualified: number;
  }): Promise<NotificationSnapshot> {
    return this.prisma.notificationSnapshot.upsert({
      where: { userId_bettingHouse: { userId: data.userId, bettingHouse: data.bettingHouse } },
      create: {
        userId: data.userId,
        bettingHouse: data.bettingHouse,
        clicks: data.clicks,
        registrations: data.registrations,
        ftds: data.ftds,
        cpaQualified: data.cpaQualified,
        lastCheckedAt: new Date(),
      },
      update: {
        clicks: data.clicks,
        registrations: data.registrations,
        ftds: data.ftds,
        cpaQualified: data.cpaQualified,
        lastCheckedAt: new Date(),
      },
    });
  }

  // ─── Broadcast helpers ────────────────────────────────────────────────────

  async findActiveAffiliateIds(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        role: 'AFFILIATE',
        status: 'APPROVED',
        deletedAt: null,
      },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}
