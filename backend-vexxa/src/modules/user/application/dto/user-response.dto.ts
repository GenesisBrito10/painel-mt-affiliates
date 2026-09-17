import { Exclude, Expose } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';

@Exclude()
export class UserResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() email!: string;
  @Expose() @ApiPropertyOptional() avatarUrl!: string | null;
  @Expose() @ApiProperty({ enum: UserRole }) role!: UserRole;
  @Expose() @ApiProperty({ enum: UserStatus }) status!: UserStatus;
  @Expose() @ApiProperty() active!: boolean;
  @Expose() @ApiProperty() ageVerified!: boolean;
  @Expose() @ApiProperty() withdrawalBlocked!: boolean;
  @Expose() @ApiPropertyOptional() referralCode!: string | null;
  @Expose() @ApiPropertyOptional() bonusBalance!: string;

  // Payment info
  @Expose() @ApiProperty() pixKeyType!: string;
  @Expose() @ApiProperty() pixKey!: string;
  @Expose() @ApiProperty() bankName!: string;
  @Expose() @ApiProperty() bankAgency!: string;
  @Expose() @ApiProperty() bankAccount!: string;
  @Expose() @ApiProperty() accountHolder!: string;

  // KYC — identity data
  // cpf is returned masked (***.***.XXX-XX) — full value never exposed via API
  @Expose() @ApiPropertyOptional() cpf!: string | null;
  @Expose() @ApiPropertyOptional() birthDate!: Date | null;
  @Expose() @ApiPropertyOptional() whatsapp!: string | null;
  @Expose() @ApiProperty() profileCompleted!: boolean;
  @Expose() @ApiProperty() requiresSuperbetAgreementRequest!: boolean;
  @Expose() @ApiProperty() hasReferrals!: boolean;
  @Expose() @ApiProperty() apiAccessEnabled!: boolean;

  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    nextCursor: string | null;
    limit: number;
  };
}
