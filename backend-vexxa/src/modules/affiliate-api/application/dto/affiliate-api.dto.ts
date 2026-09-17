import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AffiliateApiMetricsQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  houseSlug?: string;

  @IsOptional()
  @IsString()
  affiliateId?: string;

  @IsOptional()
  @IsIn(['summary', 'day', 'house', 'affiliate'])
  groupBy?: 'summary' | 'day' | 'house' | 'affiliate';
}

export class AffiliateApiCreateLinkRequestDto {
  // The id of the user in the THIRD PARTY's own panel. We map it to a shadow
  // external user, unique within the token owner's scope.
  @IsString()
  @MaxLength(128)
  externalUserId!: string;

  // Required: real e-mail of the panel user — stored on the shadow user so
  // search/metrics work and we never fall back to a synthetic address.
  @IsEmail()
  userEmail!: string;

  // Required: real name of the panel user.
  @IsString()
  @MaxLength(160)
  userName!: string;

  // Required: betting house slug the link is requested for.
  @IsString()
  bettingHouseSlug!: string;

  @IsOptional()
  @IsUUID()
  dealId?: string;

  @IsOptional()
  @IsString()
  message?: string;
}

// Consult a sub-user's profile + balance. bettingHouse optionally scopes the
// balance to a single casa.
export class AffiliateApiUserQueryDto {
  @IsOptional()
  @IsString()
  bettingHouse?: string;
}

// Request a withdrawal on behalf of a third-party panel user. Saca o saldo
// total disponível da casa (sem campo amount) — vide fluxo interno.
export class AffiliateApiCreateWithdrawalDto {
  @IsString()
  @MaxLength(128)
  externalUserId!: string;

  @IsString()
  bettingHouse!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  requestNote?: string;
}

export class AffiliateApiListWithdrawalsQueryDto {
  // Filter the history to a single panel user (optional).
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalUserId?: string;

  @IsOptional()
  @IsIn([
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'REJECTED',
    'pending',
    'processing',
    'completed',
    'rejected',
  ])
  status?: string;

  @IsOptional()
  @IsString()
  bettingHouse?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class AffiliateApiUpdateWithdrawalStatusDto {
  @IsIn(['processing', 'completed', 'rejected'])
  status!: 'processing' | 'completed' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export type AffiliateApiEnvironment = 'live' | 'test';

// Token environment selector for the token-management routes (default live).
export class AffiliateApiTokenEnvDto {
  @IsOptional()
  @IsIn(['live', 'test'])
  environment?: AffiliateApiEnvironment;
}

export interface AffiliateApiTokenOwner {
  userId: string;
  email: string;
  tokenId: string;
  environment: AffiliateApiEnvironment;
}

/**
 * The operation surface shared by the live service and the sandbox service.
 * The public controller picks the implementation by token environment, so both
 * must expose the same methods.
 */
export interface IAffiliateApiOps {
  getMetrics(
    ownerUserId: string,
    query: AffiliateApiMetricsQueryDto,
  ): Promise<unknown>;
  createLinkRequestFromApi(
    ownerUserId: string,
    dto: AffiliateApiCreateLinkRequestDto,
  ): Promise<unknown>;
  getExternalUser(
    ownerUserId: string,
    externalUserId: string,
    query: AffiliateApiUserQueryDto,
  ): Promise<unknown>;
  createWithdrawalFromApi(
    ownerUserId: string,
    dto: AffiliateApiCreateWithdrawalDto,
  ): Promise<unknown>;
  listWithdrawalsFromApi(
    ownerUserId: string,
    query: AffiliateApiListWithdrawalsQueryDto,
  ): Promise<unknown>;
  getWithdrawalFromApi(
    ownerUserId: string,
    withdrawalId: string,
  ): Promise<unknown>;
  setWithdrawalStatusFromApi(
    ownerUserId: string,
    withdrawalId: string,
    dto: AffiliateApiUpdateWithdrawalStatusDto,
  ): Promise<unknown>;
}
