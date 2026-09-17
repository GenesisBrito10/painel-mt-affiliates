import {
  IsNotEmpty,
  IsIn,
  IsUrl,
  IsEmail,
  MinLength,
  MaxLength,
  IsOptional,
  ValidateNested,
  IsArray,
  IsBoolean,
  IsString,
  IsObject,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { SUPPORTED_PROVIDERS } from '../../domain/types/provider-account.types.js';

// ── AddHouseDto ──────────────────────────────────────────────────────────────

export class AddHouseDto {
  @ApiProperty({ example: 'esportivabet' })
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with hyphens' })
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  bettingHouseSlug!: string;

  /**
   * FIX I02: bookmarkerId is a string ID from Betboard, NOT necessarily a UUID.
   * Validated as non-empty string, not @IsUUID().
   */
  @ApiProperty({ example: '02510c60-e702-479e-ada2-017e0b77f762' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  bookmarkerId!: string;

  @ApiPropertyOptional({ example: {} })
  @IsOptional()
  @IsObject()
  extraConfig?: Record<string, unknown>;
}

// ── CreateProviderAccountDto ─────────────────────────────────────────────────

export class CreateProviderAccountDto {
  @ApiProperty({ example: 'VEXXA' })
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  @Transform(({ value }: { value: string }) => value?.trim().toUpperCase())
  name!: string;

  @ApiProperty({ example: 'betboard', enum: SUPPORTED_PROVIDERS })
  @IsIn(SUPPORTED_PROVIDERS)
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  provider!: string;

  @ApiProperty({ example: 'https://api-affiliates.mgaffiliates.site/api' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  apiBaseUrl!: string;

  @ApiProperty({ example: 'admin@vexxa.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'strongpassword' })
  @IsNotEmpty()
  @MinLength(6)
  password!: string;

  @ApiPropertyOptional({ type: [AddHouseDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddHouseDto)
  houses?: AddHouseDto[];
}

// ── UpdateProviderAccountDto ─────────────────────────────────────────────────

export class UpdateProviderAccountDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  @Transform(({ value }: { value: string }) => value?.trim().toUpperCase())
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  apiBaseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
  // provider is immutable — not editable after creation
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

@Exclude()
export class HouseResponseDto {
  @Expose() @ApiProperty() bettingHouseSlug!: string;
  @Expose() @ApiProperty() bettingHouseName!: string;
  @Expose() @ApiProperty() bookmarkerId!: string;
  @Expose() @ApiProperty() active!: boolean;
}

@Exclude()
export class ProviderAccountResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() provider!: string;
  @Expose() @ApiProperty() apiBaseUrl!: string;
  @Expose() @ApiProperty({ description: 'Masked email (never plaintext)' }) emailMasked!: string;
  @Expose() @ApiProperty() active!: boolean;
  @Expose() @ApiPropertyOptional() lastUsedAt!: Date | null;
  @Expose() @ApiPropertyOptional() lastError!: string | null;
  @Expose() @ApiProperty({ type: [HouseResponseDto] }) houses!: HouseResponseDto[];
  @Expose() @ApiProperty() createdAt!: Date;
}
