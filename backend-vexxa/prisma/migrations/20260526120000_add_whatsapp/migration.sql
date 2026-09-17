-- WhatsApp (Evolution GO) — envio automático de comprovantes de saque.
-- Adiciona o tipo de notificação de desconexão, o enum de status de envio
-- e as 3 tabelas: config (singleton), estado de conexão (singleton) e histórico.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WHATSAPP_DISCONNECTED';

-- CreateEnum
CREATE TYPE "WhatsappSendStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'WAITING_CONNECTION', 'PAUSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "whatsapp_settings" (
    "id" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL DEFAULT '',
    "instanceToken" TEXT,
    "selectedGroupId" TEXT,
    "selectedGroupName" TEXT,
    "messageTemplate" TEXT NOT NULL DEFAULT '',
    "sendMedia" BOOLEAN NOT NULL DEFAULT true,
    "delayMinSeconds" INTEGER NOT NULL DEFAULT 20,
    "delayMaxSeconds" INTEGER NOT NULL DEFAULT 90,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "maxWaitConnectionMinutes" INTEGER NOT NULL DEFAULT 1440,
    "failureCooldownSeconds" INTEGER NOT NULL DEFAULT 1800,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_connection_state" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'close',
    "phoneNumber" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "lastDisconnectedAt" TIMESTAMP(3),
    "lastDisconnectNotifiedAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "circuitOpenUntil" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_connection_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_send_logs" (
    "id" TEXT NOT NULL,
    "withdrawalId" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "userName" TEXT NOT NULL DEFAULT '',
    "userEmail" TEXT,
    "amount" DECIMAL(14,2),
    "groupId" TEXT,
    "groupName" TEXT,
    "message" TEXT NOT NULL,
    "status" "WhatsappSendStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "waitingConnectionSince" TIMESTAMP(3),
    "pausedSince" TIMESTAMP(3),
    "lastError" TEXT,
    "jobId" TEXT,
    "evolutionResponse" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_send_logs_withdrawalId_key" ON "whatsapp_send_logs"("withdrawalId");

-- CreateIndex
CREATE INDEX "whatsapp_send_logs_status_idx" ON "whatsapp_send_logs"("status");

-- CreateIndex
CREATE INDEX "whatsapp_send_logs_createdAt_idx" ON "whatsapp_send_logs"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "whatsapp_send_logs_userEmail_idx" ON "whatsapp_send_logs"("userEmail");
