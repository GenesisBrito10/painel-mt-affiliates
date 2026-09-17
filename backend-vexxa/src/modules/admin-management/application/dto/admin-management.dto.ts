import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

const STRONG_PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;
const STRONG_PASSWORD_MESSAGE =
  'password must contain at least 1 uppercase, 1 number, and 1 special character';

export type AdminManageableRole = Extract<UserRole, 'SUPPORT' | 'ADMIN' | 'SUPERADMIN'>;

const ADMIN_ROLES: AdminManageableRole[] = [
  UserRole.SUPPORT,
  UserRole.ADMIN,
  UserRole.SUPERADMIN,
];

export class CreateAdminDto {
  @ApiProperty({ example: 'Maria Operadora', maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({
    example: 'StrongPass@123',
    minLength: 8,
    description: STRONG_PASSWORD_MESSAGE,
  })
  @IsString()
  @MinLength(8)
  @Matches(STRONG_PASSWORD_REGEX, { message: STRONG_PASSWORD_MESSAGE })
  password!: string;

  @ApiProperty({ enum: ADMIN_ROLES, example: UserRole.ADMIN })
  @IsEnum(UserRole)
  role!: AdminManageableRole;
}

export class UpdateAdminDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email?: string;

  @ApiPropertyOptional({ enum: ADMIN_ROLES })
  @IsOptional()
  @IsEnum(UserRole)
  role?: AdminManageableRole;
}

export class ChangeAdminPasswordDto {
  @ApiProperty({
    example: 'StrongPass@123',
    minLength: 8,
    description: STRONG_PASSWORD_MESSAGE,
  })
  @IsString()
  @MinLength(8)
  @Matches(STRONG_PASSWORD_REGEX, { message: STRONG_PASSWORD_MESSAGE })
  password!: string;
}

export class ListAdminsQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome ou email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ADMIN_ROLES })
  @IsOptional()
  @IsEnum(UserRole)
  role?: AdminManageableRole;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
