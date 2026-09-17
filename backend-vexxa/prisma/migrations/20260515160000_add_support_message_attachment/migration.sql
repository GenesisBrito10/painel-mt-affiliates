-- Add optional attachment metadata (image or PDF stored on Cloudflare R2) to support messages.
ALTER TABLE "support_messages"
  ADD COLUMN "attachmentUrl"      TEXT,
  ADD COLUMN "attachmentMimeType" TEXT,
  ADD COLUMN "attachmentName"     TEXT,
  ADD COLUMN "attachmentSize"     INTEGER;
