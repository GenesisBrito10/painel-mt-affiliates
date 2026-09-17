# Clonar config do vallex_db → vallex_db2 (mesmo servidor)

Cria um banco novo no mesmo Postgres (`104.234.186.94:5433`) e copia **só**:
admins, casas, contas (provider accounts), deals e configs do admin
(settings, login_modals, house_link_rules, whatsapp). Afiliados e dados
financeiros **não** são copiados.

## Ordem de execução

### 1. Criar role + banco (como superuser `postgres`)
```bash
psql "postgresql://postgres:SENHA_ADMIN@104.234.186.94:5433/postgres" -f 01_create_role_db.sql
# depois, no mesmo psql ou em outra chamada:
psql "postgresql://postgres:SENHA_ADMIN@104.234.186.94:5433/vallex_db2" \
  -c "GRANT ALL ON SCHEMA public TO vallex2_user; ALTER SCHEMA public OWNER TO vallex2_user;"
```

### 2. Criar o schema (tabelas) no banco novo
No backend do **repo novo** (`dashboard-afiliados-2`), com `.env` apontando
para `vallex_db2`:
```
DATABASE_URL="postgresql://vallex2_user:SENHA_DO_BANCO@104.234.186.94:5433/vallex_db2?schema=public"
```
```bash
pnpm install
pnpm prisma generate
pnpm dlx dotenv -e .env -- prisma migrate deploy
```

### 3. Copiar os dados
```bash
bash 02_copy_data.sh
```
Mostra no fim uma contagem (casas/deals/contas/admins/modais/regras) para conferir.

## Observações
- Mesma senha do banco atual (pedido). Troque depois se quiser isolar.
- Ordem das tabelas no script respeita as foreign keys (casas antes de deals etc.).
- **Não** inclui regras de prêmio (ranking/cpa prize) — elas referenciam
  dados de afiliado. Se precisar, dá pra adicionar no script.
- Idempotência: rodar 02 duas vezes dá erro de chave duplicada. Para refazer,
  esvazie as tabelas no `vallex_db2` (TRUNCATE ... CASCADE) ou recrie o banco.
