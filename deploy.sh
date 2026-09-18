#!/bin/bash

set -e

export PATH=/root/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin:$PATH
export PNPM_HOME=/root/.local/share/pnpm

ROOT="/painel-mt-affiliates"


echo "Verificando origin/main..."

git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Sem commit novo ($LOCAL). Deploy ignorado."
  exit 0
fi

# Detecta o que mudou ANTES do reset, pra buildar/reiniciar só o necessário.
# backend-vexxa -> api | frontend -> affiliates | admin -> admin.
# O telegram-vallex-bot fica de fora de propósito (deploy/restart manual).
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")

backend_changed=false
frontend_changed=false
admin_changed=false

while IFS= read -r f; do
  case "$f" in
    backend-vexxa/*) backend_changed=true ;;
    frontend/*) frontend_changed=true ;;
    admin/*) admin_changed=true ;;
    # Mudança no ecosystem afeta env/PM2 de todos os apps gerenciados.
    ecosystem.config.cjs)
      backend_changed=true
      frontend_changed=true
      admin_changed=true
      ;;
  esac
done <<< "$CHANGED"

echo "Mudanças detectadas: backend=$backend_changed frontend=$frontend_changed admin=$admin_changed"

echo "Atualizando $LOCAL -> $REMOTE"
git reset --hard origin/main

if [ "$backend_changed" = true ]; then
  echo "Buildando backend..."
  cd "$ROOT/backend-vexxa" || exit 1
  pnpm install --frozen-lockfile --prod=false
  pnpm prisma:generate
  pnpm prisma:deploy
  NODE_OPTIONS=--max-old-space-size=2048 pnpm run build
  if [ ! -f dist/src/main.js ]; then
    echo "ERRO: backend build não gerou dist/src/main.js — PM2 NÃO será reiniciado"
    ls -la dist/ 2>/dev/null || echo "dist/ inexistente"
    exit 1
  fi
fi

build_nuxt_app() {
  local dir="$1"
  local name="$2"
  echo "Buildando $name..."
  cd "$ROOT/$dir" || exit 1
  pnpm install --frozen-lockfile --prod=false
  rm -rf .nuxt .output node_modules/.cache/nuxt
  pnpm exec nuxt prepare
  pnpm run build
  if [ ! -f .output/server/index.mjs ]; then
    echo "ERRO: $name build não gerou .output/server/index.mjs"
    exit 1
  fi
}

if [ "$admin_changed" = true ]; then
  build_nuxt_app admin admin
fi
if [ "$frontend_changed" = true ]; then
  build_nuxt_app frontend frontend
fi

# Monta a lista de apps PM2 a recarregar apenas com o que mudou.
RELOAD_APPS=""
[ "$backend_changed" = true ] && RELOAD_APPS="$RELOAD_APPS,api-vallex-affiliates"
[ "$frontend_changed" = true ] && RELOAD_APPS="$RELOAD_APPS,affiliates-vallex"
[ "$admin_changed" = true ] && RELOAD_APPS="$RELOAD_APPS,admin-vallex"
RELOAD_APPS="${RELOAD_APPS#,}"

if [ -z "$RELOAD_APPS" ]; then
  echo "Nenhum app gerenciado afetado. PM2 não será tocado."
  echo "Deploy finalizado — commit $(git rev-parse --short HEAD)"
  exit 0
fi

echo "Reiniciando PM2 (reload, sem delete): $RELOAD_APPS"
cd "$ROOT" || exit 1
if pm2 ping >/dev/null 2>&1; then
  pm2 startOrReload ecosystem.config.cjs --only "$RELOAD_APPS" --update-env
else
  pm2 start ecosystem.config.cjs --only "$RELOAD_APPS" --update-env
fi

# Remove os nomes PM2 anteriores somente depois que os processos Vallex
# iniciarem com sucesso. Isso evita manter duas versões da aplicação ativas.
for app_pair in \
  "api-mjmcompany-affiliates:api-vallex-affiliates" \
  "affiliates-mjmcompany:affiliates-vallex" \
  "admin-mjmcompany:admin-vallex"; do
  legacy_app="${app_pair%%:*}"
  vallex_app="${app_pair##*:}"
  vallex_pid="$(pm2 pid "$vallex_app" 2>/dev/null | tail -n 1)"
  if [[ "$vallex_pid" =~ ^[1-9][0-9]*$ ]] \
    && pm2 describe "$legacy_app" >/dev/null 2>&1; then
    pm2 delete "$legacy_app"
  fi
done

pm2 save

echo "Deploy finalizado — commit $(git rev-parse --short HEAD)"
