import {
  IsString,
  IsObject,
  IsOptional,
  IsUUID,
  IsIn,
  IsArray,
  ValidateNested,
  IsDateString,
  IsNumber,
  Min,
  IsInt,
  Max,
  IsUrl,
  ValidateIf,
  IsBoolean,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Shared ───────────────────────────────────────────────────────────────────

export class LinkItemDto {
  @ApiProperty({ example: 'Link principal' })
  @IsString()
  label!: string;

  @ApiProperty({ example: 'https://wlsuperbet.adsrv.eacdn.com/C.ashx?...' })
  @IsString()
  @IsUrl({ require_tld: false })
  url!: string;
}

// ─── POST /link-requests ──────────────────────────────────────────────────────

export class CreateLinkRequestDto {
  @ApiPropertyOptional({ description: 'UUID of the Deal being requested' })
  @IsOptional()
  @IsUUID()
  dealId?: string;

  @ApiPropertyOptional({
    description:
      'Betting house slug — backend finds the active deal automatically',
  })
  @IsOptional()
  @IsString()
  bettingHouseSlug?: string;

  @ApiPropertyOptional({ description: 'Optional message from the affiliate' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({
    description:
      'Respostas do formulário (apenas deals kind=FORM). Objeto dinâmico validado ' +
      'no service contra o formSchema do deal. Ex.: { credUsername, credPassword, ' +
      'houses: string[], agreement, actAs, channel, notes }.',
    type: Object,
  })
  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;
}

// ─── GET /link-requests ───────────────────────────────────────────────────────

export class ListLinkRequestsQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Search by user name or email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['PENDING', 'FULFILLED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['PENDING', 'FULFILLED', 'REJECTED'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by fulfilledAt start date' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Filter by fulfilledAt end date' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'fulfilledAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'fulfilledAt'])
  sort?: 'createdAt' | 'fulfilledAt' = 'createdAt';

  @ApiPropertyOptional({
    description: 'Filter by utmCampaign panel (admin only)',
  })
  @IsOptional()
  @IsString()
  panel?: string;

  @ApiPropertyOptional({
    description: 'Restrict to logged-in user only (Meus Links tab)',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({ description: 'Filter by betting house slug' })
  @IsOptional()
  @IsString()
  house?: string;

  @ApiPropertyOptional({
    enum: ['yes', 'no'],
    description:
      'Filter by whether the affiliate already has CPA/RevShare defined',
  })
  @IsOptional()
  @IsIn(['yes', 'no'])
  hasCommission?: 'yes' | 'no';
}

// ─── PUT /link-requests/:id (admin) ──────────────────────────────────────────

export class UpdateLinkRequestDto {
  @ApiPropertyOptional({ enum: ['fulfilled', 'rejected'] })
  @IsOptional()
  @IsIn(['fulfilled', 'rejected'])
  status?: 'fulfilled' | 'rejected';

  @ApiPropertyOptional({
    type: [LinkItemDto],
    description: 'Tracking URLs (required when approving)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkItemDto)
  links?: LinkItemDto[];

  @ApiPropertyOptional({ description: 'Admin note visible to the affiliate' })
  @IsOptional()
  @IsString()
  adminNote?: string;

  @ApiPropertyOptional({
    description:
      'Manual campaignId for houses where auto-extraction is not supported (mgm, esportivabet)',
  })
  @IsOptional()
  @IsString()
  manualCampaignId?: string;

  @ApiPropertyOptional({
    description: 'CPA value in BRL (must not exceed referrer ceiling)',
  })
  @ValidateIf((o: UpdateLinkRequestDto) => o.status === 'fulfilled')
  @IsNumber()
  @Min(0)
  cpa?: number;

  @ApiPropertyOptional({
    description: 'RevShare percentage 0-100 (must not exceed referrer ceiling)',
  })
  @ValidateIf((o: UpdateLinkRequestDto) => o.status === 'fulfilled')
  @IsNumber()
  @Min(0)
  revshare?: number;
}

// CPA manual (esportiva-diario): admin ou convidante seta o CPA → request entra
// na fila do scheduler (resolvedCpa setado).
export class SetLinkRequestCpaDto {
  @ApiProperty({ description: 'CPA em BRL (convidante: até o teto dele)' })
  @IsNumber()
  @Min(0)
  cpa!: number;

  @ApiPropertyOptional({ description: 'RevShare % 0-100' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  revshare?: number;
}

// ─── GET /deal-requests ───────────────────────────────────────────────────────

export class ListDealRequestsQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'FULFILLED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['PENDING', 'FULFILLED', 'REJECTED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'fulfilledAt'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(['createdAt', 'fulfilledAt'])
  sort?: 'createdAt' | 'fulfilledAt' = 'createdAt';

  @ApiPropertyOptional({ description: 'Filter by betting house slug' })
  @IsOptional()
  @IsString()
  house?: string;
}

// ─── PUT /deal-requests/:id/approve ──────────────────────────────────────────

export class ApproveDealRequestDto {
  @ApiPropertyOptional({ description: 'CPA value in BRL' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cpa?: number;

  @ApiPropertyOptional({ description: 'RevShare percentage (0-100)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  revshare?: number;

  @ApiPropertyOptional({ type: [LinkItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LinkItemDto)
  links?: LinkItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  adminNote?: string;

  @ApiPropertyOptional({ enum: ['approve', 'reject'] })
  @IsOptional()
  @IsIn(['approve', 'reject'])
  action?: 'approve' | 'reject';

  @ApiPropertyOptional({
    description:
      'Manual campaignId for houses where auto-extraction is not supported (mgm, esportivabet)',
  })
  @IsOptional()
  @IsString()
  manualCampaignId?: string;
}
