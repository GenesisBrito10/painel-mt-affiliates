import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LinkWebhookDeliveryStatus } from '@prisma/client';
import { ALL_LINK_WEBHOOK_EVENTS } from '../../domain/types/link-webhook.types.js';

const DELIVERY_STATUSES = Object.values(LinkWebhookDeliveryStatus);

export class UpdateLinkWebhookSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @ValidateIf((dto: UpdateLinkWebhookSettingsDto) => dto.webhookUrl !== '')
  @IsUrl({ require_tld: false, require_protocol: true })
  webhookUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  webhookSecret?: string;

  // Subscribed events. Must be a subset of the catalog.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_LINK_WEBHOOK_EVENTS, { each: true })
  events?: string[];
}

export class ListLinkWebhookDeliveriesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsIn(DELIVERY_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(ALL_LINK_WEBHOOK_EVENTS)
  event?: string;

  // Busca por nome/e-mail do usuário relacionado à entrega.
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  // Intervalo de datas (createdAt), formato YYYY-MM-DD.
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

// Admin-wide observability filters (cross-owner). search/from/to herdados da base.
export class AdminWebhookDeliveriesQueryDto extends ListLinkWebhookDeliveriesDto {
  @IsOptional()
  @IsString()
  ownerUserId?: string;
}

// Body for POST /admin/link-webhooks/test — optional event to sample.
export class TestWebhookDto {
  @IsOptional()
  @IsIn(ALL_LINK_WEBHOOK_EVENTS)
  event?: string;
}

export class AdminWebhookOverviewQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
