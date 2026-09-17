import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  IsDateString,
  Min,
  ValidateNested,
  MinLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PrizeStatus, PrizeType, PrizeWinMode } from '@prisma/client';

// ─── Query DTOs ─────────────────────────────────────────────────────────────

export class ListPrizesQueryDto {
  @ApiPropertyOptional({ enum: PrizeStatus })
  @IsOptional()
  @IsEnum(PrizeStatus)
  status?: PrizeStatus;
}

export class LeaderboardQueryDto {
  @ApiPropertyOptional({ enum: ['month', 'week', 'today'], default: 'month' })
  @IsOptional()
  @IsString()
  period?: 'month' | 'week' | 'today';

  @ApiPropertyOptional({ description: 'Filter leaderboard by active prize ID' })
  @IsOptional()
  @IsString()
  prizeId?: string;

  @ApiPropertyOptional({
    description: 'Filter leaderboard by betting house slug',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  bettingHouse?: string;
}

// ─── Rank Prize (per-position) ──────────────────────────────────────────────

export class RankPrizeItemDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  rank!: number;

  @ApiProperty({ enum: PrizeType })
  @IsEnum(PrizeType)
  prizeType!: PrizeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  prizeValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prizeLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;
}

// ─── Create Prize ───────────────────────────────────────────────────────────

export class CreatePrizeDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [RankPrizeItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RankPrizeItemDto)
  prizes?: RankPrizeItemDto[];

  @ApiPropertyOptional({ enum: PrizeType })
  @IsOptional()
  @IsEnum(PrizeType)
  prizeType?: PrizeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  prizeValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prizeLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({ example: '2026-05-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-05-31' })
  @IsDateString()
  endDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  winnersCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  targetCpa?: number;

  @ApiPropertyOptional({
    description: 'Betting house slug; empty/omitted = count all houses',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  bettingHouse?: string;

  @ApiPropertyOptional({
    enum: PrizeWinMode,
    description:
      'RANKING = top N by most CPA; TARGET = top N reaching the CPA goal',
  })
  @IsOptional()
  @IsEnum(PrizeWinMode)
  winMode?: PrizeWinMode;

  @ApiPropertyOptional({
    description:
      'true = conta CPA da REDE (downline) do afiliado; false = produção individual. Usado no modo TARGET (meta de CPA).',
  })
  @IsOptional()
  @IsBoolean()
  cpaFromNetwork?: boolean;

  @ApiPropertyOptional({
    description:
      'Só modo TARGET: máximo de vezes que o mesmo usuário pode vencer esta meta. null/omitido = ilimitado.',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxWinsPerUser?: number | null;
}

// ─── Update Prize ───────────────────────────────────────────────────────────

export class UpdatePrizeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [RankPrizeItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RankPrizeItemDto)
  prizes?: RankPrizeItemDto[];

  @ApiPropertyOptional({ enum: PrizeType })
  @IsOptional()
  @IsEnum(PrizeType)
  prizeType?: PrizeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  prizeValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prizeLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-05-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  winnersCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  targetCpa?: number;

  @ApiPropertyOptional({
    description: 'Betting house slug; empty = count all houses',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  bettingHouse?: string;

  @ApiPropertyOptional({ enum: PrizeWinMode })
  @IsOptional()
  @IsEnum(PrizeWinMode)
  winMode?: PrizeWinMode;

  @ApiPropertyOptional({
    description:
      'true = conta CPA da REDE (downline); false = produção individual. Usado no modo TARGET.',
  })
  @IsOptional()
  @IsBoolean()
  cpaFromNetwork?: boolean;

  @ApiPropertyOptional({
    description:
      'Só modo TARGET: máximo de vezes que o mesmo usuário pode vencer esta meta. null = ilimitado.',
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxWinsPerUser?: number | null;
}

// ─── Redeem ─────────────────────────────────────────────────────────────────

export class RedeemPrizeDto {
  @ApiPropertyOptional({
    description: 'Rank position to redeem (for users with multiple wins)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  rank?: number;
}

// ─── Finalize ───────────────────────────────────────────────────────────────

export class FinalizePrizeDto {
  @ApiProperty({ description: 'Must be true to confirm finalization' })
  @IsBoolean()
  confirmed!: boolean;
}
