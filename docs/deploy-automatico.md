# Deploy Automatico do Dashboard de Afiliados Vallex

Guia de deploy do projeto `dashboard-afiliados` em VM com PM2, usando Nginx no servidor mae.

## Dados do projeto

```text
Repositorio GitHub: https://github.com/vallex-group/dashboard-afiliados.git
Repositorio na VM:  /projetos/mjmcompany
Branch:             main
IP interno da VM:   COLOQUE_O_IP_INTERNO_DA_VM
```

Dominios:

```text
API:        https://api.vallexgroup.com.br
Afiliados:  https://affiliates.vallexgroup.com.br
Admin/Ops:  https://ops.vallexgroup.com.br
```

Processos PM2 usados no projeto novo:

```text
api-vallex-affiliates   porta 3001
affiliates-vallex       porta 3000
admin-vallex            porta 4174
```

Esses nomes batem com a lista atual do PM2:

```text
admin-vallex
affiliates-vallex
api-vallex-affiliates
```

## 1. Preparar a VM

Na VM da aplicacao:

```bash
apt update
apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
corepack enable
corepack prepare pnpm@10.33.0 --activate
npm i -g pm2
```

## 2. Clonar o projeto

```bash
mkdir -p /root/projetos
cd /root/projetos
git clone https://github.com/vallex-group/dashboard-afiliados.git
cd /projetos/mjmcompany
```

Se o projeto ja existir:

```bash
cd /projetos/mjmcompany
git pull origin main
```

## 3. Criar os envs de producao

Os arquivos `.env` nao sobem para o Git. Crie manualmente na VM:

```bash
nano backend-vexxa/.env
nano frontend/.env
nano admin/.env
```

### backend-vexxa/.env

```env
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://affiliates.vallexgroup.com.br,https://ops.vallexgroup.com.br

DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/vexxa_db?schema=public"
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=SENHA_DO_REDIS

JWT_SECRET="COLOQUE_UM_SECRET_FORTE_COM_32_CARACTERES_OU_MAIS"
JWT_EXPIRATION=7d
ENCRYPTION_KEY="COLOQUE_UMA_CHAVE_FORTE_COM_32_CARACTERES_OU_MAIS"

XFLOW_BASE_URL=https://api.xflow-hub.com/v1
XFLOW_PUBLIC_KEY=pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
XFLOW_SECRET_KEY=sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
XFLOW_WITHDRAWAL_KEY=wk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
XFLOW_HTTP_TIMEOUT_MS=15000
XFLOW_WEBHOOK_SECRET="COLOQUE_UM_SECRET_HEX_FORTE"
APP_PUBLIC_URL=https://api.vallexgroup.com.br
XFLOW_POSTBACK_URL=

VAPID_EMAIL=mailto:dev@automagroup.com
VAPID_PUBLIC_KEY=COLOQUE_A_PUBLIC_KEY
VAPID_PRIVATE_KEY=COLOQUE_A_PRIVATE_KEY

GOOGLE_TYPE=service_account
GOOGLE_PROJECT_ID=COLOQUE_O_PROJECT_ID
GOOGLE_PRIVATE_KEY_ID=COLOQUE_A_PRIVATE_KEY_ID
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nCOLOQUE_A_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
GOOGLE_CLIENT_EMAIL=COLOQUE_O_CLIENT_EMAIL
GOOGLE_CLIENT_ID=COLOQUE_O_CLIENT_ID
GOOGLE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
GOOGLE_TOKEN_URI=https://oauth2.googleapis.com/token
GOOGLE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
GOOGLE_CLIENT_X509_CERT_URL=COLOQUE_A_CERT_URL
GOOGLE_UNIVERSE_DOMAIN=googleapis.com

SUPERBET_SHEET_ID=COLOQUE_O_SHEET_ID
SUPERBET_SHEET_TAB=Sheet1
BETNACIONAL_SHEET_ID=COLOQUE_O_SHEET_ID
BETNACIONAL_SHEET_TAB=Página1
HIPERBET_SHEET_ID=COLOQUE_O_SHEET_ID
HIPERBET_SHEET_TAB=Página1
```

### frontend/.env

```env
NUXT_PUBLIC_APP_ENV=production
NUXT_PUBLIC_APP_NAME="Vallex Group - Affiliates"
NUXT_PUBLIC_API_URL=/api
NUXT_INTERNAL_API_URL=http://127.0.0.1:3001
NUXT_PUBLIC_SOCKET_URL=https://api.vallexgroup.com.br
NUXT_API_SECRET=
HOST=0.0.0.0
PORT=3000
NUXT_HOST=0.0.0.0
NUXT_PORT=3000
NITRO_HOST=0.0.0.0
NITRO_PORT=3000
```

### admin/.env

```env
NUXT_PUBLIC_APP_ENV=production
NUXT_PUBLIC_APP_NAME="Vallex Group - Admin"
NUXT_PUBLIC_API_URL=/api
NUXT_INTERNAL_API_URL=http://127.0.0.1:3001
NUXT_PUBLIC_SOCKET_URL=https://api.vallexgroup.com.br
HOST=0.0.0.0
PORT=4174
NUXT_HOST=0.0.0.0
NUXT_PORT=4174
NITRO_HOST=0.0.0.0
NITRO_PORT=4174
```

## 4. Criar o ecosystem do PM2

Na raiz do projeto:

```bash
cd /projetos/mjmcompany
nano ecosystem.config.cjs
```

Conteudo:

```js
module.exports = {
  apps: [
    {
      name: 'api-vallex-affiliates',
      cwd: '/projetos/mjmcompany/backend-vexxa',
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
    },
    {
      name: 'affiliates-vallex',
      cwd: '/projetos/mjmcompany/frontend',
      script: '.output/server/index.mjs',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3000',
        NITRO_HOST: '0.0.0.0',
        NITRO_PORT: '3000',
        NUXT_PUBLIC_API_URL: '/api',
        NUXT_INTERNAL_API_URL: 'http://127.0.0.1:3001',
        NUXT_PUBLIC_SOCKET_URL: 'https://api.vallexgroup.com.br',
      },
    },
    {
      name: 'admin-vallex',
      cwd: '/projetos/mjmcompany/admin',
      script: '.output/server/index.mjs',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '4174',
        NITRO_HOST: '0.0.0.0',
        NITRO_PORT: '4174',
        NUXT_PUBLIC_API_URL: '/api',
        NUXT_INTERNAL_API_URL: 'http://127.0.0.1:3001',
        NUXT_PUBLIC_SOCKET_URL: 'https://api.vallexgroup.com.br',
      },
    },
  ],
}
```

## 5. Criar o script de deploy PM2

Na raiz do projeto:

```bash
mkdir -p scripts
nano scripts/pm2-deploy.sh
```

Conteudo:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd /projetos/mjmcompany

git pull origin main

cd /projetos/mjmcompany/backend-vexxa
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm prisma:deploy
pnpm build

cd /projetos/mjmcompany/frontend
pnpm install --frozen-lockfile
pnpm build

cd /projetos/mjmcompany/admin
pnpm install --frozen-lockfile
pnpm build

cd /projetos/mjmcompany
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save
```

Permissao:

```bash
chmod +x scripts/pm2-deploy.sh
```

## 6. Deploy manual

Na raiz do projeto:

```bash
cd /projetos/mjmcompany
./scripts/pm2-deploy.sh
```

Verificar:

```bash
pm2 list
pm2 logs api-vallex-affiliates
pm2 logs affiliates-vallex
pm2 logs admin-vallex
```

Conferir portas:

```bash
ss -tulpn | grep -E '3001|3000|4174'
```

Esperado:

```text
0.0.0.0:3001
0.0.0.0:3000
0.0.0.0:4174
```

## 7. Firewall da VM

Se o Nginx fica no servidor mae, libere as portas da VM para o servidor mae.

Modo aberto:

```bash
ufw allow 22/tcp
ufw allow 3001/tcp
ufw allow 3000/tcp
ufw allow 4174/tcp
ufw reload
ufw status
```

Modo mais seguro, liberando apenas para o IP do servidor mae:

```bash
ufw allow 22/tcp
ufw allow from IP_DO_SERVIDOR_MAE to any port 3001 proto tcp
ufw allow from IP_DO_SERVIDOR_MAE to any port 3000 proto tcp
ufw allow from IP_DO_SERVIDOR_MAE to any port 4174 proto tcp
ufw reload
ufw status
```

## 8. Nginx no servidor mae

Resumo dos proxies:

```text
api.vallexgroup.com.br        -> http://IP_INTERNO_DA_VM:3001
affiliates.vallexgroup.com.br -> http://IP_INTERNO_DA_VM:3000
ops.vallexgroup.com.br        -> http://IP_INTERNO_DA_VM:4174
```

Teste no servidor mae:

```bash
curl -I --max-time 5 http://IP_INTERNO_DA_VM:3001
curl -I --max-time 5 http://IP_INTERNO_DA_VM:3000
curl -I --max-time 5 http://IP_INTERNO_DA_VM:4174
nginx -t
systemctl reload nginx
```

SSL:

```bash
certbot --nginx -d api.vallexgroup.com.br -d affiliates.vallexgroup.com.br -d ops.vallexgroup.com.br
```

## 9. Atualizar depois de novo push

Na VM:

```bash
cd /projetos/mjmcompany
./scripts/pm2-deploy.sh
```

## 10. Script automatico na VM

Se quiser ter um comando unico chamado `deploy.sh`:

```bash
cd /projetos/mjmcompany
nano deploy.sh
```

Conteudo:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd /projetos/mjmcompany
./scripts/pm2-deploy.sh
```

Permissao:

```bash
chmod +x deploy.sh
```

Uso:

```bash
./deploy.sh
```

## 11. GitHub Actions

Crie o arquivo:

```text
.github/workflows/deploy.yml
```

Conteudo:

```yaml
name: Deploy Dashboard Afiliados

on:
  push:
    branches:
      - main

jobs:
  deploy:
    name: Deploy na VM
    runs-on: ubuntu-latest

    steps:
      - name: Conectar na VM e rodar deploy
        run: |
          mkdir -p ~/.ssh
          echo "${{ secrets.SERVER_SSH_KEY_B64 }}" | base64 -d > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          ssh \
            -i ~/.ssh/deploy_key \
            -p "${{ secrets.SERVER_PORT }}" \
            -o IdentitiesOnly=yes \
            -o StrictHostKeyChecking=accept-new \
            "${{ secrets.SERVER_USER }}@${{ secrets.SERVER_HOST }}" \
            '
            cd /projetos/mjmcompany
            ./deploy.sh
            '
```

Secrets no GitHub:

```text
SERVER_HOST = IP publico/host SSH da VM
SERVER_PORT = porta SSH da VM
SERVER_USER = root
SERVER_SSH_KEY_B64 = chave privada em base64 de uma linha
```

Gerar base64 da chave privada:

```bash
base64 -w 0 ~/.ssh/NOME_DA_CHAVE
```

## 12. Troubleshooting

Ver processos:

```bash
pm2 list
pm2 logs api-vallex-affiliates
pm2 logs affiliates-vallex
pm2 logs admin-vallex
```

Reiniciar tudo:

```bash
pm2 restart api-vallex-affiliates --update-env
pm2 restart affiliates-vallex --update-env
pm2 restart admin-vallex --update-env
pm2 save
```

Erro 502 no Nginx:

```bash
curl -I --max-time 5 http://IP_INTERNO_DA_VM:3001
curl -I --max-time 5 http://IP_INTERNO_DA_VM:3000
curl -I --max-time 5 http://IP_INTERNO_DA_VM:4174
tail -n 80 /var/log/nginx/error.log
```

Se as portas nao aparecem:

```bash
cd /projetos/mjmcompany
./scripts/pm2-deploy.sh
ss -tulpn | grep -E '3001|3000|4174'
```

Se mudar env:

```bash
pm2 restart api-vallex-affiliates --update-env
pm2 restart affiliates-vallex --update-env
pm2 restart admin-vallex --update-env
pm2 save
```
