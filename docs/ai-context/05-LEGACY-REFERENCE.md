# Legacy Reference

O legado ainda e uma fonte importante de regra de negocio e UX historica.

Superficies legadas:

- `api`: backend legado Fastify/Mongo.
- `frontend-legacy`: frontend legado do afiliado.
- `admin`: frontend legado administrativo.

## API Legada

Diretorio:

- `api`

Tecnologias:

- Fastify;
- MongoDB/Mongoose;
- JWT;
- servicos proprios de sync;
- rotas em `api/src/routes`;
- schemas/models em `api/src/models`.

Rotas/modulos vistos:

- `auth`
- `users`
- `dashboard`
- `network`
- `withdrawals`
- `linkRequests`
- `deals`
- `admin`
- `notifications`
- `prizes`
- `push`
- `settings`
- `webhooks/lottu`

Servicos importantes:

- sincronizacao Betboard/TAP;
- calculos de dashboard/rede;
- notificacoes;
- saques;
- premios/ranking.

Quando consultar:

- se uma regra financeira no backend novo parecer incompleta;
- se uma tela nova precisar replicar experiencia antiga;
- se houver duvida sobre nomes de status/mensagens;
- se o admin novo ainda nao existir para uma operacao.

## Frontend Legado de Afiliado

Diretorio:

- `frontend-legacy`

Paginas principais:

- `pages/index.vue`: dashboard legado.
- `pages/affiliates.vue`
- `pages/links.vue`
- `pages/payments.vue`
- `pages/prizes.vue`
- `pages/ranking.vue`
- `pages/calendar.vue`
- `pages/notifications.vue`
- `pages/settings.vue`
- auth/login/register.

Referencia importante:

- a aba `Minha Equipe` do dashboard legado mostra uma experiencia mais completa da rede do afiliado;
- ela serviu como referencia para melhorar a area `Rede` em `/earnings` no frontend novo.

O que observar no legado:

- organizacao das metricas de equipe;
- quais detalhes o afiliado espera ver;
- como a rede e apresentada;
- diferenca entre dados proprios e dados da equipe;
- mensagens de status e vazio.

## Admin Legado

Diretorio:

- `admin`

Paginas principais:

- `pages/index.vue`
- `pages/users.vue`
- `pages/links.vue`
- `pages/withdrawals.vue`
- `pages/houses.vue`
- `pages/sync.vue`
- `pages/prizes.vue`
- `pages/audit.vue`
- `pages/settings.vue`
- auth/login.

Uso:

- referencia para fluxos administrativos;
- aprovacao de usuario;
- gerenciamento de links;
- saques;
- casas;
- sync;
- premios;
- auditoria;
- settings.

## Relacao Legado -> Novo

Migracao esperada:

- regras financeiras devem morar no backend novo;
- UX nova deve seguir padrao visual do frontend novo;
- legado deve ser consultado para nao perder comportamento historico;
- divergencias intencionais precisam ser documentadas no codigo ou neste diretorio.

## Pontos de Atencao ao Migrar

### Dashboard

O legado pode ter calculos e exibicoes que nao estao 1:1 no novo dashboard.

Sempre conferir:

- periodo usado;
- casa filtrada;
- escopo direto/rede;
- tratamento de fraude;
- saldo disponivel versus bruto;
- saques pendentes.

### Minha Equipe / Rede

A experiencia legada de `Minha Equipe` e mais rica que a antiga aba `Ganhos` do novo frontend.

Ao trabalhar em `/earnings`:

- pensar como area de rede;
- mostrar contexto suficiente para o afiliado entender o que esta acontecendo;
- evitar carregar ledger/overview se o foco for rede;
- usar cards e resumos com hierarquia visual.

### Saques

Saques sao um fluxo financeiro sensivel.

Comparar legado quando houver duvida sobre:

- valor minimo;
- taxa;
- calendario de saque;
- mensagens de bloqueio;
- status;
- aprovacao/rejeicao.

### Sync

O legado possui integracoes antigas que explicam nomes de campos e mapeamentos.

Antes de trocar sync:

- verificar origem do campo;
- verificar se a casa usa identificador externo;
- verificar como fraude e CPA qualificado sao importados.

## Como Usar o Legado Sem Copiar Problemas

Use o legado para entender regra e expectativa de usuario, mas implemente no padrao novo:

- backend novo: NestJS, DTOs, Prisma, services;
- frontend novo: Nuxt 4, composables, Nuxt UI, tokens CSS;
- evitar copiar estilos antigos diretamente;
- evitar copiar calculos client-side antigos se o backend novo ja centraliza a regra.

## Arquivos de Plano Historico

Documentos uteis:

- `.agent/ARCHITECTURE.md`
- `action_plan_phase0.md`
- `action_plan_phase1.md`
- `action_plan_phase2.md`

Resumo:

- fase 0 criou fundacao Prisma/Auth/Shared;
- fase 1 migrou Settings, User e ProviderAccount;
- fase 2 cobre motor financeiro, comissoes, saques, rede e dashboard;
- as regras W1-W8 de saque no plano de fase 2 sao especialmente importantes.
