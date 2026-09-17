import { IsOptional, IsString, IsIn, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export type AffiliateExportFormat = 'csv' | 'pdf';

/**
 * Query params for the affiliates export endpoint. Mirrors
 * {@link ListAffiliatesQueryDto} minus pagination, plus the output `format`.
 */
export class ExportAffiliatesQueryDto {
  @ApiPropertyOptional({
    description: 'Output format',
    enum: ['csv', 'pdf'],
    default: 'csv',
  })
  @IsOptional()
  @IsIn(['csv', 'pdf'])
  format?: AffiliateExportFormat = 'csv';

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
