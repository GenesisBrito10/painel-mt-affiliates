import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard, Roles } from '../../auth/index.js';
import { LinkWebhookService } from '../application/link-webhook.service.js';
import {
  AdminWebhookDeliveriesQueryDto,
  AdminWebhookOverviewQueryDto,
} from '../application/dto/link-webhook.dto.js';

/**
 * Cross-owner webhook observability — ADMIN/SUPERADMIN only.
 * (SUPERADMIN inherits ADMIN in RolesGuard.)
 */
@ApiTags('admin-link-webhooks-observability')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/link-webhooks/observability', version: '1' })
export class LinkWebhookAdminController {
  constructor(private readonly webhook: LinkWebhookService) {}

  @Get('overview')
  overview(@Query() query: AdminWebhookOverviewQueryDto) {
    return this.webhook.adminOverview(query);
  }

  @Get('endpoints')
  endpoints() {
    return this.webhook.adminListEndpoints();
  }

  @Get('deliveries')
  deliveries(@Query() query: AdminWebhookDeliveriesQueryDto) {
    return this.webhook.adminListDeliveries(query);
  }
}
