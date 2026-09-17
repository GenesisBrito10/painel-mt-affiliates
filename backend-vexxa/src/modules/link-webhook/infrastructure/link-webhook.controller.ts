import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiAccessGuard, CurrentUser, JwtAuthGuard } from '../../auth/index.js';
import type { JwtPayload } from '../../auth/index.js';
import { LinkWebhookService } from '../application/link-webhook.service.js';
import { LinkWebhookSettingsService } from '../application/link-webhook-settings.service.js';
import {
  ListLinkWebhookDeliveriesDto,
  TestWebhookDto,
  UpdateLinkWebhookSettingsDto,
} from '../application/dto/link-webhook.dto.js';

@ApiTags('admin-link-webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ApiAccessGuard)
@Controller({ path: 'admin/link-webhooks', version: '1' })
export class LinkWebhookController {
  constructor(
    private readonly settings: LinkWebhookSettingsService,
    private readonly webhook: LinkWebhookService,
  ) {}

  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.settings.getSettingsForActor(user);
  }

  @Put('settings')
  updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateLinkWebhookSettingsDto,
  ) {
    return this.settings.updateSettings(user, dto);
  }

  @Get('deliveries')
  listDeliveries(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListLinkWebhookDeliveriesDto,
  ) {
    return this.webhook.listDeliveries(user, query);
  }

  @Post('deliveries/:id/redeliver')
  redeliver(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.webhook.redeliver(user, id);
  }

  @Post('test')
  testWebhook(@CurrentUser() user: JwtPayload, @Body() dto: TestWebhookDto) {
    return this.webhook.sendTestWebhook(user, dto.event);
  }
}
