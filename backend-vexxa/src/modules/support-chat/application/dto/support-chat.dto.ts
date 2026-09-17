import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConversationDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subject?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  triageTopic?: string;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  triageContent?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  triageTriggerMessage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  triageRequestedHuman?: boolean;
}

export class SendMessageDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  attachmentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  attachmentMimeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  attachmentName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  attachmentSize?: number;
}

export class EditMessageDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  content!: string;
}

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ enum: ['WAITING', 'OPEN', 'WAITING_USER', 'CLOSED'] })
  @IsOptional()
  @IsIn(['WAITING', 'OPEN', 'WAITING_USER', 'CLOSED'])
  status?: 'WAITING' | 'OPEN' | 'WAITING_USER' | 'CLOSED';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ConversationDetailQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  messagesPage?: number;

  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  messagesLimit?: number;
}

export class AdminListConversationsQueryDto extends ListConversationsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  affiliateId?: string;

  @ApiPropertyOptional({ description: 'Busca por nome ou email do afiliado' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  affiliateSearch?: string;
}

export class AssignConversationDto {
  @ApiProperty()
  @IsUUID()
  agentId!: string;
}

export class UpdateConversationTagsDto {
  @ApiProperty({ type: [String], description: 'Lista de tags da conversa' })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags!: string[];
}

export class ToggleBusinessHoursBypassDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
