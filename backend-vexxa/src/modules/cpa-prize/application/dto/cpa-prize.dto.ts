import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsInt,
  IsBoolean,
  IsDateString,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CpaPrizeCountMode, PrizeType } from '@prisma/client';

const toSlug = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// ─── Admin: rules ───────────────────────────────────────────────────────────

export class ListCpaPrizeRulesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  archived?: boolean;
}

export class CreateCpaPrizeRuleDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Slug da casa; vazio = todas as casas' })
  @IsOptional()
  @IsString()
  @Transform(toSlug)
  bettingHouse?: string;

  @ApiProperty({ description: 'Meta: CPAs por prêmio' })
  @IsInt()
  @Min(1)
  cpaPerPrize!: number;

  @ApiProperty({ enum: CpaPrizeCountMode })
  @IsEnum(CpaPrizeCountMode)
  countMode!: CpaPrizeCountMode;

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

  @ApiProperty({ example: '2026-05-01' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateCpaPrizeRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(toSlug)
  bettingHouse?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  cpaPerPrize?: number;

  @ApiPropertyOptional({ enum: CpaPrizeCountMode })
  @IsOptional()
  @IsEnum(CpaPrizeCountMode)
  countMode?: CpaPrizeCountMode;

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

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Se uma mudança estrutural deve aplicar no mesmo dia (risco de sobreposição). Padrão: nova versão começa amanhã.',
  })
  @IsOptional()
  @IsBoolean()
  applySameDay?: boolean;
}

// ─── Admin: redemption / award ────────────────────────────────────────────

export class RejectRedemptionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class CancelAwardDto {
  @ApiProperty({ description: 'Motivo obrigatório do cancelamento' })
  @IsString()
  @MinLength(1)
  reason!: string;
}
