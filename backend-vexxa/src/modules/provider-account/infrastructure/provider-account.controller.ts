import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ProviderAccountService } from '../application/provider-account.service.js';
import { JwtAuthGuard, RolesGuard, Roles } from '../../auth/index.js';
import {
  CreateProviderAccountDto,
  UpdateProviderAccountDto,
  AddHouseDto,
  ProviderAccountResponseDto,
} from '../application/dto/provider-account.dto.js';

@ApiTags('Provider Accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPERADMIN)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('admin/provider-accounts')
export class ProviderAccountController {
  constructor(private readonly service: ProviderAccountService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new provider account with encrypted credentials' })
  @ApiResponse({ status: 201, type: ProviderAccountResponseDto })
  create(@Body() dto: CreateProviderAccountDto): Promise<ProviderAccountResponseDto> {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all provider accounts (credentials masked)' })
  @ApiResponse({ status: 200, type: [ProviderAccountResponseDto] })
  findAll(): Promise<ProviderAccountResponseDto[]> {
    return this.service.findAll();
  }

  @Get('by-house')
  @ApiOperation({ summary: 'Find provider accounts by betting house slug' })
  @ApiResponse({ status: 200, type: [ProviderAccountResponseDto] })
  findByHouse(@Query('slug') slug: string): Promise<ProviderAccountResponseDto[]> {
    return this.service.findByHouse(slug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get provider account by ID' })
  @ApiResponse({ status: 200, type: ProviderAccountResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ProviderAccountResponseDto> {
    return this.service.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update provider account (re-encrypts credentials if provided)' })
  @ApiResponse({ status: 200, type: ProviderAccountResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderAccountDto,
  ): Promise<ProviderAccountResponseDto> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete provider account' })
  delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.service.delete(id);
  }

  @Post(':id/houses')
  @ApiOperation({ summary: 'Associate a betting house with this account' })
  @ApiResponse({ status: 201, type: ProviderAccountResponseDto })
  @ApiResponse({ status: 409, description: 'House already associated' })
  addHouse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddHouseDto,
  ): Promise<ProviderAccountResponseDto> {
    return this.service.addHouse(id, dto);
  }

  @Delete(':id/houses/:slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove betting house association' })
  removeHouse(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slug') slug: string,
  ): Promise<void> {
    return this.service.removeHouse(id, slug);
  }
}
