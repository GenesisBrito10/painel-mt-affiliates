-- WhatsApp multi-grupo: envia o mesmo comprovante para vários grupos salvos.

-- Antes: 1 log por saque (withdrawalId @unique). Agora: 1 log por (saque, grupo).
DROP INDEX IF EXISTS "whatsapp_send_logs_withdrawalId_key";

-- Conjunto de grupos/comunidades de destino. groupId @unique → sem repetição.
CREATE TABLE IF NOT EXISTS "whatsapp_target_groups" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "pictureUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_target_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_target_groups_groupId_key" ON "whatsapp_target_groups"("groupId");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_send_logs_withdrawalId_groupId_key" ON "whatsapp_send_logs"("withdrawalId", "groupId");
