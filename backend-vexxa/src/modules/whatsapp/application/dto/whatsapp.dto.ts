import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { WhatsappSendStatus } from '@prisma/client';
import { MAX_TEMPLATE_LENGTH } from '../../domain/types/whatsapp.types.js';

export class UpdateWhatsappSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  selectedGroupId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  selectedGroupName?: string;

  @ApiPropertyOptional({ maxLength: MAX_TEMPLATE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEMPLATE_LENGTH)
  messageTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sendMedia?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  @Type(() => Number)
  delayMinSeconds?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  @Type(() => Number)
  delayMaxSeconds?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  maxAttempts?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 43200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(43200)
  @Type(() => Number)
  maxWaitConnectionMinutes?: number;

  @ApiPropertyOptional({ minimum: 60, maximum: 86400 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  @Type(() => Number)
  failureCooldownSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // ─── Alerta de planilha de links cheia ──────────────────────────────────
  @ApiPropertyOptional({
    description: 'Número WhatsApp que recebe o alerta de links esgotados',
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  linkPoolAlertNumber?: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100000,
    description: 'Dispara o alerta quando os links livres caem até este limite',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  @Type(() => Number)
  linkPoolAlertThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  linkPoolAlertEnabled?: boolean;
}

export class TestNumberDto {
  @IsString()
  @MaxLength(30)
  number!: string;
}

export class AddTargetGroupDto {
  @ApiPropertyOptional({ description: 'JID do grupo (...@g.us)' })
  @IsString()
  @MaxLength(120)
  groupId!: string;

  @ApiPropertyOptional({ description: 'Nome do grupo' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class ListSendHistoryDto {
  @ApiPropertyOptional({ enum: WhatsappSendStatus })
  @IsOptional()
  @IsEnum(WhatsappSendStatus)
  status?: WhatsappSendStatus;

  @ApiPropertyOptional({ description: 'ISO date (início)' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date (fim)' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Busca por nome/email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}

export class PreviewTemplateDto {
  @ApiPropertyOptional({ maxLength: MAX_TEMPLATE_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEMPLATE_LENGTH)
  template?: string;
}
