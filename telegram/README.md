# Vallex Telegram Bot

Bot para investigar saldo, CPA e QFTD de afiliados direto no PostgreSQL — replica a análise manual que fizemos no psql.

## O que faz

- Detecta **email** em qualquer mensagem e roda a investigação
- Comando `/investigar email@exemplo.com [casa]`
- Explica automaticamente diferença entre:
  - **QFTD total** (próprio + rede)
  - **CPA direto** (só ganhos próprios)
  - **Ganho de rede** (spread sobre indicados)

## Setup

### 1. Criar bot no Telegram

1. Abra [@BotFather](https://t.me/BotFather)
2. `/newbot` → copie o token
3. Descubra seu Telegram ID com [@userinfobot](https://t.me/userinfobot)

### 2. Configurar

```bash
cd telegram
cp .env.example .env
# Edite .env com TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_IDS e DATABASE_URL
pnpm install
```

### 3. Rodar

```bash
pnpm dev      # desenvolvimento (hot reload)
pnpm build && pnpm start   # produção
```

## Uso

```
/investigar viniciussouzasilvas1@gmail.com
/investigar viniciussouzasilvas1@gmail.com superbet
/link VALLEXBR55
/link 32666-VALLEXBR55
/link https://wlsuperbet.adsrv.eacdn.com/C.ashx?siteid=32666&c=VALLEXBR55
/id
/help
```

## Segurança

- Apenas IDs listados em `TELEGRAM_ALLOWED_IDS` podem usar o bot
- Use a mesma `DATABASE_URL` do backend (somente leitura recomendada no Postgres)

## Deploy no Ubuntu (PM2)

### Opção A — junto com os outros apps (recomendado)

Na raiz do monorepo, o bot já está no `ecosystem.config.cjs`:

```bash
cd /projetos/mjmcompany/telegram
pnpm install
pnpm build

cd /projetos/mjmcompany
pm2 start ecosystem.config.cjs --only telegram-vallex-bot
# ou reiniciar tudo:
pm2 reload ecosystem.config.cjs
```

### Opção B — só o bot

```bash
cd /projetos/mjmcompany/telegram
pnpm install
pnpm build
pm2 start ecosystem.config.cjs
```

### Comandos úteis

```bash
pm2 logs telegram-vallex-bot
pm2 restart telegram-vallex-bot
pm2 stop telegram-vallex-bot
```

O bot carrega variáveis do `.env` na pasta `telegram/` (via dotenv).

### Betboard (API ao vivo)

Além do Postgres, o `/link` consulta a **API Betboard** nos painéis configurados em `BETBOARD_ACCOUNTS`:

- Login → `POST https://api.betboard.com.br/api/login`
- Relatório → `GET /reports/v2/details?InitialDate=...&FinalDate=...&BookMakerId=...`
- **Somente leitura** — mesmo contrato do sync do backend

`bookmarkerId` de cada casa é resolvido automaticamente do Postgres (`provider_account_houses` / `betting_houses.apiKey`).

**Período:** sempre do **1º dia do mês corrente até hoje** (horário BR) — banco e Betboard.

## Deploy no Ubuntu (systemd)

```bash
cd /projetos/mjmcompany/telegram
pnpm install && pnpm build

# /etc/systemd/system/vallex-telegram-bot.service
[Unit]
Description=Vallex Telegram Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/projetos/mjmcompany/telegram
EnvironmentFile=/projetos/mjmcompany/telegram/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now vallex-telegram-bot
```

## Próximos passos (fácil de adicionar)

- [ ] Comando `/saques email`
- [ ] Comando `/fraude email`
- [ ] Integração com LLM para perguntas em linguagem natural
- [ ] Alertas proativos quando sync mudar cpaQualified
