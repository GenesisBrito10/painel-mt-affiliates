-- CreateEnum
CREATE TYPE "LoginModalAudience" AS ENUM ('ALL', 'AFFILIATE', 'HEAD_AFFILIATE', 'SUPPORT', 'ADMIN', 'SUPERADMIN');

-- CreateTable
CREATE TABLE "login_modals" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "audience" "LoginModalAudience" NOT NULL DEFAULT 'AFFILIATE',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "kind" TEXT NOT NULL DEFAULT 'notice',
    "title" TEXT NOT NULL,
    "eyebrow" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "actionLabel" TEXT NOT NULL DEFAULT 'Entendi',
    "secondaryActionLabel" TEXT NOT NULL DEFAULT 'Agora não',
    "actionUrl" TEXT,
    "accent" TEXT NOT NULL DEFAULT 'brand',
    "storageKey" TEXT NOT NULL DEFAULT '',
    "dismissScope" TEXT NOT NULL DEFAULT 'session',
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_modals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "login_modals_key_key" ON "login_modals"("key");

-- CreateIndex
CREATE INDEX "login_modals_enabled_priority_idx" ON "login_modals"("enabled", "priority");

-- Seed current login modal contents
INSERT INTO "login_modals" (
  "id", "key", "enabled", "audience", "priority", "kind", "title", "eyebrow",
  "description", "icon", "actionLabel", "secondaryActionLabel", "actionUrl",
  "accent", "storageKey", "dismissScope", "payload", "updatedAt"
) VALUES
(
  gen_random_uuid()::text,
  'cpa_provider_instability',
  true,
  'AFFILIATE',
  30,
  'cpa_notice',
  'Instabilidade no provedor de dados',
  'Aviso importante',
  'Estamos enfrentando uma instabilidade com o nosso provedor de dados das casas, o que pode ter afetado temporariamente o valor de CPA exibido no painel.',
  'i-lucide-triangle-alert',
  'Entendi',
  'Agora não',
  NULL,
  'warning',
  'vex-cpa-notice-v2',
  'local',
  '{
    "paragraphs": [
      "Estamos enfrentando uma instabilidade com o nosso provedor de dados das casas, o que pode ter afetado temporariamente o valor de CPA exibido no painel.",
      "Caso o seu acordo de CPA esteja com o valor errado, por favor entre em contato com o suporte para que possamos corrigir."
    ],
    "blocks": [
      {
        "title": "Você possui rede de afiliados",
        "body": "Por gentileza, verifique o valor de CPA de cada um dos seus afiliados da rede, um por um. Se encontrar algum valor errado, entre em contato com o suporte informando o seu email ou o email do afiliado para corrigirmos o CPA.",
        "tone": "warning",
        "audience": "HEAD_AFFILIATE"
      }
    ],
    "footer": "Pedimos desculpas pelo transtorno e agradecemos a sua paciência enquanto normalizamos os dados."
  }'::jsonb,
  CURRENT_TIMESTAMP
),
(
  gen_random_uuid()::text,
  'social_whatsapp_invite',
  true,
  'AFFILIATE',
  40,
  'social_invite',
  'Comunidade no WhatsApp',
  'Entre no grupo oficial',
  'Receba avisos, novidades e materiais da MJM Company direto pela comunidade.',
  'i-simple-icons-whatsapp',
  'Entrar na comunidade',
  'Agora não',
  'https://chat.whatsapp.com/L68M9lNlq6WLQFWIfkqWVC',
  'positive',
  'vex-social-whatsapp-v1',
  'session',
  '{"channel": "whatsapp", "soft": "var(--vex-positive-soft-bg)", "accent": "var(--vex-positive)"}'::jsonb,
  CURRENT_TIMESTAMP
),
(
  gen_random_uuid()::text,
  'social_instagram_invite',
  true,
  'AFFILIATE',
  41,
  'social_invite',
  'Instagram MJM Company',
  'Siga nosso perfil',
  'Acompanhe campanhas, bastidores e atualizações rápidas pelo Instagram.',
  'i-lucide-instagram',
  'Seguir no Instagram',
  'Agora não',
  NULL,
  'brand',
  'vex-social-instagram-v1',
  'session',
  '{"channel": "instagram", "soft": "var(--vex-brand-soft-bg)", "accent": "var(--vex-brand)"}'::jsonb,
  CURRENT_TIMESTAMP
),
(
  gen_random_uuid()::text,
  'superbet_inactivity_notice',
  true,
  'AFFILIATE',
  50,
  'superbet_inactivity',
  'Regra de atividade Superbet',
  'Aviso aos afiliados',
  'Afiliados com link Superbet precisam manter produção de QFTD para evitar suspensão automática.',
  'i-lucide-mail-warning',
  'Entendi',
  'Agora não',
  NULL,
  'warning',
  'vex-superbet-inactivity-v1',
  'session',
  '{
    "sectionTitle": "Como funciona",
    "sectionBody": "Se não houver QFTD na Superbet por 3 dias consecutivos, o sistema envia avisos por email e, no 3º dia, remove o link Superbet e bloqueia o acesso ao painel automaticamente.",
    "steps": [
      { "label": "Dia 1", "text": "Aviso", "tone": "warning" },
      { "label": "Dia 2", "text": "Último aviso", "tone": "warning" },
      { "label": "Dia 3", "text": "Bloqueio", "tone": "danger" }
    ]
  }'::jsonb,
  CURRENT_TIMESTAMP
);
