import { IsEmail, IsNotEmpty, MinLength, MaxLength, IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckEmailAvailabilityDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({ example: 'StrongPass@123', minLength: 6 })
  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'raw-reset-token' })
  @IsNotEmpty()
  @IsString()
  token!: string;

  @ApiProperty({ example: 'StrongPass@123', minLength: 8 })
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/, {
    message: 'password must contain at least 1 uppercase, 1 number, and 1 special character',
  })
  password!: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'João Silva' })
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  @Transform(({ value }: { value: string }) => value?.trim())
  name!: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({ example: 'StrongPass@123', minLength: 8 })
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(64)
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/, {
    message: 'password must contain at least 1 uppercase, 1 number, and 1 special character',
  })
  password!: string;

  @ApiPropertyOptional({ example: 'ABC123', description: 'Referral code of the referrer' })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim().toUpperCase())
  referralCode?: string;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['AFFILIATE', 'SUPPORT', 'ADMIN', 'SUPERADMIN'] })
  role!: string;
}
