import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDecimal,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

export class CreateAffiliateLinkDto {
  @ApiProperty({
    example: 'esportivabet',
    description: 'Betting house slug (lowercase)',
  })
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'bettingHouse must be lowercase alphanumeric with hyphens',
  })
  bettingHouse!: string;

  @ApiProperty({
    example: 'camp_123',
    description: 'Unique campaign ID for this house',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  campaignId!: string;

  @ApiPropertyOptional({ example: 'aff_456' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  affiliateId?: string;

  @ApiPropertyOptional({
    example: '150.0000',
    description: 'CPA value (Decimal string)',
  })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  cpa?: string;

  @ApiPropertyOptional({
    example: '35.0000',
    description: 'RevShare % (Decimal string)',
  })
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  revshare?: string;

  @ApiPropertyOptional({
    description: 'URL de afiliado que o usuário compartilha',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  userLink?: string;
}

export class UpdateAffiliateLinkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  affiliateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  cpa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  revshare?: string;

  @ApiPropertyOptional({
    description: 'URL de afiliado que o usuário compartilha',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  userLink?: string;
}

@Exclude()
export class AffiliateLinkResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() userId!: string;
  @Expose() @ApiProperty() bettingHouse!: string;
  @Expose() @ApiProperty() affiliateId!: string;
  @Expose() @ApiProperty() campaignId!: string;
  @Expose() @ApiPropertyOptional() cpa!: string | null;
  @Expose() @ApiPropertyOptional() revshare!: string | null;
  @Expose() @ApiPropertyOptional() userLink!: string | null;
  @Expose() @ApiProperty() updatedAt!: Date;
}
