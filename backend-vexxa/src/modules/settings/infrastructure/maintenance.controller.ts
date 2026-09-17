import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiProperty,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard, Roles } from '../../auth/index.js';
import { SettingsService } from '../application/settings.service.js';

const KEY_ENABLED = 'maintenance_enabled';
const KEY_MESSAGE = 'maintenance_message';
const KEY_TITLE = 'maintenance_title';
const KEY_BANNER_ENABLED = 'maintenance_banner_enabled';
const KEY_BANNER_MESSAGE = 'maintenance_banner_message';
const KEY_BANNER_TITLE = 'maintenance_banner_title';

const DEFAULT_TITLE = 'Sistema em manutenção';
const DEFAULT_MESSAGE =
  'Estamos realizando uma manutenção programada. Voltamos em instantes.';
const DEFAULT_BANNER_TITLE = 'Instabilidade temporária';
const DEFAULT_BANNER_MESSAGE =
  'Estamos passando por uma instabilidade no painel. Tudo deve voltar ao normal em breve.';

export class MaintenanceResponseDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() title!: string;
  @ApiProperty() message!: string;
  @ApiProperty() bannerEnabled!: boolean;
  @ApiProperty() bannerTitle!: string;
  @ApiProperty() bannerMessage!: string;
}

export class UpdateMaintenanceDto {
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) title?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) message?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() bannerEnabled?: boolean;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(120) bannerTitle?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(500) bannerMessage?: string;
}

async function readState(settings: SettingsService): Promise<MaintenanceResponseDto> {
  const map = await settings.getMany([
    KEY_ENABLED,
    KEY_MESSAGE,
    KEY_TITLE,
    KEY_BANNER_ENABLED,
    KEY_BANNER_MESSAGE,
    KEY_BANNER_TITLE,
  ]);
  return {
    enabled: (map.get(KEY_ENABLED) ?? 'false').toLowerCase() === 'true',
    title: map.get(KEY_TITLE) ?? DEFAULT_TITLE,
    message: map.get(KEY_MESSAGE) ?? DEFAULT_MESSAGE,
    bannerEnabled: (map.get(KEY_BANNER_ENABLED) ?? 'false').toLowerCase() === 'true',
    bannerTitle: map.get(KEY_BANNER_TITLE) ?? DEFAULT_BANNER_TITLE,
    bannerMessage: map.get(KEY_BANNER_MESSAGE) ?? DEFAULT_BANNER_MESSAGE,
  };
}

@ApiTags('Maintenance')
@Controller({ path: 'maintenance', version: '1' })
export class MaintenanceController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Public maintenance flag' })
  async get(): Promise<MaintenanceResponseDto> {
    return readState(this.settings);
  }
}

@ApiTags('Admin / Maintenance')
@ApiBearerAuth()
@Controller({ path: 'admin/maintenance', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class AdminMaintenanceController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get maintenance state' })
  async get(): Promise<MaintenanceResponseDto> {
    return readState(this.settings);
  }

  @Put()
  @ApiOperation({ summary: 'Update maintenance state' })
  async update(@Body() dto: UpdateMaintenanceDto): Promise<MaintenanceResponseDto> {
    if (typeof dto.enabled === 'boolean') {
      await this.settings.set({
        key: KEY_ENABLED,
        value: dto.enabled ? 'true' : 'false',
        label: 'Manutenção · Ativo',
      });
    }
    if (typeof dto.title === 'string') {
      await this.settings.set({
        key: KEY_TITLE,
        value: dto.title.trim() || DEFAULT_TITLE,
        label: 'Manutenção · Título',
      });
    }
    if (typeof dto.message === 'string') {
      await this.settings.set({
        key: KEY_MESSAGE,
        value: dto.message.trim() || DEFAULT_MESSAGE,
        label: 'Manutenção · Mensagem',
      });
    }
    if (typeof dto.bannerEnabled === 'boolean') {
      await this.settings.set({
        key: KEY_BANNER_ENABLED,
        value: dto.bannerEnabled ? 'true' : 'false',
        label: 'Manutenção · Banner ativo',
      });
    }
    if (typeof dto.bannerTitle === 'string') {
      await this.settings.set({
        key: KEY_BANNER_TITLE,
        value: dto.bannerTitle.trim() || DEFAULT_BANNER_TITLE,
        label: 'Manutenção · Banner título',
      });
    }
    if (typeof dto.bannerMessage === 'string') {
      await this.settings.set({
        key: KEY_BANNER_MESSAGE,
        value: dto.bannerMessage.trim() || DEFAULT_BANNER_MESSAGE,
        label: 'Manutenção · Banner mensagem',
      });
    }
    return readState(this.settings);
  }
}
