-- Deals tipo "forms": novo enum DealKind + campos kind/formSchema em deals,
-- formData em link_requests, e novo valor DEAL_FORM_APPROVED em NotificationType.
-- ADITIVO E NÃO-DESTRUTIVO: apenas CREATE/ADD (nenhum DROP). Escrito à mão para
-- evitar o drift pré-existente do schema (ex.: affiliate_links.kind) que um
-- `migrate diff` completo tentaria remover.

-- CreateEnum
CREATE TYPE "DealKind" AS ENUM ('LINK', 'FORM');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DEAL_FORM_APPROVED';

-- AlterTable
ALTER TABLE "deals"
  ADD COLUMN "kind" "DealKind" NOT NULL DEFAULT 'LINK',
  ADD COLUMN "formSchema" JSONB;

-- AlterTable
ALTER TABLE "link_requests"
  ADD COLUMN "formData" JSONB;
