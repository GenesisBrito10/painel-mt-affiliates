import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

// ─── Create / Upsert ─────────────────────────────────────────────────────────

export class CreateSettingDto {
  @ApiProperty({ example: 'withdrawal_block_active' })
  @IsNotEmpty()
  @Matches(/^[a-z_]+$/, { message: 'key must be lowercase letters and underscores only' })
  @MaxLength(100)
  key!: string;

  @ApiProperty({ example: 'false' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) => String(value))
  value!: string;

  @ApiPropertyOptional({ example: 'Block all withdrawals' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;
}

// ─── Update (value-only patch) ────────────────────────────────────────────────

export class UpdateSettingDto {
  @ApiProperty({ example: 'true' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) => String(value))
  value!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;
}
