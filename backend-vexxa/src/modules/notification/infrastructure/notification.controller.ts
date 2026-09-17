import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard, Roles, CurrentUser } from '../../auth/index.js';
import type { JwtPayload } from '../../auth/domain/auth.types.js';
import { NotificationService } from '../application/notification.service.js';
import { ListNotificationsDto } from '../application/dto/list-notifications.dto.js';
import { CreateNotificationDto } from '../application/dto/create-notification.dto.js';
import { BroadcastNotificationDto } from '../application/dto/broadcast-notification.dto.js';
import { RegisterPushSubscriptionDto } from '../application/dto/push-subscription.dto.js';
import { WebPushService } from './push/web-push.service.js';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ version: '1' })
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly webPushService: WebPushService,
  ) {}

  // ─── Affiliate endpoints ──────────────────────────────────────────────────

  @Get('notifications')
  @ApiOperation({ summary: 'List notifications for the authenticated user' })
  @ApiOkResponse({ description: 'Paginated notification list' })
  listNotifications(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notificationService.listByUser(user.sub, query);
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiOkResponse({ description: '{ count: number }' })
  getUnreadCount(@CurrentUser() user: JwtPayload) {
    return this.notificationService.getUnreadCount(user.sub);
  }

  @Get('notifications/vapid-public-key')
  @ApiOperation({ summary: 'Get VAPID public key for Web Push subscription' })
  @ApiOkResponse({ description: '{ publicKey: string }' })
  getVapidPublicKey() {
    return { publicKey: this.webPushService.getPublicKey() };
  }

  @Patch('notifications/read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiOkResponse({ description: '{ count: number }' })
  markAllAsRead(@CurrentUser() user: JwtPayload) {
    return this.notificationService.markAllAsRead(user.sub);
  }

  @Patch('notifications/:id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiOkResponse({ description: 'Updated notification' })
  markAsRead(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.notificationService.markAsRead(user.sub, id);
  }

  @Delete('notifications/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiNoContentResponse()
  async deleteNotification(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notificationService.delete(user.sub, id);
  }

  // ─── Push subscriptions ───────────────────────────────────────────────────

  @Post('notifications/push-subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a Web Push subscription' })
  @ApiCreatedResponse({ description: 'Push subscription created' })
  registerPushSubscription(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RegisterPushSubscriptionDto,
  ) {
    return this.notificationService.registerPush(user.sub, dto);
  }

  @Delete('notifications/push-subscriptions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a Web Push subscription' })
  @ApiNoContentResponse()
  async removePushSubscription(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notificationService.removePush(user.sub, id);
  }

  @Post('notifications/push-subscriptions/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test Web Push notification to the authenticated user' })
  @ApiOkResponse({ description: '{ sent: number }' })
  sendTestPush(@CurrentUser() user: JwtPayload) {
    return this.notificationService.sendTestPush(user.sub);
  }

  // ─── Admin endpoints ──────────────────────────────────────────────────────

  @Post('admin/notifications')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[Admin] Create a notification for a specific user' })
  @ApiCreatedResponse({ description: 'Notification created' })
  createForUser(@Body() dto: CreateNotificationDto) {
    return this.notificationService.create({
      userId: dto.userId,
      type: dto.type,
      title: dto.title,
      message: dto.message,
      metadata: dto.metadata,
    });
  }

  @Post('admin/notifications/broadcast')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Broadcast notification to all active affiliates' })
  @ApiOkResponse({ description: '{ count: number }' })
  broadcast(@Body() dto: BroadcastNotificationDto) {
    return this.notificationService.broadcast(dto);
  }
}
