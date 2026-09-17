import type {
  ConversationStatus,
  MessageSenderRole,
  UserRole,
} from '@prisma/client';

export interface SupportUserSummary {
  id: string;
  name: string;
  email: string;
}

export interface SupportMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: MessageSenderRole;
  senderName: string;
  content: string;
  attachmentUrl: string | null;
  attachmentMimeType: string | null;
  attachmentName: string | null;
  attachmentSize: number | null;
  readAt: Date | null;
  createdAt: Date;
  editedAt: Date | null;
}

export interface SupportConversationAssignmentDto {
  id: string;
  conversationId: string;
  agentId: string;
  agentName: string;
  agentEmail: string;
  assignedAt: Date;
  releasedAt: Date | null;
}

export interface SupportConversationDto {
  id: string;
  affiliateId: string;
  affiliateName: string;
  affiliateEmail: string;
  agentId: string | null;
  agentName: string | null;
  agentEmail: string | null;
  status: ConversationStatus;
  subject: string | null;
  tags: string[];
  closedAt: Date | null;
  closedByRole: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessage?: SupportMessageDto | null;
  unreadCount?: number;
  messages?: SupportMessageDto[];
  messagesTotal?: number;
  messagesPage?: number;
  messagesLimit?: number;
  assignments?: SupportConversationAssignmentDto[];
}

export interface SupportConversationListResult {
  data: SupportConversationDto[];
  total: number;
  page: number;
  limit: number;
}

export interface SupportAgentAvailabilityDto {
  agentId: string;
  agentName: string;
  agentEmail: string;
  isOnline: boolean;
  lastAssignedAt: Date | null;
  updatedAt: Date;
  activeConversations: number;
}

export interface SupportDailyReportClosedConversationDto {
  id: string;
  affiliateName: string;
  affiliateEmail: string;
  subject: string | null;
  tags: string[];
  closedAt: Date | null;
  closedByRole: string | null;
  firstMessagePreview: string | null;
  lastMessagePreview: string | null;
}

export interface SupportDailyReportDto {
  date: string;
  totalCreated: number;
  totalClosed: number;
  closedConversations: SupportDailyReportClosedConversationDto[];
}

export type SupportActorRole = Extract<UserRole, 'AFFILIATE' | 'SUPPORT' | 'ADMIN' | 'SUPERADMIN'>;
