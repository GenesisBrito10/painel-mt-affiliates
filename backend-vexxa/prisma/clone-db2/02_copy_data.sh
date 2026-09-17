#!/usr/bin/env bash
# ============================================================
# 02 — Copiar SÓ os dados que importam do vallex_db -> vallex_db2
# Mantém: admins (users role<>AFFILIATE), casas, contas (provider
# accounts), deals, e configs do admin (settings, login_modals,
# house_link_rules, whatsapp). O resto NÃO é copiado.
#
# PRÉ-REQUISITO: o schema do vallex_db2 já deve existir.
#   Rode antes (no repo novo, com .env apontando p/ vallex_db2):
#     pnpm prisma migrate deploy
#
# Uso:
#   bash 02_copy_data.sh
# Requer: psql no PATH. Mesmo servidor, mesma senha.
# ============================================================
set -euo pipefail

HOST="104.234.186.94"
PORT="5433"
PASS="VallexPg_2026_K9x_74LmQ2"

SRC="postgresql://vallex_user:${PASS}@${HOST}:${PORT}/vallex_db"
DST="postgresql://vallex2_user:${PASS}@${HOST}:${PORT}/vallex_db2"

# table -> SELECT de origem (filtro de linhas onde precisa)
copy_table () {
  local table="$1"; local query="$2"
  echo ">> copiando ${table} ..."
  psql "$SRC" -v ON_ERROR_STOP=1 -c "\copy (${query}) TO STDOUT" \
    | psql "$DST" -v ON_ERROR_STOP=1 -c "\copy ${table} FROM STDIN"
}

# ORDEM RESPEITA AS FOREIGN KEYS (pai antes do filho)
copy_table betting_houses          "SELECT * FROM betting_houses"
copy_table provider_accounts       "SELECT * FROM provider_accounts"
copy_table provider_account_houses "SELECT * FROM provider_account_houses"
copy_table deals                   "SELECT * FROM deals"
copy_table house_link_rules        "SELECT * FROM house_link_rules"

# Admins/staff apenas (exclui AFFILIATE) — admins têm referredById NULL
copy_table users                   "SELECT * FROM users WHERE role <> 'AFFILIATE'"

# Configurações do admin
copy_table settings                "SELECT * FROM settings"
copy_table login_modals            "SELECT * FROM login_modals"
copy_table whatsapp_settings       "SELECT * FROM whatsapp_settings"
copy_table whatsapp_connection_state "SELECT * FROM whatsapp_connection_state"

echo ""
echo "OK — dados copiados para vallex_db2."
echo "Conferência rápida:"
psql "$DST" -c "SELECT
  (SELECT count(*) FROM betting_houses)          AS casas,
  (SELECT count(*) FROM deals)                   AS deals,
  (SELECT count(*) FROM provider_accounts)       AS contas,
  (SELECT count(*) FROM users WHERE role<>'AFFILIATE') AS admins,
  (SELECT count(*) FROM login_modals)            AS modais,
  (SELECT count(*) FROM house_link_rules)        AS regras;"
