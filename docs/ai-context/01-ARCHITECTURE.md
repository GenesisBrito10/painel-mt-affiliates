# Arquitetura do Projeto

## Visao Geral

O repositorio possui quatro superficies principais:

- `backend-vexxa`: backend novo em NestJS, Prisma e PostgreSQL.
- `frontend`: frontend novo em Nuxt 4, Pinia, Nuxt UI e Tailwind.
- `api`: backend legado em Fastify, Mongo/Mongoose e integracoes antigas.
- `frontend-legacy` e `admin`: frontends legados em Nuxt, usados como referencia visual e de regra de negocio.

Tambem existem documentos e planos em `.agent` e `action_plan_phase*.md`, que descrevem a migracao do legado para o stack novo.

## Objetivo do Sistema

O produto e uma plataforma para afiliados acompanharem:

- performance propria por casa de aposta;
- rede indicada em ate 3 niveis;
- ganhos por CPA e RevShare;
- descontos por fraude;
- saldo disponivel;
- saques;
- links de afiliacao;
- deals/campanhas disponiveis;
- rankings e premios;
- notificacoes operacionais.

Administradores gerenciam:

- usuarios e afiliados;
- aprovacao/rejeicao/bloqueio;
- links e campanhas;
- saques;
- casas de aposta;
- sincronizacao com provedores;
- configuracoes;
- rankings e premios;
- auditoria.

## Stack Novo

### Backend Novo

Diretorio: `backend-vexxa`

Tecnologias:

- NestJS
- Fastify adapter
- Prisma
- PostgreSQL
- JWT com access token e refresh token rotativo
- Redis/BullMQ para filas e notificacoes
- Swagger em desenvolvimento
- Web Push com VAPID
- Criptografia AES-256-GCM para credenciais de provedores

Entrada principal:

- `backend-vexxa/src/main.ts`
- `backend-vexxa/src/app.module.ts`

Padroes globais:

- prefixo global `/api`, exceto `/health`;
- versionamento URI, por exemplo `/api/v1/auth/login`;
- `ValidationPipe` global com whitelist e transform;
- filtro global de excecoes HTTP;
- interceptor global de logging;
- middleware de correlation id;
- throttling global;
- Swagger em `/docs` quando nao esta em producao;
- sincronizacao inicial de casas ao subir a aplicacao via `SyncSchedulerService.runAllHouses('startup')`.

### Frontend Novo

Diretorio: `frontend`

Tecnologias:

- Nuxt 4
- Vue 3
- Pinia
- Nuxt UI
- Tailwind v4
- CSS tokens proprios em `frontend/app/assets/css/main.css`
- proxy server route em `frontend/server/api/[...path].ts`

Runtime:

- `runtimeConfig.public.apiUrl` aponta para `/api`.
- Chamadas do frontend passam pelo proxy Nuxt quando possivel.
- Autenticacao guarda token no estado e em `localStorage`.

Layout principal:

- `frontend/app/layouts/default.vue`

Menu atual:

- Dashboard: `/`
- Afiliados: `/affiliates`
- Links: `/links`
- Deals: `/deals`
- Rede: `/earnings`
- Pagamentos: `/payments`
- Ranking: `/ranking`
- Notificacoes: `/notifications`
- Configuracoes: `/settings`

## Stack Legado

### API Legada

Diretorio: `api`

Tecnologias:

- Fastify
- MongoDB/Mongoose
- JWT
- rotas modulares em `api/src/routes`
- servicos de sync antigos para Betboard/TAP

Ela ainda e importante porque preserva comportamentos historicos de negocio.

### Frontend Legado de Afiliado

Diretorio: `frontend-legacy`

Possui a experiencia antiga do afiliado, incluindo o dashboard com a aba `Minha Equipe`, que serve de referencia para a experiencia de rede no frontend novo.

### Admin Legado

Diretorio: `admin`

Possui telas administrativas antigas para usuarios, links, saques, casas, sync, premios, auditoria e configuracoes.

## Comunicacao Entre Frontend e Backend

No frontend novo:

1. A pagina usa composables como `useDashboard`, `useWithdrawals`, `useEarningsNetwork`.
2. O composable chama `useApiFetch`.
3. A chamada vai para o proxy Nuxt em `/api`.
4. O backend Nest responde em `/api/v1/...`.
5. O token de autenticacao vem de `useAuth().authHeaders`.

## Modelo de Dominio

Entidades centrais no banco novo:

- `User`
- `AffiliateLink`
- `AffiliateData`
- `FraudCount`
- `BettingHouse`
- `Deal`
- `WithdrawalRequest`
- `LinkRequest`
- `ProviderAccount`
- `ProviderAccountHouse`
- `Notification`
- `RankingPrize`
- `PrizeWinner`
- `FinancialLedger`
- `AuditLog`
- `Setting`
- `SyncLog`

O afiliado e representado por `User` com `role = AFFILIATE`. Ele pode ter links por casa (`AffiliateLink`), dados de performance (`AffiliateData`), fraude (`FraudCount`), saldo e saques.

## Principais Fluxos

### Cadastro e Aprovacao

1. Usuario se cadastra com nome, email, senha e opcionalmente codigo de indicacao.
2. Backend cria usuario `PENDING`.
3. Admin ou referenciador direto aprova/rejeita.
4. Ao aprovar, podem ser criados/atualizados links de afiliado por casa.
5. Usuario aprovado pode acessar dados financeiros.

### Dados de Performance

1. Casas/provedores externos sao sincronizados.
2. Dados entram como `AffiliateData`.
3. Cada registro contem campanha, casa, data, depositos, cadastros, FTDs, CPA qualificado, RevShare e comissao total.
4. Dashboard, rede, saldo e ranking consomem esses dados.

### Ganhos Proprios

Ganhos proprios consideram:

- CPA direto;
- RevShare direto;
- bonus;
- descontos de fraude direta;
- saques pendentes/aprovados;
- taxa de saque.

### Ganhos de Rede

A rede e montada por indicacao (`referredById`) ate 3 niveis.

O ganho de rede usa diferenca de comissao entre a raiz e o afiliado de nivel 1 que ancora a ramificacao. Margens negativas sao zeradas.

### Saques

O saque usa saldo consolidado do dashboard/balance service, valida PIX/KYC, dia da casa, valor minimo, compliance de deposito, bloqueios e trava diaria.

## Riscos Arquiteturais

- Regras financeiras sao espalhadas entre dashboard, network, withdrawals e legacy.
- `backend-vexxa` pode nao aparecer como diff normal no Git raiz.
- O legado pode ter comportamento que ainda nao foi totalmente migrado.
- Otimizacoes de frontend devem preservar filtros, paginacao e estado visual.
- Qualquer alteracao em saldo, fraude ou rede pode mudar dinheiro exibido ao usuario.

## Onde Procurar Primeiro

Backend:

- `backend-vexxa/src/modules/dashboard`
- `backend-vexxa/src/modules/user`
- `backend-vexxa/src/modules/withdrawal`
- `backend-vexxa/src/modules/link-request`
- `backend-vexxa/src/modules/ranking`
- `backend-vexxa/src/modules/sync`
- `backend-vexxa/prisma/schema.prisma`

Frontend:

- `frontend/app/pages`
- `frontend/app/components`
- `frontend/app/composables`
- `frontend/app/types`
- `frontend/app/assets/css/main.css`
- `frontend/app/layouts/default.vue`

Legado:

- `frontend-legacy/pages/index.vue`
- `api/src/routes`
- `api/src/services`
- `admin/pages`
