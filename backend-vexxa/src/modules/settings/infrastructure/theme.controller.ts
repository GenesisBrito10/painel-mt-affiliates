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
import { IsHexColor, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard, Roles } from '../../auth/index.js';
import { SettingsService } from '../application/settings.service.js';

// ─── Theme Keys & Defaults ────────────────────────────────────────────────────
// Stored under generic `Setting` table. Keys obey existing regex /^[a-z_]+$/.

const THEME_KEYS = [
  'theme_brand',
  'theme_accent',
  'theme_info',
  'theme_positive',
  'theme_negative',
  'theme_warning',
  'theme_sidebar_bg',
  'theme_sidebar_text',
  'theme_sidebar_active',
] as const;

type ThemeKey = (typeof THEME_KEYS)[number];

const DEFAULTS: Record<ThemeKey, string> = {
  theme_brand: '#F59E0B',
  theme_accent: '#7C3AED',
  theme_info: '#7C3AED',
  theme_positive: '#22C55E',
  theme_negative: '#EF4444',
  theme_warning: '#F59E0B',
  theme_sidebar_bg: '#0A0A0E',
  theme_sidebar_text: '#A8A8BD',
  theme_sidebar_active: '#FFFFFF',
};

const LEGACY_DEFAULTS: Partial<Record<ThemeKey, string>> = {
  theme_brand: '#7b34e8',
  theme_info: '#3B82F6',
};

function resolveThemeValue(key: ThemeKey, stored?: string): string {
  if (!stored) return DEFAULTS[key];
  const legacy = LEGACY_DEFAULTS[key];
  return legacy && stored.toLowerCase() === legacy.toLowerCase()
    ? DEFAULTS[key]
    : stored;
}

const KEY_TO_FIELD: Record<ThemeKey, keyof ThemeResponseDto> = {
  theme_brand: 'brand',
  theme_accent: 'accent',
  theme_info: 'info',
  theme_positive: 'positive',
  theme_negative: 'negative',
  theme_warning: 'warning',
  theme_sidebar_bg: 'sidebarBg',
  theme_sidebar_text: 'sidebarText',
  theme_sidebar_active: 'sidebarActive',
};

const FIELD_TO_KEY: Record<keyof ThemeResponseDto, ThemeKey> = {
  brand: 'theme_brand',
  accent: 'theme_accent',
  info: 'theme_info',
  positive: 'theme_positive',
  negative: 'theme_negative',
  warning: 'theme_warning',
  sidebarBg: 'theme_sidebar_bg',
  sidebarText: 'theme_sidebar_text',
  sidebarActive: 'theme_sidebar_active',
};

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export class ThemeResponseDto {
  @ApiProperty() brand!: string;
  @ApiProperty() accent!: string;
  @ApiProperty() info!: string;
  @ApiProperty() positive!: string;
  @ApiProperty() negative!: string;
  @ApiProperty() warning!: string;
  @ApiProperty() sidebarBg!: string;
  @ApiProperty() sidebarText!: string;
  @ApiProperty() sidebarActive!: string;
}

export class UpdateThemeDto {
  @ApiProperty({ required: false }) @IsOptional() @IsHexColor() brand?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsHexColor() accent?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsHexColor() info?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsHexColor() positive?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsHexColor() negative?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsHexColor() warning?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsHexColor() sidebarBg?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsHexColor() sidebarText?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsHexColor() sidebarActive?: string;
}

// ─── Public Theme Controller ─────────────────────────────────────────────────

@ApiTags('Theme')
@Controller({ path: 'theme', version: '1' })
export class ThemeController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Public theme palette (CSS variables source)' })
  async getTheme(): Promise<ThemeResponseDto> {
    const map = await this.settings.getMany([...THEME_KEYS]);
    const out = {} as ThemeResponseDto;
    for (const key of THEME_KEYS) {
      const field = KEY_TO_FIELD[key];
      out[field] = resolveThemeValue(key, map.get(key));
    }
    return out;
  }
}

// ─── Admin Theme Controller ──────────────────────────────────────────────────

@ApiTags('Admin / Theme')
@ApiBearerAuth()
@Controller({ path: 'admin/theme', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class AdminThemeController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get current theme palette' })
  async get(): Promise<ThemeResponseDto> {
    const map = await this.settings.getMany([...THEME_KEYS]);
    const out = {} as ThemeResponseDto;
    for (const key of THEME_KEYS) {
      out[KEY_TO_FIELD[key]] = resolveThemeValue(key, map.get(key));
    }
    return out;
  }

  @Put()
  @ApiOperation({ summary: 'Update theme palette (partial)' })
  async update(@Body() dto: UpdateThemeDto): Promise<ThemeResponseDto> {
    for (const field of Object.keys(dto) as Array<keyof UpdateThemeDto>) {
      const value = dto[field];
      if (typeof value !== 'string' || !value) continue;
      const key = FIELD_TO_KEY[field];
      await this.settings.set({ key, value, label: `Tema · ${field}` });
    }
    return this.get();
  }
}
