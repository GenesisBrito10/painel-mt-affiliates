import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { FastifyThrottlerGuard } from '../../../../common/guards/fastify-throttler.guard.js';
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  type JwtPayload,
} from '../../../auth/index.js';
import { readMultipartFile } from '../../../file-upload/multipart.helper.js';
import { SupportChatService } from '../../application/support-chat.service.js';
import {
  getBusinessHoursOverride,
  isWithinBusinessHours,
  setBusinessHoursOverride,
} from '../../domain/business-hours.util.js';
import {
  AdminListConversationsQueryDto,
  AssignConversationDto,
  ConversationDetailQueryDto,
  CreateConversationDto,
  EditMessageDto,
  ListConversationsQueryDto,
  SendMessageDto,
  ToggleBusinessHoursBypassDto,
  UpdateConversationTagsDto,
} from '../../application/dto/support-chat.dto.js';

@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'support', version: '1' })
export class SupportChatStatusController {
  @Get('status')
  getStatus() {
    return { open: isWithinBusinessHours() };
  }
}

@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'support/conversations', version: '1' })
export class SupportChatController {
  constructor(private readonly supportChat: SupportChatService) {}

  @Post()
  createConversation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateConversationDto,
  ) {
    return this.supportChat.createConversation(user, dto);
  }

  @Get()
  listConversations(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.supportChat.listForUser(user, query);
  }

  @Get(':id')
  getConversation(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: ConversationDetailQueryDto,
  ) {
    return this.supportChat.getConversationForUser(id, user, query);
  }

  @Post(':id/messages')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.supportChat.sendMessage(id, user, dto);
  }

  @Patch(':id/messages/:messageId')
  editMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.supportChat.editMessage(id, messageId, user, dto.content);
  }

  @Post(':id/close')
  closeConversation(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.supportChat.closeConversation(id, user);
  }

  @Post(':id/attachments')
  @UseGuards(FastifyThrottlerGuard)
  @Throttle({ 'support-attachments': { limit: 10, ttl: 60_000 } })
  async uploadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const file = await readMultipartFile(req);
    return this.supportChat.uploadAttachment(id, user, file);
  }
}

@ApiTags('support/agent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPPORT)
@Controller({ path: 'support/agent', version: '1' })
export class SupportAgentChatController {
  constructor(private readonly supportChat: SupportChatService) {}

  @Get('conversations')
  listConversations(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.supportChat.listForSupportAgent(user, query);
  }

  @Post('conversations/close-all')
  closeAllConversations(@CurrentUser() user: JwtPayload) {
    return this.supportChat.closeAllConversations(user);
  }

  @Get('report/daily')
  getDailyReport(@CurrentUser() user: JwtPayload) {
    return this.supportChat.getDailyReport(user.sub);
  }

  @Get('conversations/:id')
  getConversation(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: ConversationDetailQueryDto,
  ) {
    return this.supportChat.getConversationForUser(id, user, query);
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.supportChat.sendMessage(id, user, dto);
  }

  @Patch('conversations/:id/messages/:messageId')
  editMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.supportChat.editMessage(id, messageId, user, dto.content);
  }

  @Patch('conversations/:id/tags')
  setConversationTags(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateConversationTagsDto,
  ) {
    return this.supportChat.setConversationTags(id, user, dto.tags);
  }

  @Post('conversations/:id/close')
  closeConversation(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.supportChat.closeConversation(id, user);
  }

  @Post('availability')
  setAvailability(
    @CurrentUser() user: JwtPayload,
    @Body() body: { isOnline?: boolean },
  ) {
    return this.supportChat.setAgentAvailability(
      user.sub,
      body?.isOnline !== false,
    );
  }

  @Post('conversations/:id/attachments')
  @UseGuards(FastifyThrottlerGuard)
  @Throttle({ 'support-attachments': { limit: 10, ttl: 60_000 } })
  async uploadAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ) {
    const file = await readMultipartFile(req);
    return this.supportChat.uploadAttachment(id, user, file);
  }
}

@ApiTags('admin/support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
@Controller({ path: 'admin/support', version: '1' })
export class AdminSupportChatController {
  constructor(private readonly supportChat: SupportChatService) {}

  @Get('conversations')
  listConversations(@Query() query: AdminListConversationsQueryDto) {
    return this.supportChat.listForAdmin(query);
  }

  @Get('conversations/:id')
  getConversation(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: ConversationDetailQueryDto,
  ) {
    return this.supportChat.getConversationForUser(id, user, query);
  }

  @Patch('conversations/:id/assign')
  assignConversation(
    @Param('id') id: string,
    @Body() dto: AssignConversationDto,
  ) {
    return this.supportChat.assignConversation(id, dto.agentId);
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.supportChat.sendMessage(id, user, dto);
  }

  @Post('conversations/:id/close')
  closeConversation(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.supportChat.closeConversation(id, user);
  }

  @Get('agents/availability')
  listAgentAvailability() {
    return this.supportChat.listAgentAvailability();
  }

  @Get('business-hours')
  getBusinessHours() {
    return { bypassEnabled: getBusinessHoursOverride() };
  }

  @Post('business-hours/bypass')
  toggleBusinessHoursBypass(@Body() dto: ToggleBusinessHoursBypassDto) {
    const enabled = dto?.enabled !== false;
    setBusinessHoursOverride(enabled);
    return { bypassEnabled: enabled };
  }
}
