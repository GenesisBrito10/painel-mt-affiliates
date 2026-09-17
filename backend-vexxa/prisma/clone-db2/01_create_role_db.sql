-- ============================================================
-- 01 — Criar role + banco novo (vallex_db2) no MESMO servidor
-- Rode CONECTADO COMO ADMIN (superuser, ex.: postgres):
--   psql "postgresql://postgres:SENHA_ADMIN@104.234.186.94:5433/postgres" -f 01_create_role_db.sql
-- Senha do novo user = MESMA da atual (pedido do usuário).
-- ============================================================

-- Role próprio do projeto novo (mesma senha do banco atual)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vallex2_user') THEN
    CREATE ROLE vallex2_user WITH LOGIN PASSWORD 'CHANGE_ME_BEFORE_RUNNING';
  END IF;
END $$;

-- Banco isolado, dono = novo user
-- (CREATE DATABASE não roda dentro de DO/transação — execute direto)
CREATE DATABASE vallex_db2 OWNER vallex2_user;

GRANT ALL PRIVILEGES ON DATABASE vallex_db2 TO vallex2_user;

-- Depois CONECTE no banco novo e ajuste o schema public:
--   \c vallex_db2
--   GRANT ALL ON SCHEMA public TO vallex2_user;
--   ALTER SCHEMA public OWNER TO vallex2_user;
