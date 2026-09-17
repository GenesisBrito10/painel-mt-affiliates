import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsIn,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RangeTierDto {
  @ApiPropertyOptional({
    description: 'Piso da faixa (null = sem piso)',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  min?: number | null;

  @ApiPropertyOptional({
    description: 'Teto da faixa (null = sem teto)',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  max?: number | null;

  @ApiProperty({ description: 'CPA da faixa' })
  @IsNumber()
  @Min(0)
  cpa!: number;
}

/** Atualização parcial da regra da casa (admin). Campos ausentes não mudam. */
export class UpsertHouseLinkRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requestEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoAssignEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['INVITER_DISCOUNT', 'RANGE', 'MIRROR'] })
  @IsOptional()
  @IsIn(['INVITER_DISCOUNT', 'RANGE', 'MIRROR'])
  ruleType?: 'INVITER_DISCOUNT' | 'RANGE' | 'MIRROR';

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) defaultCpa?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) fallbackCpa?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  inviterCpaThreshold?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  inviterCpaDiscount?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultRevshare?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  rangeReferenceHouse?: string | null;

  @ApiPropertyOptional({ type: [RangeTierDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RangeTierDto)
  rangeTiers?: RangeTierDto[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() checkExistingLink?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  checkPendingRequest?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() useInviterCpa?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  applyFallbackNoInviterCpa?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  applyDefaultNoInviter?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  blockOnRequiredFail?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  processOldRequests?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireActiveLinkInHouses?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredHouseSlugs?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString() blockMessage?: string;

  @ApiPropertyOptional({
    description: 'Motivo da alteração (obrigatório p/ campos financeiros)',
  })
  @IsOptional()
  @IsString()
  changeReason?: string;
}

export class BackfillDto {
  @ApiPropertyOptional({ description: 'true = prévia sem alterações' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description: 'Recalcula CPA mesmo com snapshot (exige reason; só PENDING)',
  })
  @IsOptional()
  @IsBoolean()
  forceRecalculate?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ReprocessRequestDto {
  @ApiProperty({ description: 'Motivo obrigatório do reprocessamento' })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({ description: 'Recalcular CPA e atualizar snapshot' })
  @IsOptional()
  @IsBoolean()
  recalculateSnapshot?: boolean;
}
