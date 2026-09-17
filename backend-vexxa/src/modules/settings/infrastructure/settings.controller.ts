import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard, RolesGuard, Roles } from '../../auth/index.js';
import { SettingsService } from '../application/settings.service.js';
import {
  CreateSettingDto,
  UpdateSettingDto,
} from '../application/dto/create-setting.dto.js';
import { SettingResponseDto } from '../application/dto/setting-response.dto.js';

@ApiTags('Admin / Settings')
@ApiBearerAuth()
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // ─── List all settings ────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all settings' })
  @ApiResponse({ status: 200, type: [SettingResponseDto] })
  findAll(): Promise<SettingResponseDto[]> {
    return this.settings.findAll();
  }

  // ─── Get by key ───────────────────────────────────────────────────────────

  @Get(':key')
  @ApiOperation({ summary: 'Get setting by key' })
  @ApiResponse({ status: 200, type: SettingResponseDto })
  @ApiResponse({ status: 404, description: 'Setting not found' })
  findOne(@Param('key') key: string): Promise<SettingResponseDto> {
    return this.settings.findByKey(key);
  }

  // ─── Upsert ───────────────────────────────────────────────────────────────

  @Put(':key')
  @ApiOperation({ summary: 'Create or update setting (upsert)' })
  @ApiResponse({ status: 200, type: SettingResponseDto })
  upsert(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
  ): Promise<SettingResponseDto> {
    return this.settings.set({ ...dto, key });
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete setting by key' })
  @ApiResponse({ status: 204 })
  @ApiResponse({
    status: 403,
    description: 'Protected system setting cannot be deleted',
  })
  @ApiResponse({ status: 404, description: 'Setting not found' })
  delete(@Param('key') key: string): Promise<void> {
    return this.settings.delete(key);
  }
}
