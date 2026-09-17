import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListAffiliatesQueryDto {
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

  @ApiPropertyOptional({
    description: 'Search by name or email (partial, case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by role (e.g. ADMIN, AFFILIATE). "all" = no filter.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  role?: string;

  @ApiPropertyOptional({
    description:
      'Filter by user status (e.g. PENDING, APPROVED). "all" = no filter.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @ApiPropertyOptional({
    description: 'Filter by betting house slug. "all" = no filter.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bettingHouseId?: string;

  @ApiPropertyOptional({
    description: 'Filter users with no affiliate links ("true")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5)
  noLink?: string;

  @ApiPropertyOptional({
    description:
      'Filter by referral depth from panel root: direct, 1, 2, 3, 4plus, all',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  referralDepth?: string;
}
