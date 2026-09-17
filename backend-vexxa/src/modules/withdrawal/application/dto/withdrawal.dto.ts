import {
  IsString,
  IsOptional,
  IsIn,
  IsDateString,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsNumber,
  IsPositive,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWithdrawalDto {
  @ApiProperty({ description: 'Betting house slug for the withdrawal' })
  @IsString()
  bettingHouse!: string;

  @ApiPropertyOptional({
    description: 'Optional note from affiliate to the admin',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  requestNote?: string;
}

export class ListWithdrawalsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by start date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter by end date (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: [
      'PENDING',
      'APPROVED',
      'REJECTED',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
    ],
  })
  @IsOptional()
  @IsString()
  @IsIn([
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'pending',
    'approved',
    'rejected',
    'processing',
    'completed',
    'failed',
  ])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by betting house slug' })
  @IsOptional()
  @IsString()
  bettingHouse?: string;

  @ApiPropertyOptional({
    description:
      'Filter by provider account (painel) ID — joins via user.affiliateLinks',
  })
  @IsOptional()
  @IsString()
  providerAccountId?: string;

  @ApiPropertyOptional({
    description: 'Admin search by affiliate name or email',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by presence of payment receipt',
    enum: ['yes', 'no'],
  })
  @IsOptional()
  @IsIn(['yes', 'no'])
  hasReceipt?: 'yes' | 'no';

  @ApiPropertyOptional({
    description:
      'Filter by refund state. "none" = no refund; "any"|"partial"|"full" require a refund — partial/full are narrowed in-memory after the DB filter.',
    enum: ['none', 'any', 'partial', 'full'],
  })
  @IsOptional()
  @IsIn(['none', 'any', 'partial', 'full'])
  refundState?: 'none' | 'any' | 'partial' | 'full';

  @ApiPropertyOptional({
    description:
      'Inclui saques de usuários externos (API). Padrão false — usado pela aba de saques do afiliado no admin para exibir saques via API com selo de externo.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeExternal?: boolean;
}

export class UpdateWithdrawalStatusDto {
  @ApiProperty({
    enum: ['approved', 'rejected'],
    description: 'New status for the withdrawal',
  })
  @IsString()
  @IsIn(['approved', 'rejected'])
  status!: string;

  @ApiPropertyOptional({ description: 'Optional note from admin' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;
}

export class ApproveWithdrawalDto {
  @ApiProperty({
    description:
      'Original (gross) amount the admin is confirming, must match server-side originalAmount to defend against stale UI.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  confirmAmount!: number;

  @ApiPropertyOptional({
    description: 'Optional note from admin',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;
}

export class ManualPaymentDto {
  @ApiPropertyOptional({
    description: 'Note explaining manual payment reason',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;
}
