-- Modais com imagem (R2 ou URL), layout e trava de tempo (countdown)
ALTER TABLE "login_modals"
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "imageLayout" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "lockSeconds" INTEGER NOT NULL DEFAULT 0;
