# Backend Reference

Backend novo: `backend-vexxa`.

## Entrada da Aplicacao

Arquivos principais:

- `backend-vexxa/src/main.ts`
- `backend-vexxa/src/app.module.ts`
- `backend-vexxa/prisma/schema.prisma`

`main.ts` configura:

- Fastify adapter;
- prefixo global `/api`, exceto `/health`;
- versionamento por URI;
- CORS;
- Swagger em `/docs` fora de producao;
- `ValidationPipe`;
- `HttpExceptionFilter`;
- `LoggingInterceptor`;
- inicio do scheduler de sync no startup.

`app.module.ts` configura:

- `ConfigModule` global;
- validacao de variaveis de ambiente;
- `ThrottlerModule`;
- `ScheduleModule`;
- Prisma;
- modulos de dominio.

Variaveis obrigatorias/criticas:

- `DATABASE_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- Redis quando filas/sync/notificacao exigirem.

## Modulos Importados

Modulos vistos em `AppModule`:

- `PrismaModule`
- `SharedModule`
- `HealthModule`
- `AuthModule`
- `SettingsModule`
- `UserModule`
- `ProviderAccountModule`
- `SyncModule`
- `DashboardModule`
- `NetworkModule`
- `WithdrawalModule`
- `LinkRequestModule`
- `RankingModule`
- `NotificationModule`

## Rotas Principais

Todas as rotas versionadas usam `/api/v1`, exceto rotas admin sem versionamento explicito em alguns controllers e `/health`.

### Health

- `GET /health`

### Auth

Base: `/api/v1/auth`

- `POST /login`
- `POST /register`
- `POST /refresh`
- `POST /logout`

Responsabilidades:

- cadastro pendente;
- login com lockout;
- emissao de access/refresh token;
- rotacao de refresh token;
- logout/revogacao.

Arquivos:

- `backend-vexxa/src/modules/auth`

### User, Afiliados e Onboarding

Base geral: `/api/v1`

Rotas conhecidas:

- `GET /users/me`
- `PATCH /users/me`
- `GET /users/me/onboarding/check-cpf`
- `PATCH /users/me/onboarding/complete`
- `GET /memberships/mine`
- `GET /memberships/:id/affiliate-links`
- `GET /admin/users`
- `GET /admin/affiliates`
- `GET /admin/affiliates/kpis`
- `GET /admin/users/:id`
- rotas admin para alterar status;
- rotas para aprovar/bloquear usuario;
- rotas de affiliate links.

Responsabilidades:

- perfil autenticado;
- onboarding;
- listagem admin;
- aprovacao/rejeicao/bloqueio;
- vinculos de indicacao;
- links por casa;
- validacao de teto de comissao antes de aprovar.

Arquivos:

- `backend-vexxa/src/modules/user`

### Dashboard

Base: `/api/v1/dashboard`

Rotas conhecidas:

- `GET /filters`
- `GET /summary`
- `GET /daily`
- `GET /balance`
- `GET /campaigns`
- `GET /links-performance`
- `GET /sync-status`
- `GET /ranking`
- `GET /fraud-details`
- `GET /fraud-overview`
- `GET /withdrawal-schedule`

Responsabilidades:

- KPIs;
- saldo consolidado;
- series temporais;
- campanhas;
- performance de links;
- fraude;
- ranking;
- status de sincronizacao;
- calendario de saque.

Arquivos importantes:

- `backend-vexxa/src/modules/dashboard/controllers/dashboard.controller.ts`
- `backend-vexxa/src/modules/dashboard/services/dashboard.service.ts`
- `backend-vexxa/src/modules/dashboard/services/dashboard-balance.service.ts`
- `backend-vexxa/src/modules/dashboard/services/dashboard-network.service.ts`

### Earnings / Rede

Base: `/api/v1/earnings`

Rotas conhecidas:

- `GET /overview`
- `GET /network`
- `GET /ledger`
- `GET /ledger/export`

Uso atual:

- o frontend novo usa principalmente `/network` para a aba `Rede`;
- a antiga ideia de menu `Ganhos` foi substituida por `Rede`.

Arquivos:

- `backend-vexxa/src/modules/dashboard/controllers/earnings.controller.ts`
- servicos de dashboard/network/balance.

### Network

Base: `/api/v1/network`

Rotas conhecidas:

- `GET /tree`
- `GET /fraud-report`
- `GET /referrals`

Responsabilidades:

- arvore de indicacao;
- rede ate 3 niveis;
- relatorio de fraude;
- convidados diretos.

Arquivos:

- `backend-vexxa/src/modules/network`

### Withdrawals

Base: `/api/v1/withdrawals`

Rotas conhecidas:

- `POST /`
- `GET /`
- `GET /balance-breakdown/:userId`
- rotas admin para atualizar status.

Responsabilidades:

- criar saque;
- listar saques;
- validar saldo, PIX, dia de saque, minimo, compliance, bloqueios;
- aprovar/rejeitar;
- expor breakdown para admin.

Arquivos:

- `backend-vexxa/src/modules/withdrawal`

### Link Requests e Deals

Rotas conhecidas:

- `GET /link-requests/houses`
- `GET /link-requests/deals`
- `GET /link-requests`
- `POST /link-requests`
- rotas admin para atualizar solicitacao;
- `GET /deal-requests`
- rotas para aprovar deal request.

Responsabilidades:

- casas disponiveis;
- deals disponiveis;
- solicitacoes de link;
- cumprimento/rejeicao por admin;
- solicitacoes de deals.

Arquivos:

- `backend-vexxa/src/modules/link-request`

Elegibilidade de deals:

- servico: `backend-vexxa/src/modules/link-request/application/deal-eligibility.service.ts`;
- casa de metrica: Superbet (`superbet`);
- metrica: deposito medio = `deposit / ftd`;
- coluna `deals.minAvgDepositPerFtd`: minimo configuravel por deal/casa;
- setting `deal_eligibility_window_days`: janela configuravel;
- valor `0` em `deals.minAvgDepositPerFtd` significa liberar a solicitacao mesmo sem FTD;
- o endpoint de deals devolve `eligibility` para o frontend bloquear o botao antes do POST;
- o POST tambem valida no backend e retorna `403` quando o usuario nao atende ao requisito.

### Ranking e Premios

Bases:

- `/api/v1/prizes`
- `/api/v1/admin/prizes`

Rotas de usuario:

- leaderboard;
- premios ativos;
- minhas recompensas;
- resgate.

Rotas admin:

- CRUD de premios;
- preview;
- finalizar;
- reverter;
- encerrar;
- auditoria.

Arquivos:

- `backend-vexxa/src/modules/ranking`

### Notifications

Rotas conhecidas:

- `GET /notifications`
- contador de nao lidas;
- marcar como lida;
- marcar todas;
- deletar;
- VAPID public key;
- push subscriptions;
- teste de push;
- admin broadcast.

Responsabilidades:

- notificacoes persistidas;
- push notifications;
- broadcast admin;
- contador para layout.

Arquivos:

- `backend-vexxa/src/modules/notification`

### Provider Accounts

Base observada: `/api/admin/provider-accounts`

Responsabilidades:

- CRUD de contas de provedor;
- credenciais criptografadas;
- associacao com casas;
- configuracao para sync.

Arquivos:

- `backend-vexxa/src/modules/provider-account`

### Settings

Base observada: `/api/admin/settings`

Responsabilidades:

- configuracoes globais;
- valores de saque;
- bloqueios;
- parametros operacionais.

Arquivos:

- `backend-vexxa/src/modules/settings`

### Sync

Base observada: `/api/admin/sync`

Responsabilidades:

- disparar sync manual;
- consultar status;
- consultar logs;
- scheduler automatico/startup.

Arquivos:

- `backend-vexxa/src/modules/sync`

## Prisma: Enums Importantes

`UserRole`:

- `AFFILIATE`
- `ADMIN`

`UserStatus`:

- `PENDING`
- `APPROVED`
- `REJECTED`
- `BLOCKED`

`WithdrawalStatus`:

- `PENDING`
- `APPROVED`
- `REJECTED`

`LinkRequestStatus`:

- `PENDING`
- `FULFILLED`
- `REJECTED`

`SyncMode`:

- `AUTO`
- `MANUAL`

`SyncLogStatus`:

- `RUNNING`
- `SUCCESS`
- `ERROR`

`PrizeStatus`:

- `ACTIVE`
- `ENDED`
- `FINALIZED`

`PrizeType`:

- `BALANCE`
- `PHYSICAL`
- `OTHER`

`NotificationType`:

- `REGISTRATION`
- `COMMISSION_CHANGE`
- `WITHDRAWAL_APPROVED`
- `STATUS_CHANGE`
- `GENERAL`

`DepositComplianceStatus`:

- `PASS`
- `FAIL`
- `EXEMPT`
- `PENALTY_APPLIED`

`DepositComplianceFailReason`:

- `MY_DATA_BELOW`
- `TEAM_BELOW`
- `BOTH_BELOW`

`LedgerEventType`:

- `COMMISSION_CPA`
- `COMMISSION_REVSHARE`
- `NETWORK_CPA`
- `NETWORK_REVSHARE`
- `FRAUD_DEDUCTION_DIRECT`
- `FRAUD_DEDUCTION_NETWORK`
- `WITHDRAWAL_APPROVED`
- `BONUS_CREDIT`
- `MANUAL_ADJUSTMENT`

`LedgerEventStatus`:

- `CONFIRMED`
- `PENDING`
- `REVERSED`

## Modelos Principais

### User

Representa admin ou afiliado.

Relacoes:

- `affiliateLinks`
- `fraudCounts`
- `withdrawals`
- `linkRequests`
- `notifications`
- `refreshTokens`
- `prizeWins`
- `financialLedger`
- auto-relacao de indicacao via `referredById`.

### AffiliateLink

Link/taxa do afiliado por casa.

Regras:

- `campaignId` unico por `bettingHouse`;
- taxas `cpa` e `revshare`;
- base para performance e rede.

### AffiliateData

Dados de performance importados.

Usado por:

- dashboard;
- saldo;
- rede;
- ranking;
- relatorios.

### FraudCount

Quantidade de fraude por usuario e casa.

Usado por:

- descontos;
- relatorios;
- bloqueios.

### BettingHouse

Configuracao da casa:

- sync;
- calendario de saque;
- status ativo;
- metadados.

### WithdrawalRequest

Saque solicitado.

Guarda:

- valor original;
- taxa;
- valor liquido;
- casa;
- snapshot PIX;
- status;
- nota admin;
- aprovador.

### LinkRequest

Solicitacao de link/deal.

Guarda:

- usuario;
- deal;
- casa;
- mensagem;
- status;
- links em JSON;
- notas admin.

### FinancialLedger

Livro financeiro por evento.

Serve para rastrear:

- comissoes;
- rede;
- fraude;
- saques;
- bonus;
- ajustes.

## Padroes de Implementacao

- DTOs com validacao devem ser preferidos a objetos soltos.
- Controllers devem ser finos; regra fica em services.
- Calculos financeiros devem ficar no backend.
- Nao duplicar regra financeira no frontend alem de formatacao e apresentacao.
- Nao criar fallback silencioso de taxas.
- Usar transacoes Prisma para mudancas que combinam usuario, links, audit log e notificacoes.
- Usar guards para autenticar e restringir admin.
- Logs e audit devem acompanhar operacoes sensiveis.

## Pontos Sensiveis

- Aprovacao de afiliado cria/atualiza links e pode alterar toda a rede.
- `campaignId` duplicado por casa quebra atribuicao de performance.
- Mudanca em CPA/RevShare altera saldo e rede.
- Saque depende de saldo consolidado, taxa, PIX, compliance e calendario.
- Sync importa dados que alimentam todo o financeiro.
- Alterar filtros de dashboard pode mudar percepcao de saldo se escopo/data forem misturados incorretamente.
