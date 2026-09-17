import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsValidPixKey } from '../../domain/value-objects/is-valid-pix-key.decorator.js';
import {
  PIX_KEY_TYPES,
  validatePixKey,
} from '../../domain/value-objects/pix-key.util.js';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email?: string;

  @ApiPropertyOptional({ description: 'Profile avatar URL or data URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2000000)
  avatarUrl?: string | null;

  @ApiPropertyOptional({
    example: 'cpf',
    enum: ['cpf', 'cnpj', 'email', 'phone', 'random'],
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(({ value }: { value: string }) =>
    (value ?? '').toLowerCase().trim(),
  )
  @IsIn([...PIX_KEY_TYPES, ''], {
    message: 'pixKeyType deve ser: cpf, cnpj, email, phone ou random',
  })
  pixKeyType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(
    ({ value, obj }: { value: string; obj: { pixKeyType?: string } }) => {
      if (value === undefined || value === null || value === '') return value;
      const r = validatePixKey(obj?.pixKeyType, value);
      return r.ok ? r.normalized : value;
    },
  )
  @IsValidPixKey('pixKeyType')
  pixKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: '0001' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^\d{4,10}$/, { message: 'bankAgency must be numeric 4-10 digits' })
  bankAgency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankAccount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountHolder?: string;
}
