import { describe, expect, it, vi } from 'vitest';
import { ConversationStatus, MessageSenderRole } from '@prisma/client';
import { SupportChatService } from './support-chat.service.js';
import { isWithinBusinessHours } from '../domain/business-hours.util.js';

// Mock business-hours so tests are not affected by the time they run
vi.mock('../domain/business-hours.util.js', () => ({
  isWithinBusinessHours: vi.fn().mockReturnValue(true),
  getSaoPauloStartOfDay: vi.fn().mockReturnValue(new Date('2026-05-18T00:00:00-03:00')),
}));

const WAITING_USER_STATUS = 'WAITING_USER' as ConversationStatus;
const R2_PUBLIC_URL = 'https://files.vexxa.test';

function makeFileUpload() {
  return {
    publicUrlPrefix: R2_PUBLIC_URL,
    createPresignedUploadUrl: vi.fn(),
  } as any;
}

function makeAgent(
  agentId: string,
  lastAssignedAt: Date | null,
  updatedAt: Date,
) {
  return {
    id: `availability-${agentId}`,
    agentId,
    isOnline: true,
    lastAssignedAt,
    updatedAt,
    agent: {
      id: agentId,
      name: agentId === 'support-a' ? 'Suporte A' : 'Suporte B',
      email: `${agentId}@vexxa.test`,
    },
  };
}

function makeService(
  onlineAgents: ReturnType<typeof makeAgent>[],
  activeCounts: Array<{ agentId: string; count: number }>,
) {
  const prisma = {
    supportAgentAvailability: {
      findMany: vi.fn().mockResolvedValue(onlineAgents),
    },
    supportConversation: {
      groupBy: vi.fn().mockResolvedValue(
        activeCounts.map((row) => ({
          agentId: row.agentId,
          _count: { _all: row.count },
        })),
      ),
    },
  };

  const service = new SupportChatService(prisma as any, { emit: vi.fn() } as any, makeFileUpload());
  vi.spyOn(service, 'assignConversation').mockResolvedValue({} as any);

  return { service, prisma };
}

describe('SupportChatService', () => {
  describe('onModuleInit()', () => {
    it('marks online agents offline during startup', async () => {
      const prisma = {
        supportAgentAvailability: {
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      };
      const service = new SupportChatService(
        prisma as any,
        { emit: vi.fn() } as any,
        makeFileUpload(),
      );

      await service.onModuleInit();

      expect(prisma.supportAgentAvailability.updateMany).toHaveBeenCalledWith({
        where: { isOnline: true },
        data: { isOnline: false },
      });
    });

    it('does not abort application startup when the availability reset fails', async () => {
      const prisma = {
        supportAgentAvailability: {
          updateMany: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        },
      };
      const service = new SupportChatService(
        prisma as any,
        { emit: vi.fn() } as any,
        makeFileUpload(),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('createConversation()', () => {
    it('stores the triage context as the initial affiliate message before human handoff', async () => {
      const now = new Date('2026-05-15T12:00:00Z');
      const conversation = {
        id: 'conversation-triage',
        affiliateId: 'affiliate-001',
        affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        agentId: null,
        agent: null,
        status: ConversationStatus.WAITING,
        subject: '1. Saque / Pagamento',
        closedAt: null,
        closedByRole: null,
        createdAt: now,
        updatedAt: now,
      };
      const tx = {
        supportConversation: {
          create: vi.fn().mockResolvedValue(conversation),
        },
        supportMessage: {
          create: vi.fn().mockResolvedValue({}),
        },
      };
      const prisma = {
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      };
      const service = new SupportChatService(prisma as any, { emit: vi.fn() } as any, makeFileUpload());
      vi.spyOn(service, 'assignNextAvailableAgent').mockResolvedValue(null);
      vi.spyOn(service, 'getConversationForUser').mockResolvedValue({ id: conversation.id } as any);

      await service.createConversation({
        sub: 'affiliate-001',
        email: 'afiliado@vexxa.test',
        role: 'AFFILIATE',
      } as any, {
        subject: '1. Saque / Pagamento',
        triageTopic: '1. Saque / Pagamento',
        triageContent: 'Resposta exibida ao afiliado.',
        triageTriggerMessage: 'falar com atendente',
        triageRequestedHuman: true,
      });

      expect(tx.supportMessage.create).toHaveBeenNthCalledWith(1, {
        data: {
          conversationId: conversation.id,
          senderId: 'affiliate-001',
          senderRole: MessageSenderRole.AFFILIATE,
          content: 'falar com atendente',
        },
      });
      expect(tx.supportMessage.create).toHaveBeenNthCalledWith(2, {
        data: {
          conversationId: conversation.id,
          senderId: 'affiliate-001',
          senderRole: MessageSenderRole.AFFILIATE,
          content: expect.stringContaining('Contexto da triagem automática'),
        },
      });
      expect(tx.supportMessage.create.mock.calls[1][0].data.content).toContain(
        'Tópico selecionado: 1. Saque / Pagamento',
      );
      expect(tx.supportMessage.create.mock.calls[1][0].data.content).toContain(
        'O afiliado solicitou atendimento humano.',
      );
    });
  });

  describe('sendMessage()', () => {
    it('moves an open conversation to WAITING_USER after the support replies', async () => {
      const now = new Date('2026-05-15T13:00:00Z');
      const conversation = {
        id: 'conversation-support-reply',
        affiliateId: 'affiliate-001',
        affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        agentId: 'support-a',
        agent: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
        status: ConversationStatus.OPEN,
        subject: 'Teste',
        closedAt: null,
        closedByRole: null,
        createdAt: now,
        updatedAt: now,
      };
      const message = {
        id: 'message-agent',
        conversationId: conversation.id,
        senderId: 'support-a',
        senderRole: MessageSenderRole.AGENT,
        sender: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
        content: 'Resposta do suporte',
        readAt: null,
        createdAt: now,
      };
      const tx = {
        supportMessage: {
          create: vi.fn().mockResolvedValue(message),
        },
        supportConversation: {
          findUnique: vi.fn().mockResolvedValue({ status: ConversationStatus.OPEN }),
          update: vi.fn().mockResolvedValue({
            ...conversation,
            status: WAITING_USER_STATUS,
          }),
        },
      };
      const events = { emit: vi.fn() };
      const prisma = {
        supportConversation: {
          findUnique: vi.fn().mockResolvedValue(conversation),
        },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      };
      const service = new SupportChatService(prisma as any, events as any, makeFileUpload());

      await service.sendMessage(conversation.id, {
        sub: 'support-a',
        email: 'support-a@vexxa.test',
        role: 'SUPPORT',
      } as any, { content: 'Resposta do suporte' });

      expect(tx.supportConversation.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: conversation.id },
        data: expect.objectContaining({ status: WAITING_USER_STATUS }),
      }));
      expect(events.emit).toHaveBeenCalledWith({
        type: 'conversation:updated',
        conversation: expect.objectContaining({ status: WAITING_USER_STATUS }),
      });
    });

    it('moves a WAITING_USER conversation back to OPEN when the affiliate replies (reopened)', async () => {
      const now = new Date('2026-05-15T13:05:00Z');
      const conversation = {
        id: 'conversation-affiliate-reply',
        affiliateId: 'affiliate-001',
        affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        agentId: 'support-a',
        agent: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
        status: WAITING_USER_STATUS,
        subject: 'Teste',
        closedAt: null,
        closedByRole: null,
        createdAt: now,
        updatedAt: now,
      };
      const message = {
        id: 'message-affiliate',
        conversationId: conversation.id,
        senderId: 'affiliate-001',
        senderRole: MessageSenderRole.AFFILIATE,
        sender: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        content: 'Resposta do afiliado',
        readAt: null,
        createdAt: now,
      };
      const tx = {
        supportMessage: {
          create: vi.fn().mockResolvedValue(message),
        },
        supportConversation: {
          findUnique: vi.fn().mockResolvedValue({ status: WAITING_USER_STATUS }),
          update: vi.fn().mockResolvedValue({
            ...conversation,
            status: ConversationStatus.OPEN,
          }),
        },
      };
      const events = { emit: vi.fn() };
      const prisma = {
        supportConversation: {
          findUnique: vi.fn().mockResolvedValue(conversation),
        },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      };
      const service = new SupportChatService(prisma as any, events as any, makeFileUpload());

      await service.sendMessage(conversation.id, {
        sub: 'affiliate-001',
        email: 'afiliado@vexxa.test',
        role: 'AFFILIATE',
      } as any, { content: 'Resposta do afiliado' });

      // Affiliate reply on WAITING_USER → status becomes OPEN (conversation reopened)
      expect(tx.supportConversation.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: conversation.id },
        data: expect.objectContaining({ status: ConversationStatus.OPEN }),
      }));
      expect(events.emit).toHaveBeenCalledWith({
        type: 'conversation:reopened',
        conversation: expect.objectContaining({ status: ConversationStatus.OPEN }),
      });
    });

    it('persists an attachment-only message when the URL belongs to the R2 bucket', async () => {
      const now = new Date('2026-05-15T13:10:00Z');
      const conversation = {
        id: 'conversation-with-attachment',
        affiliateId: 'affiliate-001',
        affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        agentId: 'support-a',
        agent: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
        status: ConversationStatus.OPEN,
        subject: 'Teste',
        closedAt: null,
        closedByRole: null,
        createdAt: now,
        updatedAt: now,
      };
      const attachmentUrl = `${R2_PUBLIC_URL}/support/conv-1/abc.png`;
      const message = {
        id: 'message-attachment',
        conversationId: conversation.id,
        senderId: 'affiliate-001',
        senderRole: MessageSenderRole.AFFILIATE,
        sender: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        content: '',
        attachmentUrl,
        attachmentMimeType: 'image/png',
        attachmentName: 'foto.png',
        attachmentSize: 12345,
        readAt: null,
        createdAt: now,
      };
      const tx = {
        supportMessage: { create: vi.fn().mockResolvedValue(message) },
        supportConversation: {
          findUnique: vi.fn().mockResolvedValue({ status: ConversationStatus.OPEN }),
          update: vi.fn().mockResolvedValue({ ...conversation }),
        },
      };
      const prisma = {
        supportConversation: { findUnique: vi.fn().mockResolvedValue(conversation) },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      };
      const service = new SupportChatService(prisma as any, { emit: vi.fn() } as any, makeFileUpload());

      await service.sendMessage(conversation.id, {
        sub: 'affiliate-001',
        email: 'afiliado@vexxa.test',
        role: 'AFFILIATE',
      } as any, {
        attachmentUrl,
        attachmentMimeType: 'image/png',
        attachmentName: 'foto.png',
        attachmentSize: 12345,
      });

      expect(tx.supportMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attachmentUrl,
          attachmentMimeType: 'image/png',
          attachmentName: 'foto.png',
          attachmentSize: 12345,
          content: '',
        }),
        include: expect.anything(),
      });
    });

    it('throws when the conversation is closed inside the transaction (race condition with closeAllConversations)', async () => {
      const now = new Date('2026-05-18T10:00:00Z');
      const conversation = {
        id: 'conversation-race',
        affiliateId: 'affiliate-001',
        affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        agentId: 'support-a',
        agent: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
        // Status is OPEN at the time of the initial read outside the transaction
        status: ConversationStatus.OPEN,
        subject: 'Teste',
        closedAt: null,
        closedByRole: null,
        createdAt: now,
        updatedAt: now,
      };
      const tx = {
        supportMessage: { create: vi.fn() },
        supportConversation: {
          // Simulates closeAllConversations() having committed between the outer
          // findUnique check and this inner re-verification inside the transaction
          findUnique: vi.fn().mockResolvedValue({ status: ConversationStatus.CLOSED }),
          update: vi.fn(),
        },
      };
      const prisma = {
        supportConversation: { findUnique: vi.fn().mockResolvedValue(conversation) },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      };
      const service = new SupportChatService(prisma as any, { emit: vi.fn() } as any, makeFileUpload());

      await expect(
        service.sendMessage(conversation.id, {
          sub: 'support-a',
          email: 'support-a@vexxa.test',
          role: 'SUPPORT',
        } as any, { content: 'Mensagem após encerramento' }),
      ).rejects.toThrow();

      // Message must NOT be persisted and status must NOT be reverted to OPEN
      expect(tx.supportMessage.create).not.toHaveBeenCalled();
      expect(tx.supportConversation.update).not.toHaveBeenCalled();
    });

    it('rejects an attachment whose URL is not hosted on the configured R2 domain', async () => {
      const now = new Date('2026-05-15T13:15:00Z');
      const conversation = {
        id: 'conversation-bad-url',
        affiliateId: 'affiliate-001',
        affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        agentId: 'support-a',
        agent: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
        status: ConversationStatus.OPEN,
        subject: 'Teste',
        closedAt: null,
        closedByRole: null,
        createdAt: now,
        updatedAt: now,
      };
      const prisma = {
        supportConversation: { findUnique: vi.fn().mockResolvedValue(conversation) },
        $transaction: vi.fn(),
      };
      const service = new SupportChatService(prisma as any, { emit: vi.fn() } as any, makeFileUpload());

      await expect(
        service.sendMessage(conversation.id, {
          sub: 'affiliate-001',
          email: 'afiliado@vexxa.test',
          role: 'AFFILIATE',
        } as any, {
          attachmentUrl: 'https://evil.example.com/x.png',
          attachmentMimeType: 'image/png',
          attachmentName: 'x.png',
          attachmentSize: 100,
        }),
      ).rejects.toThrow(/URL de anexo inválida/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('assignNextAvailableAgent()', () => {
    it('assigns the next conversation to the idle support instead of the older congested support', async () => {
      const { service, prisma } = makeService(
        [
          makeAgent('support-a', new Date('2026-05-14T10:00:00Z'), new Date('2026-05-14T10:00:00Z')),
          makeAgent('support-b', new Date('2026-05-14T10:05:00Z'), new Date('2026-05-14T10:05:00Z')),
        ],
        [{ agentId: 'support-a', count: 14 }],
      );

      await service.assignNextAvailableAgent('conversation-001');

      expect(prisma.supportConversation.groupBy).toHaveBeenCalledWith({
        by: ['agentId'],
        where: {
          status: { in: [ConversationStatus.OPEN, WAITING_USER_STATUS] },
          agentId: { in: ['support-a', 'support-b'] },
        },
        _count: { _all: true },
      });
      expect(service.assignConversation).toHaveBeenCalledWith(
        'conversation-001',
        'support-b',
        { drainWaiting: false },
      );
    });

    it('keeps distribution balanced by assigning to the lowest active workload first', async () => {
      const { service } = makeService(
        [
          makeAgent('support-a', new Date('2026-05-14T09:00:00Z'), new Date('2026-05-14T09:00:00Z')),
          makeAgent('support-b', new Date('2026-05-14T09:05:00Z'), new Date('2026-05-14T09:05:00Z')),
        ],
        [
          { agentId: 'support-a', count: 49 },
          { agentId: 'support-b', count: 12 },
        ],
      );

      await service.assignNextAvailableAgent('conversation-002');

      expect(service.assignConversation).toHaveBeenCalledWith(
        'conversation-002',
        'support-b',
        { drainWaiting: false },
      );
    });

    it('uses last assignment as round-robin tie-breaker once workloads are equal below capacity', async () => {
      const { service } = makeService(
        [
          makeAgent('support-a', new Date('2026-05-14T08:00:00Z'), new Date('2026-05-14T08:00:00Z')),
          makeAgent('support-b', new Date('2026-05-14T08:10:00Z'), new Date('2026-05-14T08:10:00Z')),
        ],
        [
          { agentId: 'support-a', count: 49 },
          { agentId: 'support-b', count: 49 },
        ],
      );

      await service.assignNextAvailableAgent('conversation-003');

      expect(service.assignConversation).toHaveBeenCalledWith(
        'conversation-003',
        'support-a',
        { drainWaiting: false },
      );
    });

    it('keeps the conversation waiting when every online support reached 50 open conversations', async () => {
      const { service } = makeService(
        [
          makeAgent('support-a', new Date('2026-05-14T08:00:00Z'), new Date('2026-05-14T08:00:00Z')),
          makeAgent('support-b', new Date('2026-05-14T08:10:00Z'), new Date('2026-05-14T08:10:00Z')),
        ],
        [
          { agentId: 'support-a', count: 50 },
          { agentId: 'support-b', count: 50 },
        ],
      );

      const result = await service.assignNextAvailableAgent('conversation-004');

      expect(result).toBeNull();
      expect(service.assignConversation).not.toHaveBeenCalled();
    });
  });

  describe('closeAllConversations()', () => {
    it('closes all OPEN and WAITING_USER conversations of the agent and emits conversation:closed for each', async () => {
      const now = new Date('2026-05-18T10:00:00Z');
      const makeConv = (id: string, status: ConversationStatus) => ({
        id,
        affiliateId: 'affiliate-001',
        affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        agentId: 'support-a',
        agent: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
        status,
        subject: 'Teste',
        tags: [],
        closedAt: null,
        closedByRole: null,
        assignments: [],
        createdAt: now,
        updatedAt: now,
      });
      const active = [
        makeConv('conv-1', ConversationStatus.OPEN),
        makeConv('conv-2', WAITING_USER_STATUS),
      ];
      const prisma = {
        supportConversation: {
          findMany: vi.fn().mockResolvedValue(active),
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        supportConversationAssignment: {
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        $transaction: vi.fn(async (ops: unknown[]) => {
          for (const op of ops as Array<Promise<unknown>>) await op;
        }),
      };
      const events = { emit: vi.fn() };
      const service = new SupportChatService(prisma as any, events as any, makeFileUpload());
      const drain = vi
        .spyOn(service, 'assignWaitingConversations')
        .mockResolvedValue();

      const result = await service.closeAllConversations({
        sub: 'support-a',
        email: 'support-a@vexxa.test',
        role: 'SUPPORT',
      } as any);

      expect(result).toEqual({ closed: 2 });
      expect(prisma.supportConversation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['conv-1', 'conv-2'] } },
          data: expect.objectContaining({ status: ConversationStatus.CLOSED }),
        }),
      );
      expect(events.emit).toHaveBeenCalledTimes(2);
      expect(events.emit).toHaveBeenCalledWith({
        type: 'conversation:closed',
        conversation: expect.objectContaining({ id: 'conv-1', status: ConversationStatus.CLOSED }),
      });
      expect(events.emit).toHaveBeenCalledWith({
        type: 'conversation:closed',
        conversation: expect.objectContaining({ id: 'conv-2', status: ConversationStatus.CLOSED }),
      });
      expect(drain).toHaveBeenCalledOnce();
    });

    it('does not drain waiting conversations after close-all outside business hours', async () => {
      vi.mocked(isWithinBusinessHours).mockReturnValueOnce(false);
      const now = new Date('2026-05-18T22:00:00Z');
      const active = [
        {
          id: 'conv-after-hours',
          affiliateId: 'affiliate-001',
          affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
          agentId: 'support-a',
          agent: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
          status: ConversationStatus.OPEN,
          subject: 'Teste',
          tags: [],
          closedAt: null,
          closedByRole: null,
          assignments: [],
          createdAt: now,
          updatedAt: now,
        },
      ];
      const prisma = {
        supportConversation: {
          findMany: vi.fn().mockResolvedValue(active),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        supportConversationAssignment: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        $transaction: vi.fn(async (ops: unknown[]) => {
          for (const op of ops as Array<Promise<unknown>>) await op;
        }),
      };
      const service = new SupportChatService(
        prisma as any,
        { emit: vi.fn() } as any,
        makeFileUpload(),
      );
      const drain = vi
        .spyOn(service, 'assignWaitingConversations')
        .mockResolvedValue();

      const result = await service.closeAllConversations({
        sub: 'support-a',
        email: 'support-a@vexxa.test',
        role: 'SUPPORT',
      } as any);

      expect(result).toEqual({ closed: 1 });
      expect(drain).not.toHaveBeenCalled();
    });

    it('returns 0 when the agent has no active conversations', async () => {
      const prisma = {
        supportConversation: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new SupportChatService(prisma as any, { emit: vi.fn() } as any, makeFileUpload());

      const result = await service.closeAllConversations({
        sub: 'support-a',
        email: 'support-a@vexxa.test',
        role: 'SUPPORT',
      } as any);

      expect(result).toEqual({ closed: 0 });
    });

    it('throws ForbiddenException when a non-support user tries to close all conversations', async () => {
      const prisma = { supportConversation: { findMany: vi.fn() } };
      const service = new SupportChatService(prisma as any, { emit: vi.fn() } as any, makeFileUpload());

      await expect(
        service.closeAllConversations({
          sub: 'affiliate-001',
          email: 'afiliado@vexxa.test',
          role: 'AFFILIATE',
        } as any),
      ).rejects.toThrow(/ForbiddenException|403|apenas agentes/i);

      expect(prisma.supportConversation.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getDailyReport()', () => {
    it('returns today closed conversations with tags and the initial message', async () => {
      const closedAt = new Date('2026-05-18T15:30:00Z');
      const prisma = {
        supportConversationAssignment: {
          count: vi.fn().mockResolvedValue(3),
        },
        supportConversation: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'conversation-closed-today',
              affiliateId: 'affiliate-001',
              affiliate: {
                id: 'affiliate-001',
                name: 'Afiliado Teste',
                email: 'afiliado@vexxa.test',
              },
              agentId: 'support-a',
              status: ConversationStatus.CLOSED,
              subject: 'Acesso à Conta',
              tags: ['Login', 'Urgente'],
              closedAt,
              closedByRole: 'agent',
              createdAt: new Date('2026-05-18T14:00:00Z'),
              updatedAt: closedAt,
              messages: [
                {
                  content: 'falar com atendente',
                  createdAt: new Date('2026-05-18T13:59:00Z'),
                },
                {
                  content: 'Mensagem inicial do afiliado para abrir o atendimento.',
                  createdAt: new Date('2026-05-18T14:00:00Z'),
                },
                {
                  content: 'Última resposta do suporte antes de encerrar.',
                  createdAt: closedAt,
                },
              ],
            },
          ]),
        },
        $transaction: vi.fn(async (ops: Array<Promise<unknown>>) =>
          Promise.all(ops),
        ),
      };
      const service = new SupportChatService(
        prisma as any,
        { emit: vi.fn() } as any,
        makeFileUpload(),
      );

      const result = await service.getDailyReport('support-a');

      expect(prisma.supportConversationAssignment.count).toHaveBeenCalledWith({
        where: {
          agentId: 'support-a',
          assignedAt: { gte: new Date('2026-05-18T03:00:00.000Z') },
        },
      });
      expect(prisma.supportConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            agentId: 'support-a',
            status: ConversationStatus.CLOSED,
            closedAt: { gte: new Date('2026-05-18T03:00:00.000Z') },
          },
          orderBy: { closedAt: 'desc' },
        }),
      );
      expect(result.totalCreated).toBe(3);
      expect(result.totalClosed).toBe(1);
      expect(result.closedConversations).toEqual([
        expect.objectContaining({
          id: 'conversation-closed-today',
          affiliateName: 'Afiliado Teste',
          affiliateEmail: 'afiliado@vexxa.test',
          subject: 'Acesso à Conta',
          tags: ['Login', 'Urgente'],
          closedAt,
          closedByRole: 'agent',
          firstMessagePreview:
            'Mensagem inicial do afiliado para abrir o atendimento.',
          lastMessagePreview: 'Última resposta do suporte antes de encerrar.',
        }),
      ]);
    });

    it('does not include closed conversations outside today because the query filters by closedAt', async () => {
      const prisma = {
        supportConversationAssignment: {
          count: vi.fn().mockResolvedValue(0),
        },
        supportConversation: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        $transaction: vi.fn(async (ops: Array<Promise<unknown>>) =>
          Promise.all(ops),
        ),
      };
      const service = new SupportChatService(
        prisma as any,
        { emit: vi.fn() } as any,
        makeFileUpload(),
      );

      const result = await service.getDailyReport('support-a');

      expect(prisma.supportConversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            closedAt: { gte: new Date('2026-05-18T03:00:00.000Z') },
          }),
        }),
      );
      expect(result.totalClosed).toBe(0);
      expect(result.closedConversations).toEqual([]);
    });
  });

  describe('closeConversation()', () => {
    it('drains waiting conversations after an open support conversation is closed', async () => {
      const now = new Date('2026-05-14T12:00:00Z');
      const conversation = {
        id: 'conversation-closed',
        affiliateId: 'affiliate-001',
        affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        agentId: 'support-a',
        agent: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
        status: ConversationStatus.OPEN,
        subject: 'Teste',
        closedAt: null,
        closedByRole: null,
        createdAt: now,
        updatedAt: now,
      };
      const updated = {
        ...conversation,
        status: ConversationStatus.CLOSED,
        closedAt: now,
        closedByRole: 'agent',
      };
      const tx = {
        supportConversation: {
          update: vi.fn().mockResolvedValue(updated),
        },
        supportConversationAssignment: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const prisma = {
        supportConversation: {
          findUnique: vi.fn().mockResolvedValue(conversation),
        },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      };
      const service = new SupportChatService(prisma as any, { emit: vi.fn() } as any, makeFileUpload());
      const drain = vi.spyOn(service, 'assignWaitingConversations').mockResolvedValue();

      await service.closeConversation('conversation-closed', {
        sub: 'support-a',
        email: 'support-a@vexxa.test',
        role: 'SUPPORT',
      } as any);

      expect(drain).toHaveBeenCalledOnce();
    });

    it('does not drain waiting conversations after business hours', async () => {
      vi.mocked(isWithinBusinessHours).mockReturnValueOnce(false);
      const now = new Date('2026-05-14T22:00:00Z');
      const conversation = {
        id: 'conversation-closed-after-hours',
        affiliateId: 'affiliate-001',
        affiliate: { id: 'affiliate-001', name: 'Afiliado', email: 'afiliado@vexxa.test' },
        agentId: 'support-a',
        agent: { id: 'support-a', name: 'Suporte A', email: 'support-a@vexxa.test' },
        status: ConversationStatus.OPEN,
        subject: 'Teste',
        closedAt: null,
        closedByRole: null,
        createdAt: now,
        updatedAt: now,
      };
      const tx = {
        supportConversation: {
          update: vi.fn().mockResolvedValue({
            ...conversation,
            status: ConversationStatus.CLOSED,
            closedAt: now,
            closedByRole: 'agent',
          }),
        },
        supportConversationAssignment: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const prisma = {
        supportConversation: {
          findUnique: vi.fn().mockResolvedValue(conversation),
        },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      };
      const service = new SupportChatService(prisma as any, { emit: vi.fn() } as any, makeFileUpload());
      const drain = vi.spyOn(service, 'assignWaitingConversations').mockResolvedValue();

      await service.closeConversation('conversation-closed-after-hours', {
        sub: 'support-a',
        email: 'support-a@vexxa.test',
        role: 'SUPPORT',
      } as any);

      expect(drain).not.toHaveBeenCalled();
    });
  });
});
