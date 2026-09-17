-- Base support chat schema. Later migrations add WAITING_USER, attachments and tags.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPPORT';

CREATE TYPE "ConversationStatus" AS ENUM ('WAITING', 'OPEN', 'CLOSED');

CREATE TYPE "MessageSenderRole" AS ENUM ('AFFILIATE', 'AGENT');

CREATE TABLE "support_conversations" (
  "id" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "agentId" TEXT,
  "status" "ConversationStatus" NOT NULL DEFAULT 'WAITING',
  "subject" TEXT,
  "closedAt" TIMESTAMP(3),
  "closedByRole" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_messages" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "senderRole" "MessageSenderRole" NOT NULL,
  "content" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_conversation_assignments" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "agentName" TEXT NOT NULL,
  "agentEmail" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),

  CONSTRAINT "support_conversation_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_agent_availability" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "lastAssignedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "support_agent_availability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_agent_availability_agentId_key" ON "support_agent_availability"("agentId");

CREATE INDEX "support_conversations_affiliateId_status_idx" ON "support_conversations"("affiliateId", "status");
CREATE INDEX "support_conversations_agentId_status_idx" ON "support_conversations"("agentId", "status");
CREATE INDEX "support_conversations_status_createdAt_idx" ON "support_conversations"("status", "createdAt" DESC);

CREATE INDEX "support_messages_conversationId_createdAt_idx" ON "support_messages"("conversationId", "createdAt" ASC);
CREATE INDEX "support_messages_senderId_idx" ON "support_messages"("senderId");

CREATE INDEX "support_conversation_assignments_conversationId_idx" ON "support_conversation_assignments"("conversationId");
CREATE INDEX "support_conversation_assignments_agentId_assignedAt_idx" ON "support_conversation_assignments"("agentId", "assignedAt" DESC);

ALTER TABLE "support_conversations"
  ADD CONSTRAINT "support_conversations_affiliateId_fkey"
  FOREIGN KEY ("affiliateId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support_conversations"
  ADD CONSTRAINT "support_conversations_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_messages"
  ADD CONSTRAINT "support_messages_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support_conversation_assignments"
  ADD CONSTRAINT "support_conversation_assignments_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_conversation_assignments"
  ADD CONSTRAINT "support_conversation_assignments_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "support_agent_availability"
  ADD CONSTRAINT "support_agent_availability_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
