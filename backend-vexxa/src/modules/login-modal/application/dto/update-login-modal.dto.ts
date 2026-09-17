import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoginModalAudience } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateLoginModalDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ enum: LoginModalAudience })
  @IsOptional()
  @IsEnum(LoginModalAudience)
  audience?: LoginModalAudience;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpdateLoginModalDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ required: false, enum: LoginModalAudience })
  @IsOptional()
  @IsEnum(LoginModalAudience)
  audience?: LoginModalAudience;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  kind?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  eyebrow?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  icon?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionLabel?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondaryActionLabel?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  actionUrl?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  accent?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  storageKey?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  dismissScope?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @ApiProperty({ required: false, enum: ['none', 'top', 'full'] })
  @IsOptional()
  @IsString()
  @IsIn(['none', 'top', 'full'])
  imageLayout?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  lockSeconds?: number;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  payload?: unknown;
}

export class LoginModalOrderItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  key!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  priority!: number;
}

export class ReorderLoginModalsDto {
  @ApiProperty({ type: [LoginModalOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoginModalOrderItemDto)
  items!: LoginModalOrderItemDto[];
}
