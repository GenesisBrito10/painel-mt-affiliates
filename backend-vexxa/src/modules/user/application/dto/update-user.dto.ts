import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
  Matches,
  MaxLength,
  MinLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { UserRole, UserStatus } from '@prisma/client';
import { IsValidPixKey } from '../../domain/value-objects/is-valid-pix-key.decorator.js';
import {
  PIX_KEY_TYPES,
  validatePixKey,
} from '../../domain/value-objects/pix-key.util.js';

export class UpdateUserAdminDto {
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

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawalBlocked?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ageVerified?: boolean;

  @ApiPropertyOptional({ description: 'CPF (11 digits, optional)' })
  @IsOptional()
  @IsString()
  @MaxLength(14)
  cpf?: string;

  @ApiPropertyOptional({ description: 'WhatsApp / phone number' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  whatsapp?: string;

  @ApiPropertyOptional({
    example: 'cpf',
    enum: ['cpf', 'cnpj', 'email', 'phone', 'random'],
    description: 'PIX key type',
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

  @ApiPropertyOptional({
    description: 'PIX key value — formato validado e normalizado por tipo',
  })
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

export class UpdateStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status!: UserStatus;

  /** Betting house slug — sent by the approval modal, ignored by updateStatus/approveByReferrer */
  @ApiPropertyOptional({ example: 'superbet' })
  @IsOptional()
  @IsString()
  bettingHouse?: string;

  /** CPA commission — sent by the approval modal, currently informational only */
  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cpa?: number;

  /** RevShare commission — sent by the approval modal, currently informational only */
  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  revshare?: number;
}

export class UpdateUserPasswordDto {
  @ApiProperty({
    example: 'StrongPass@123',
    minLength: 8,
    description:
      'New password. Must contain at least 1 uppercase letter, 1 number, and 1 special character.',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/, {
    message:
      'password must contain at least 1 uppercase, 1 number, and 1 special character',
  })
  password!: string;
}

export class UpdateBalanceBlockDto {
  @ApiProperty()
  @IsBoolean()
  blocked!: boolean;

  @ApiPropertyOptional({
    description: 'Reason shown to admins/audit and optionally to the affiliate',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateExclusiveDealsDto {
  @ApiProperty({
    description:
      'true = usuário enxerga deals exclusivas; false = só públicas.',
  })
  @IsBoolean()
  exclusive!: boolean;

  @ApiPropertyOptional({ description: 'Motivo registrado em auditoria' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateApiAccessDto {
  @ApiProperty({
    description:
      'true = libera as features de API e Webhook para o usuário; false = bloqueia.',
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'Motivo registrado em auditoria' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpsertBalanceAdjustmentDto {
  @ApiProperty({
    description: 'Slug da casa (ex.: superbet). O ajuste é POR casa.',
  })
  @IsString()
  @MaxLength(60)
  bettingHouse!: string;

  @ApiProperty({
    description:
      'Valor do ajuste (SET absoluto, não incremental). Positivo credita, ' +
      'negativo abate do saldo. Ex.: -150 abate R$150 da casa.',
    example: -150,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1_000_000)
  @Max(1_000_000)
  amount!: number;

  @ApiPropertyOptional({ description: 'Motivo registrado em auditoria' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class BalanceAdjustmentResponseDto {
  bettingHouse!: string;
  amount!: number;
  reason!: string | null;
  updatedAt!: string;
}

export class GrantWithdrawalReleaseDto {
  @ApiProperty({
    description: 'Slug da casa (ex.: superbet). "bonus" não é permitido.',
  })
  @IsString()
  @MaxLength(60)
  bettingHouse!: string;

  @ApiPropertyOptional({ description: 'Motivo registrado em auditoria' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
