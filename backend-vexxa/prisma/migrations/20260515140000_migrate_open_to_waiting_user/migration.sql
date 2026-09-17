-- Migrate existing OPEN conversations that have affiliate messages to WAITING_USER.
-- These conversations were created before the status-transition logic was introduced.
UPDATE "support_conversations" sc
SET status = 'WAITING_USER'::"ConversationStatus"
WHERE sc.status = 'OPEN'::"ConversationStatus"
  AND EXISTS (
    SELECT 1
    FROM "support_messages" sm
    WHERE sm."conversationId" = sc.id
      AND sm."senderRole" = 'AFFILIATE'::"MessageSenderRole"
  );
