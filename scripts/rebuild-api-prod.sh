#!/bin/bash
# Recuperação da API em produção (sem derrubar dist antes do build).
# Uso: cd /projetos/mjmcompany && bash scripts/rebuild-api-prod.sh

set -e

export PATH=/root/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin:$PATH
export PNPM_HOME=/root/.local/share/pnpm

ROOT="/projetos/mjmcompany"
cd "$ROOT/backend-vexxa"

echo "==> Instalando deps..."
pnpm install --frozen-lockfile --prod=false

echo "==> Prisma..."
pnpm prisma:generate
pnpm prisma:deploy

echo "==> Build backend..."
NODE_OPTIONS=--max-old-space-size=2048 pnpm run build

if [ ! -f dist/src/main.js ]; then
  echo "FALHOU: dist/src/main.js não existe"
  exit 1
fi

echo "==> Reload PM2..."
cd "$ROOT"
pm2 startOrReload ecosystem.config.cjs --only api-vallex-affiliates --update-env
pm2 save

echo "==> API OK"
