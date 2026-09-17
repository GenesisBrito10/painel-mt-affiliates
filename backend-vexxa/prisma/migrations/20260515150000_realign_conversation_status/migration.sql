-- Realign conversation statuses to the new turn-based model:
--   OPEN          = agent assigned, awaiting agent's first reply (or waiting for agent to respond)
--   WAITING_USER  = agent has already replied at least once; stays here for the rest of the lifecycle
--
-- The previous migration (20260515140000) used "has affiliate messages" as the trigger,
-- which produced false WAITING_USER states for conversations the agent had not yet replied to.

-- Revert WAITING_USER → OPEN when the agent has never replied yet.
UPDATE "support_conversations" sc
SET status = 'OPEN'::"ConversationStatus"
WHERE sc.status = 'WAITING_USER'::"ConversationStatus"
  AND NOT EXISTS (
    SELECT 1
    FROM "support_messages" sm
    WHERE sm."conversationId" = sc.id
      AND sm."senderRole" = 'AGENT'::"MessageSenderRole"
  );

-- Promote OPEN → WAITING_USER when the agent has already replied at least once.
UPDATE "support_conversations" sc
SET status = 'WAITING_USER'::"ConversationStatus"
WHERE sc.status = 'OPEN'::"ConversationStatus"
  AND EXISTS (
    SELECT 1
    FROM "support_messages" sm
    WHERE sm."conversationId" = sc.id
      AND sm."senderRole" = 'AGENT'::"MessageSenderRole"
  );
