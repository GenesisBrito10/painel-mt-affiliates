import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsIn,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsValidPixKey } from '../../domain/value-objects/is-valid-pix-key.decorator.js';
import {
  PIX_KEY_TYPES,
  validatePixKey,
} from '../../domain/value-objects/pix-key.util.js';

export class CompleteOnboardingDto {
  /**
   * CPF — digits only or formatted (XXX.XXX.XXX-XX).
   * Algorithm validation (Módulo 11) is performed in the service layer.
   */
  @ApiProperty({
    example: '12345678909',
    description: 'CPF (11 dígitos, sem formatação ou com pontos/traço)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[\d.\-]+$/, {
    message: 'cpf deve conter apenas dígitos, pontos e traço',
  })
  @MaxLength(14) // formatted: XXX.XXX.XXX-XX = 14 chars
  cpf!: string;

  /**
   * Birth date in ISO 8601 format (YYYY-MM-DD or full ISO).
   * 18+ validation is performed in the service layer.
   */
  @ApiProperty({
    example: '1990-06-15',
    description: 'Data de nascimento (YYYY-MM-DD)',
  })
  @IsDateString(
    {},
    { message: 'birthDate deve ser uma data válida (ex: 1990-06-15)' },
  )
  birthDate!: string;

  /**
   * WhatsApp number — digits only (10 or 11 digits for Brazil).
   * Frontend should send without formatting.
   */
  @ApiProperty({
    example: '11999990000',
    description: 'WhatsApp (DDD + número, sem formatação)',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d{10,15}$/, {
    message: 'whatsapp deve ter entre 10 e 15 dígitos',
  })
  whatsapp!: string;

  /** PIX key type (cpf | cnpj | email | phone | random) */
  @ApiProperty({
    example: 'cpf',
    enum: ['cpf', 'cnpj', 'email', 'phone', 'random'],
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }: { value: string }) =>
    (value ?? '').toLowerCase().trim(),
  )
  @IsIn([...PIX_KEY_TYPES], {
    message: 'pixKeyType deve ser: cpf, cnpj, email, phone ou random',
  })
  pixKeyType!: string;

  /** PIX key value — formato validado e normalizado (CPF/CNPJ só dígitos, +55 no telefone, e-mail lower). */
  @ApiProperty({ example: '12345678909' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(
    ({ value, obj }: { value: string; obj: { pixKeyType?: string } }) => {
      const r = validatePixKey(obj?.pixKeyType, value);
      return r.ok ? r.normalized : value;
    },
  )
  @IsValidPixKey('pixKeyType')
  pixKey!: string;

  /** Account holder name (must match the PIX account) */
  @ApiProperty({ example: 'João da Silva' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  accountHolder!: string;
}
