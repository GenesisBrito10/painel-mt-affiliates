import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  ConversationStatus,
  MessageSenderRole,
  UserRole,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from '../../auth/index.js';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  FileUploadService,
} from '../../file-upload/file-upload.service.js';
import {
  AgentAssignmentDeniedException,
  ConversationAccessDeniedException,
  ConversationClosedException,
  ConversationNotFoundException,
  InvalidMessageContentException,
  MessageEditDeniedException,
  MessageNotFoundException,
  OutsideBusinessHoursException,
} from '../domain/exceptions/support-chat.exceptions.js';
import {
  getSaoPauloStartOfDay,
  isWithinBusinessHours,
} from '../domain/business-hours.util.js';
import type {
  SupportAgentAvailabilityDto,
  SupportConversationAssignmentDto,
  SupportConversationDto,
  SupportConversationListResult,
  SupportDailyReportDto,
  SupportMessageDto,
} from '../domain/types/support-chat.types.js';
import type {
  AdminListConversationsQueryDto,
  ConversationDetailQueryDto,
  CreateConversationDto,
  ListConversationsQueryDto,
} from './dto/support-chat.dto.js';
import { SupportChatEvents } from './support-chat-events.service.js';

const CONVERSATION_INCLUDE = {
  affiliate: { select: { id: true, name: true, email: true } },
  agent: { select: { id: true, name: true, email: true } },
} satisfies Prisma.SupportConversationInclude;

const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true, email: true } },
} satisfies Prisma.SupportMessageInclude;

const CONVERSATION_LIST_INCLUDE = {
  ...CONVERSATION_INCLUDE,
  messages: {
    include: MESSAGE_INCLUDE,
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} satisfies Prisma.SupportConversationInclude;

const SUPPORT_AGENT_MAX_CAPACITY = 50;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

export type SendMessagePayload = Pick<
  import('./dto/support-chat.dto.js').SendMessageDto,
  'content' | 'attachmentUrl' | 'attachmentMimeType' | 'attachmentName' | 'attachmentSize'
>;

interface ValidatedAttachment {
  url: string;
  mimeType: string;
  name: string;
  size: number;
}

type ConversationWithPeople = Prisma.SupportConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;

type MessageWithSender = Prisma.SupportMessageGetPayload<{
  include: typeof MESSAGE_INCLUDE;
}>;

type ConversationListItem = Prisma.SupportConversationGetPayload<{
  include: typeof CONVERSATION_LIST_INCLUDE;
}>;

@Injectable()
export class SupportChatService implements OnModuleInit {
  private readonly logger = new Logger(SupportChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: SupportChatEvents,
    private readonly fileUpload: FileUploadService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.supportAgentAvailability.updateMany({
        where: { isOnline: true },
        data: { isOnline: false },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not reset support agent availability during startup: ${message}`,
      );
    }
  }

  async createConversation(
    user: JwtPayload,
    dto: CreateConversationDto,
  ): Promise<SupportConversationDto> {
    if (user.role !== UserRole.AFFILIATE) {
      throw new ForbiddenException('Apenas afiliados podem abrir atendimento.');
    }

    if (!isWithinBusinessHours()) {
      throw new OutsideBusinessHoursException();
    }

    const subject = dto.subject?.trim() || dto.triageTopic?.trim() || null;
    const triggerMessage = dto.triageRequestedHuman
      ? dto.triageTriggerMessage?.trim() || 'falar com atendente'
      : null;
    const triageMessage = this.buildTriageContextMessage(dto);
    const conversation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportConversation.create({
        data: {
          affiliateId: user.sub,
          subject,
        },
        include: CONVERSATION_INCLUDE,
      });

      if (triggerMessage) {
        await tx.supportMessage.create({
          data: {
            conversationId: created.id,
            senderId: user.sub,
            senderRole: MessageSenderRole.AFFILIATE,
            content: triggerMessage,
          },
        });
      }

      if (triageMessage) {
        await tx.supportMessage.create({
          data: {
            conversationId: created.id,
            senderId: user.sub,
            senderRole: MessageSenderRole.AFFILIATE,
            content: triageMessage,
          },
        });
      }

      return created;
    });

    const assigned = await this.assignNextAvailableAgent(conversation.id);
    const created = await this.getConversationForUser(
      assigned?.id ?? conversation.id,
      user,
    );
    this.events.emit({ type: 'conversation:created', conversation: created });
    return created;
  }

  async listForUser(
    user: JwtPayload,
    query: ListConversationsQueryDto,
  ): Promise<SupportConversationListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SupportConversationWhereInput = {
      affiliateId: user.sub,
      ...(query.status
        ? { status: this.toConversationStatus(query.status) }
        : {}),
    };

    const [total, conversations] = await this.prisma.$transaction([
      this.prisma.supportConversation.count({ where }),
      this.prisma.supportConversation.findMany({
        where,
        include: CONVERSATION_LIST_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: conversations.map((conversation) =>
        this.mapConversationListItem(conversation),
      ),
      total,
      page,
      limit,
    };
  }

  async listForAdmin(
    query: AdminListConversationsQueryDto,
  ): Promise<SupportConversationListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const affiliateSearch = query.affiliateSearch?.trim();
    const where: Prisma.SupportConversationWhereInput = {
      ...(query.status
        ? { status: this.toConversationStatus(query.status) }
        : {}),
      ...(query.agentId ? { agentId: query.agentId } : {}),
      ...(query.affiliateId ? { affiliateId: query.affiliateId } : {}),
      ...(affiliateSearch
        ? {
            affiliate: {
              OR: [
                { name: { contains: affiliateSearch, mode: 'insensitive' } },
                { email: { contains: affiliateSearch, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [total, conversations] = await this.prisma.$transaction([
      this.prisma.supportConversation.count({ where }),
      this.prisma.supportConversation.findMany({
        where,
        include: CONVERSATION_LIST_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: conversations.map((conversation) =>
        this.mapConversationListItem(conversation),
      ),
      total,
      page,
      limit,
    };
  }

  async listForSupportAgent(
    user: JwtPayload,
    query: ListConversationsQueryDto,
  ): Promise<SupportConversationListResult> {
    if (user.role !== UserRole.SUPPORT) {
      throw new ForbiddenException(
        'Apenas suporte pode acessar a fila de atendimento.',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.SupportConversationWhereInput = {
      agentId: user.sub,
      ...(query.status
        ? { status: this.toConversationStatus(query.status) }
        : {
            status: {
              in: [
                ConversationStatus.OPEN,
                ConversationStatus.WAITING_USER,
                ConversationStatus.WAITING,
              ],
            },
          }),
    };

    const [total, conversations, unreadRows] = await this.prisma.$transaction([
      this.prisma.supportConversation.count({ where }),
      this.prisma.supportConversation.findMany({
        where,
        include: CONVERSATION_LIST_INCLUDE,
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.supportMessage.groupBy({
        by: ['conversationId'],
        where: {
          senderRole: MessageSenderRole.AFFILIATE,
          readAt: null,
          conversation: where,
        },
        _count: { _all: true },
      }),
    ]);
    const unreadByConversation = new Map(
      unreadRows.map((row) => [row.conversationId, row._count._all]),
    );

    return {
      data: conversations.map((conversation) =>
        this.mapConversationListItem(
          conversation,
          unreadByConversation.get(conversation.id) ?? 0,
        ),
      ),
      total,
      page,
      limit,
    };
  }

  async getConversationForUser(
    conversationId: string,
    user: JwtPayload,
    query: ConversationDetailQueryDto = {},
  ): Promise<SupportConversationDto> {
    const messagesPage = query.messagesPage ?? 1;
    const messagesLimit = query.messagesLimit ?? 100;
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include: {
        ...CONVERSATION_INCLUDE,
        assignments: {
          orderBy: { assignedAt: 'asc' },
        },
      },
    });

    if (!conversation) throw new ConversationNotFoundException();
    this.assertCanAccessConversation(conversation, user);
    await this.markConversationMessagesAsRead(conversationId, user.sub);

    const [messagesTotal, messages] = await this.prisma.$transaction([
      this.prisma.supportMessage.count({ where: { conversationId } }),
      this.prisma.supportMessage.findMany({
        where: { conversationId },
        include: MESSAGE_INCLUDE,
        orderBy: { createdAt: 'asc' },
        skip: (messagesPage - 1) * messagesLimit,
        take: messagesLimit,
      }),
    ]);

    return this.mapConversation(
      conversation,
      messages,
      conversation.assignments,
      { total: messagesTotal, page: messagesPage, limit: messagesLimit },
    );
  }

  async sendMessage(
    conversationId: string,
    user: JwtPayload,
    payload: SendMessagePayload,
  ): Promise<SupportMessageDto> {
    const content = (payload.content ?? '').trim();
    const attachment = this.validateAttachment(payload);

    if (content.length > 2000) {
      throw new InvalidMessageContentException();
    }
    if (content.length === 0 && !attachment) {
      throw new InvalidMessageContentException();
    }

    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw new ConversationNotFoundException();
    if (conversation.status === ConversationStatus.CLOSED) {
      throw new ConversationClosedException();
    }
    this.assertCanWriteConversation(conversation, user);

    const senderRole =
      user.role === UserRole.AFFILIATE
        ? MessageSenderRole.AFFILIATE
        : MessageSenderRole.AGENT;

    if (senderRole === MessageSenderRole.AFFILIATE && !isWithinBusinessHours()) {
      throw new OutsideBusinessHoursException();
    }
    const nextStatus = this.resolveStatusAfterMessage(
      conversation.status,
      senderRole,
    );
    let updatedConversation: ConversationWithPeople | null = null;

    const message = await this.prisma.$transaction(async (tx) => {
      // Re-verify inside the transaction to prevent race condition where
      // closeAllConversations() closes the conversation between the initial
      // check above and this update, which would incorrectly revert CLOSED → OPEN.
      const current = await tx.supportConversation.findUnique({
        where: { id: conversationId },
        select: { status: true },
      });
      if (!current || current.status === ConversationStatus.CLOSED) {
        throw new ConversationClosedException();
      }

      const created = await tx.supportMessage.create({
        data: {
          conversationId,
          senderId: user.sub,
          senderRole,
          content,
          attachmentUrl: attachment?.url ?? null,
          attachmentMimeType: attachment?.mimeType ?? null,
          attachmentName: attachment?.name ?? null,
          attachmentSize: attachment?.size ?? null,
        },
        include: MESSAGE_INCLUDE,
      });

      updatedConversation = await tx.supportConversation.update({
        where: { id: conversationId },
        data: {
          status: nextStatus,
          updatedAt: new Date(),
        },
        include: CONVERSATION_INCLUDE,
      });

      return created;
    });

    const mapped = this.mapMessage(message);
    this.events.emit({ type: 'message:new', message: mapped });
    if (updatedConversation) {
      const conversationMapped = this.mapConversation(updatedConversation);
      const wasReopened =
        conversation.status === ConversationStatus.WAITING_USER &&
        nextStatus === ConversationStatus.OPEN;
      this.events.emit({
        type: wasReopened ? 'conversation:reopened' : 'conversation:updated',
        conversation: conversationMapped,
      });
    }
    return mapped;
  }

  async editMessage(
    conversationId: string,
    messageId: string,
    user: JwtPayload,
    newContent: string,
  ): Promise<SupportMessageDto> {
    const content = newContent.trim();
    if (content.length === 0 || content.length > 2000) {
      throw new InvalidMessageContentException();
    }

    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw new ConversationNotFoundException();
    if (conversation.status === ConversationStatus.CLOSED) {
      throw new ConversationClosedException();
    }
    this.assertCanWriteConversation(conversation, user);

    const existing = await this.prisma.supportMessage.findUnique({
      where: { id: messageId },
    });
    if (!existing || existing.conversationId !== conversationId) {
      throw new MessageNotFoundException();
    }
    if (existing.senderId !== user.sub) {
      throw new MessageEditDeniedException();
    }

    const updated = await this.prisma.supportMessage.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
      include: MESSAGE_INCLUDE,
    });

    const mapped = this.mapMessage(updated);
    this.events.emit({ type: 'message:updated', message: mapped });
    return mapped;
  }

  async setConversationTags(
    conversationId: string,
    user: JwtPayload,
    tags: string[],
  ): Promise<SupportConversationDto> {
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw new ConversationNotFoundException();
    this.assertCanWriteConversation(conversation, user);

    const updated = await this.prisma.supportConversation.update({
      where: { id: conversationId },
      data: { tags },
      include: CONVERSATION_INCLUDE,
    });

    const mapped = this.mapConversation(updated);
    this.events.emit({ type: 'conversation:updated', conversation: mapped });
    return mapped;
  }

  async uploadAttachment(
    conversationId: string,
    user: JwtPayload,
    params: { buffer: Buffer; mimeType: string; filename: string },
  ) {
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw new ConversationNotFoundException();
    if (conversation.status === ConversationStatus.CLOSED) {
      throw new ConversationClosedException();
    }
    this.assertCanWriteConversation(conversation, user);

    return this.fileUpload.uploadObject({
      ...params,
      scopePrefix: `support/${conversationId}`,
    });
  }

  async closeConversation(
    conversationId: string,
    user: JwtPayload,
  ): Promise<SupportConversationDto> {
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw new ConversationNotFoundException();
    if (conversation.status === ConversationStatus.CLOSED) {
      return this.mapConversation(conversation);
    }
    this.assertCanWriteConversation(conversation, user);

    const closedByRole =
      user.role === UserRole.AFFILIATE ? 'affiliate' : 'agent';
    const closed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supportConversation.update({
        where: { id: conversationId },
        data: {
          status: ConversationStatus.CLOSED,
          closedAt: new Date(),
          closedByRole,
        },
        include: CONVERSATION_INCLUDE,
      });

      await tx.supportConversationAssignment.updateMany({
        where: { conversationId, releasedAt: null },
        data: { releasedAt: new Date() },
      });

      return updated;
    });

    const mapped = this.mapConversation(closed);
    this.events.emit({ type: 'conversation:closed', conversation: mapped });
    if (isWithinBusinessHours()) {
      await this.assignWaitingConversations();
    }
    return mapped;
  }

  async assignConversation(
    conversationId: string,
    agentId: string,
    options: { drainWaiting?: boolean } = { drainWaiting: true },
  ): Promise<SupportConversationDto> {
    const agent = await this.prisma.user.findFirst({
      where: { id: agentId, role: UserRole.SUPPORT },
      select: { id: true, name: true, email: true },
    });
    if (!agent) throw new BadRequestException('Agente não encontrado.');

    let previousAgentId: string | null = null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.supportConversation.findUnique({
        where: { id: conversationId },
        select: { id: true, agentId: true, status: true },
      });
      if (!conversation) throw new ConversationNotFoundException();
      if (conversation.status === ConversationStatus.CLOSED) {
        throw new ConversationClosedException();
      }
      previousAgentId = conversation.agentId;
      if (conversation.agentId !== agent.id) {
        const activeConversations = await tx.supportConversation.count({
          where: {
            agentId: agent.id,
            status: {
              in: [ConversationStatus.OPEN, ConversationStatus.WAITING_USER],
            },
          },
        });
        if (activeConversations >= SUPPORT_AGENT_MAX_CAPACITY) {
          throw new BadRequestException(
            `Este suporte atingiu o limite máximo de ${SUPPORT_AGENT_MAX_CAPACITY} atendimentos abertos.`,
          );
        }
      }

      await tx.supportConversationAssignment.updateMany({
        where: { conversationId, releasedAt: null },
        data: { releasedAt: new Date() },
      });

      await tx.supportConversationAssignment.create({
        data: {
          conversationId,
          agentId: agent.id,
          agentName: agent.name,
          agentEmail: agent.email,
        },
      });

      await tx.supportAgentAvailability.upsert({
        where: { agentId: agent.id },
        create: {
          agentId: agent.id,
          isOnline: true,
          lastAssignedAt: new Date(),
        },
        update: { lastAssignedAt: new Date() },
      });

      return tx.supportConversation.update({
        where: { id: conversationId },
        data: {
          agentId: agent.id,
          status: ConversationStatus.OPEN,
        },
        include: CONVERSATION_INCLUDE,
      });
    });

    const mapped = this.mapConversation(updated);
    this.events.emit({ type: 'conversation:assigned', conversation: mapped });
    if (
      options.drainWaiting &&
      previousAgentId &&
      previousAgentId !== agent.id
    ) {
      await this.assignWaitingConversations();
    }
    return mapped;
  }

  async setAgentAvailability(
    agentId: string,
    isOnline: boolean,
  ): Promise<SupportAgentAvailabilityDto> {
    const agent = await this.prisma.user.findFirst({
      where: { id: agentId, role: UserRole.SUPPORT },
      select: { id: true, name: true, email: true },
    });
    if (!agent) throw new BadRequestException('Agente não encontrado.');

    const availability = await this.prisma.supportAgentAvailability.upsert({
      where: { agentId },
      create: { agentId, isOnline },
      update: { isOnline },
      include: { agent: { select: { id: true, name: true, email: true } } },
    });

    if (isOnline && isWithinBusinessHours()) await this.assignWaitingConversations();

    const activeConversations = await this.prisma.supportConversation.count({
      where: {
        agentId,
        status: {
          in: [ConversationStatus.OPEN, ConversationStatus.WAITING_USER],
        },
      },
    });

    const status = {
      agentId: availability.agentId,
      agentName: availability.agent.name,
      agentEmail: availability.agent.email,
      isOnline: availability.isOnline,
      lastAssignedAt: availability.lastAssignedAt,
      updatedAt: availability.updatedAt,
      activeConversations,
    };
    this.events.emit({ type: 'agent:status-changed', status });
    return status;
  }

  async listAgentAvailability(): Promise<SupportAgentAvailabilityDto[]> {
    const rows = await this.prisma.supportAgentAvailability.findMany({
      include: { agent: { select: { id: true, name: true, email: true } } },
      orderBy: [{ isOnline: 'desc' }, { updatedAt: 'desc' }],
    });

    const activeCounts = await this.prisma.supportConversation.groupBy({
      by: ['agentId'],
      where: {
        status: {
          in: [ConversationStatus.OPEN, ConversationStatus.WAITING_USER],
        },
        agentId: { not: null },
      },
      _count: { _all: true },
    });
    const countByAgent = new Map(
      activeCounts.map((row) => [row.agentId, row._count._all]),
    );

    return rows.map((row) => ({
      agentId: row.agentId,
      agentName: row.agent.name,
      agentEmail: row.agent.email,
      isOnline: row.isOnline,
      lastAssignedAt: row.lastAssignedAt,
      updatedAt: row.updatedAt,
      activeConversations: countByAgent.get(row.agentId) ?? 0,
    }));
  }

  async assignNextAvailableAgent(
    conversationId: string,
  ): Promise<SupportConversationDto | null> {
    const onlineAgents = await this.prisma.supportAgentAvailability.findMany({
      where: { isOnline: true },
      include: { agent: { select: { id: true, name: true, email: true } } },
      orderBy: [{ lastAssignedAt: 'asc' }, { updatedAt: 'asc' }],
    });

    if (!onlineAgents.length) return null;

    const activeCounts = await this.prisma.supportConversation.groupBy({
      by: ['agentId'],
      where: {
        status: {
          in: [ConversationStatus.OPEN, ConversationStatus.WAITING_USER],
        },
        agentId: { in: onlineAgents.map((agent) => agent.agentId) },
      },
      _count: { _all: true },
    });
    const activeByAgent = new Map(
      activeCounts.map((row) => [row.agentId, row._count._all]),
    );

    const candidates = onlineAgents.map((agent) => ({
      agent,
      activeConversations: activeByAgent.get(agent.agentId) ?? 0,
    }));
    const pool = candidates.filter(
      (candidate) => candidate.activeConversations < SUPPORT_AGENT_MAX_CAPACITY,
    );
    if (!pool.length) return null;

    pool.sort((left, right) => {
      const activeDiff = left.activeConversations - right.activeConversations;
      if (activeDiff !== 0) return activeDiff;

      const leftAssigned = left.agent.lastAssignedAt?.getTime() ?? 0;
      const rightAssigned = right.agent.lastAssignedAt?.getTime() ?? 0;
      if (leftAssigned !== rightAssigned) return leftAssigned - rightAssigned;

      return left.agent.updatedAt.getTime() - right.agent.updatedAt.getTime();
    });

    return this.assignConversation(conversationId, pool[0].agent.agentId, {
      drainWaiting: false,
    });
  }

  async closeAllConversations(
    user: JwtPayload,
  ): Promise<{ closed: number }> {
    if (user.role !== UserRole.SUPPORT) {
      throw new ForbiddenException('Apenas agentes de suporte podem encerrar todas as conversas.');
    }

    const active = await this.prisma.supportConversation.findMany({
      where: {
        agentId: user.sub,
        status: { in: [ConversationStatus.OPEN, ConversationStatus.WAITING_USER] },
      },
      include: CONVERSATION_INCLUDE,
    });

    if (active.length === 0) return { closed: 0 };

    const ids = active.map((c) => c.id);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.supportConversation.updateMany({
        where: { id: { in: ids } },
        data: { status: ConversationStatus.CLOSED, closedAt: now, closedByRole: 'agent' },
      }),
      this.prisma.supportConversationAssignment.updateMany({
        where: { conversationId: { in: ids }, releasedAt: null },
        data: { releasedAt: now },
      }),
    ]);

    for (const conv of active) {
      const mapped = this.mapConversation({
        ...conv,
        status: ConversationStatus.CLOSED,
        closedAt: now,
        closedByRole: 'agent',
        updatedAt: now,
      });
      this.events.emit({ type: 'conversation:closed', conversation: mapped });
    }

    if (isWithinBusinessHours()) {
      await this.assignWaitingConversations();
    }
    return { closed: active.length };
  }

  async getDailyReport(agentId: string): Promise<SupportDailyReportDto> {
    const startOfDay = getSaoPauloStartOfDay();
    const dateLabel = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date());

    const [totalCreated, closedConversations] = await this.prisma.$transaction([
      this.prisma.supportConversationAssignment.count({
        where: { agentId, assignedAt: { gte: startOfDay } },
      }),
      this.prisma.supportConversation.findMany({
        where: {
          agentId,
          status: ConversationStatus.CLOSED,
          closedAt: { gte: startOfDay },
        },
        include: {
          affiliate: { select: { id: true, name: true, email: true } },
          messages: {
            orderBy: { createdAt: 'asc' },
            select: { content: true, createdAt: true },
          },
        },
        orderBy: { closedAt: 'desc' },
      }),
    ]);

    return {
      date: dateLabel,
      totalCreated,
      totalClosed: closedConversations.length,
      closedConversations: closedConversations.map((conversation) => {
        const firstMessage =
          conversation.messages.find(
            (message) => !this.isHumanHandoffTrigger(message.content),
          ) ?? conversation.messages[0];
        const lastMessage =
          conversation.messages[conversation.messages.length - 1];

        return {
          id: conversation.id,
          affiliateName: conversation.affiliate.name,
          affiliateEmail: conversation.affiliate.email,
          subject: conversation.subject,
          tags: conversation.tags,
          closedAt: conversation.closedAt,
          closedByRole: conversation.closedByRole,
          firstMessagePreview: firstMessage?.content ?? null,
          lastMessagePreview: lastMessage?.content ?? null,
        };
      }),
    };
  }

  async autoCloseTimedOutConversations(): Promise<number> {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hora

    const timedOut = await this.prisma.supportConversation.findMany({
      where: {
        status: ConversationStatus.WAITING_USER,
        updatedAt: { lt: cutoff },
      },
      include: CONVERSATION_INCLUDE,
    });

    if (timedOut.length === 0) return 0;

    const now = new Date();
    let closed = 0;

    for (const conv of timedOut) {
      if (!conv.agentId) continue;
      try {
        const notifMsg = await this.prisma.$transaction(async (tx) => {
          const msg = await tx.supportMessage.create({
            data: {
              conversationId: conv.id,
              senderId: conv.agentId!,
              senderRole: MessageSenderRole.AGENT,
              content:
                'Seu atendimento foi encerrado automaticamente por inatividade. Se precisar de ajuda, abra um novo atendimento.',
            },
            include: MESSAGE_INCLUDE,
          });

          await tx.supportConversation.updateMany({
            where: { id: conv.id, status: ConversationStatus.WAITING_USER },
            data: {
              status: ConversationStatus.CLOSED,
              closedAt: now,
              closedByRole: 'system',
              updatedAt: now,
            },
          });

          return msg;
        });

        this.events.emit({ type: 'message:new', message: this.mapMessage(notifMsg) });
        this.events.emit({
          type: 'conversation:closed',
          conversation: this.mapConversation({
            ...conv,
            status: ConversationStatus.CLOSED,
            closedAt: now,
            closedByRole: 'system',
            updatedAt: now,
          }),
        });
        closed++;
      } catch {
        // Race condition: conversa já foi atualizada, ignorar
      }
    }

    return closed;
  }

  async autoCloseWaitingConversations(): Promise<number> {
    const waiting = await this.prisma.supportConversation.findMany({
      where: { status: ConversationStatus.WAITING },
      include: CONVERSATION_INCLUDE,
    });

    if (waiting.length === 0) return 0;

    const ids = waiting.map((c) => c.id);
    const now = new Date();
    // Filter by both id AND status to avoid closing conversations that were
    // concurrently assigned (status changed from WAITING to OPEN) between
    // the findMany above and this updateMany.
    await this.prisma.supportConversation.updateMany({
      where: { id: { in: ids }, status: ConversationStatus.WAITING },
      data: { status: ConversationStatus.CLOSED, closedAt: now, closedByRole: 'agent' },
    });

    for (const conv of waiting) {
      const mapped = this.mapConversation({
        ...conv,
        status: ConversationStatus.CLOSED,
        closedAt: now,
        closedByRole: 'agent',
        updatedAt: now,
      });
      this.events.emit({ type: 'conversation:closed', conversation: mapped });
    }

    return waiting.length;
  }

  async assignWaitingConversations(): Promise<void> {
    if (!isWithinBusinessHours()) return;
    for (let index = 0; index < 50; index += 1) {
      const waiting = await this.prisma.supportConversation.findFirst({
        where: { status: ConversationStatus.WAITING },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!waiting) return;

      const assigned = await this.assignNextAvailableAgent(waiting.id);
      if (!assigned) return;
    }
  }

  private assertCanAccessConversation(
    conversation: ConversationWithPeople,
    user: JwtPayload,
  ): void {
    if (user.role === UserRole.SUPERADMIN || user.role === UserRole.ADMIN)
      return;
    if (user.role === UserRole.SUPPORT && conversation.agentId === user.sub)
      return;
    if (conversation.affiliateId === user.sub) return;
    throw new ConversationAccessDeniedException();
  }

  private assertCanWriteConversation(
    conversation: ConversationWithPeople,
    user: JwtPayload,
  ): void {
    if (user.role === UserRole.AFFILIATE) {
      if (conversation.affiliateId !== user.sub) {
        throw new ConversationAccessDeniedException();
      }
      return;
    }

    if (user.role === UserRole.SUPPORT) {
      if (conversation.agentId && conversation.agentId !== user.sub) {
        throw new AgentAssignmentDeniedException();
      }
      if (!conversation.agentId) {
        throw new AgentAssignmentDeniedException();
      }
      return;
    }

    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN)
      return;

    throw new ConversationAccessDeniedException();
  }

  private mapConversation(
    conversation: ConversationWithPeople,
    messages?: MessageWithSender[],
    assignments?: SupportConversationAssignmentDto[],
    messagesMeta?: { total: number; page: number; limit: number },
  ): SupportConversationDto {
    return {
      id: conversation.id,
      affiliateId: conversation.affiliateId,
      affiliateName: conversation.affiliate.name,
      affiliateEmail: conversation.affiliate.email,
      agentId: conversation.agentId,
      agentName: conversation.agent?.name ?? null,
      agentEmail: conversation.agent?.email ?? null,
      status: conversation.status,
      subject: conversation.subject,
      tags: conversation.tags,
      closedAt: conversation.closedAt,
      closedByRole: conversation.closedByRole,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      ...(messages
        ? { messages: messages.map((message) => this.mapMessage(message)) }
        : {}),
      ...(messagesMeta
        ? {
            messagesTotal: messagesMeta.total,
            messagesPage: messagesMeta.page,
            messagesLimit: messagesMeta.limit,
          }
        : {}),
      ...(assignments
        ? {
            assignments: assignments.map((item) => ({
              id: item.id,
              conversationId: item.conversationId,
              agentId: item.agentId,
              agentName: item.agentName,
              agentEmail: item.agentEmail,
              assignedAt: item.assignedAt,
              releasedAt: item.releasedAt,
            })),
          }
        : {}),
    };
  }

  private mapConversationListItem(
    conversation: ConversationListItem,
    unreadCount = 0,
  ): SupportConversationDto {
    return {
      ...this.mapConversation(conversation),
      lastMessage: conversation.messages[0]
        ? this.mapMessage(conversation.messages[0])
        : null,
      unreadCount,
    };
  }

  private mapMessage(message: MessageWithSender): SupportMessageDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      senderName: message.sender.name,
      content: message.content,
      attachmentUrl: message.attachmentUrl ?? null,
      attachmentMimeType: message.attachmentMimeType ?? null,
      attachmentName: message.attachmentName ?? null,
      attachmentSize: message.attachmentSize ?? null,
      readAt: message.readAt,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
    };
  }

  private async markConversationMessagesAsRead(
    conversationId: string,
    readerId: string,
  ): Promise<void> {
    await this.prisma.supportMessage.updateMany({
      where: {
        conversationId,
        senderId: { not: readerId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
  }

  private validateAttachment(
    payload: SendMessagePayload,
  ): ValidatedAttachment | null {
    const url = payload.attachmentUrl?.trim();
    if (!url) return null;

    const mimeType = payload.attachmentMimeType?.trim();
    const name = payload.attachmentName?.trim();
    const size = payload.attachmentSize;

    if (!mimeType || !name || !size) {
      throw new BadRequestException('Anexo inválido: metadados ausentes.');
    }
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(mimeType as never)) {
      throw new BadRequestException('Tipo de anexo não suportado.');
    }
    if (size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new BadRequestException('Anexo excede o tamanho máximo permitido.');
    }

    const prefix = this.fileUpload.publicUrlPrefix;
    if (!url.startsWith(`${prefix}/`)) {
      throw new BadRequestException('URL de anexo inválida.');
    }

    return { url, mimeType, name, size };
  }

  private resolveStatusAfterMessage(
    currentStatus: ConversationStatus,
    senderRole: MessageSenderRole,
  ): ConversationStatus {
    if (
      senderRole === MessageSenderRole.AGENT &&
      currentStatus === ConversationStatus.OPEN
    ) {
      return ConversationStatus.WAITING_USER;
    }
    if (
      senderRole === MessageSenderRole.AFFILIATE &&
      currentStatus === ConversationStatus.WAITING_USER
    ) {
      return ConversationStatus.OPEN;
    }
    return currentStatus;
  }

  private toConversationStatus(
    status: ListConversationsQueryDto['status'],
  ): ConversationStatus {
    return status as ConversationStatus;
  }

  private isHumanHandoffTrigger(content: string): boolean {
    const normalized = content.trim().toLocaleLowerCase('pt-BR');
    return normalized === 'falar com atendente';
  }

  private buildTriageContextMessage(dto: CreateConversationDto): string | null {
    if (!dto.triageRequestedHuman) return null;

    const topic = dto.triageTopic?.trim();
    const content = dto.triageContent?.trim();
    if (!topic && !content) return null;

    return [
      'Contexto da triagem automática',
      topic ? `Tópico selecionado: ${topic}` : null,
      content ? `Resposta exibida ao afiliado:\n${content}` : null,
      'O afiliado solicitou atendimento humano.',
    ]
      .filter(Boolean)
      .join('\n\n');
  }
}
