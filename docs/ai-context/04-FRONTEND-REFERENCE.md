# Frontend Reference

Frontend novo: `frontend`.

## Stack

- Nuxt 4
- Vue 3
- Pinia
- Nuxt UI
- Tailwind v4
- CSS global em `frontend/app/assets/css/main.css`
- Proxy API em `frontend/server/api/[...path].ts`

## Estrutura Importante

- `frontend/app/pages`: paginas/rotas.
- `frontend/app/components`: componentes.
- `frontend/app/composables`: estado e chamadas de API.
- `frontend/app/types`: tipos compartilhados.
- `frontend/app/layouts/default.vue`: layout principal e menu.
- `frontend/app/assets/css/main.css`: tokens e utilitarios visuais.

## Autenticacao no Frontend

Composables principais:

- `useAuth`
- `useApiFetch`

`useAuth` cuida de:

- token em `useState`;
- persistencia em `localStorage`;
- migracao de token legado;
- headers de auth;
- login;
- registro;
- logout;
- refresh;
- busca de `/users/me`;
- atualizacao de nome;
- deteccao de onboarding pendente.

Padrao esperado:

- paginas/composables chamam API via `useApiFetch`;
- incluir `authHeaders` quando endpoint exigir usuario autenticado;
- backend e fonte da regra, frontend formata e organiza.

## Layout e Navegacao

Arquivo:

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

Observacoes:

- o menu `Ganhos` foi removido/substituido por `Rede`;
- o layout tambem monitora notificacoes nao lidas;
- deve respeitar estados mobile/desktop;
- manter linguagem visual escura da sidebar e conteudo claro dos paineis.

## Design System Local

Arquivo:

- `frontend/app/assets/css/main.css`

Padroes:

- tokens `--vex-*`;
- fontes: Plus Jakarta Sans, Sora, Space Grotesk, DM Mono;
- utilitarios de card;
- utilitarios de badges/icones;
- bordas e sombras consistentes;
- uso de Nuxt UI onde ja existe;
- preferir `UIcon`, `UButton`, `UCard`, `UTabs`, `USelect`, `UInput`, etc.

Boas praticas:

- cards nao devem parecer todos iguais quando exibem dados diferentes;
- usar hierarquia visual para dinheiro, producao, status, nivel e risco;
- evitar textos longos quebrando layout;
- nao duplicar cards dentro de cards sem necessidade;
- preservar responsividade.

## Paginas

### `/` Dashboard

Arquivo:

- `frontend/app/pages/index.vue`

Composable:

- `useDashboard`

Funcoes:

- filtros de casa;
- presets de data;
- escopo direto/rede/todos;
- KPIs;
- saldo;
- tabela/serie diaria;
- campanhas;
- performance;
- comparacao com periodo anterior;
- status de sync;
- ranking/fraude conforme dados disponiveis.

Cuidados:

- saldo consolidado nao deve oscilar de forma confusa por escopo visual;
- filtros devem evitar refetch desnecessario;
- estados loading/error precisam continuar claros.

### `/affiliates` Afiliados

Arquivo:

- `frontend/app/pages/affiliates.vue`

Composables:

- `useAffiliates`
- `useAffiliateNetwork`
- `useAffiliateProfile`
- `useAffiliateReferrals`
- `useAdminAffiliates`

Experiencia para afiliado:

- abas como `Minha Rede` e `Meus Convidados`;
- card de link/codigo de indicacao;
- arvore de rede;
- lista de convidados;
- modal de aprovacao quando aplicavel.

Experiencia para admin:

- lista de afiliados;
- KPIs;
- filtros;
- aprovacao/rejeicao;
- CRUD/edicao de dados;
- visualizacao de links.

### `/links` Links

Arquivo:

- `frontend/app/pages/links.vue`

Composable:

- `useLinkRequests`

Funcoes:

- listar links do usuario;
- solicitar links;
- abas de links e deal requests;
- admins/referrers podem aprovar quando permitido;
- copiar links.

### `/deals` Deals

Arquivo:

- `frontend/app/pages/deals.vue`

Funcoes:

- marketplace de deals/campanhas;
- busca;
- ordenacao;
- filtro por casa/status;
- solicitacao de afiliacao/deal.

Cuidados:

- deals tem regras de elegibilidade e metadados comerciais;
- nao inventar taxa no frontend.
- o botao de solicitacao usa `deal.eligibility` vindo do backend;
- a liberacao para deals de outras casas depende do deposito medio do usuario na Superbet (`deposito / FTD`);
- o minimo exibido vem de `deals.minAvgDepositPerFtd`, configurado no Postgres por deal/casa;
- quando o requisito nao e atingido, a UI deve mostrar o deposito medio atual, o minimo configurado e manter o POST protegido pelo backend.

### `/earnings` Rede

Arquivo:

- `frontend/app/pages/earnings.vue`

Componente:

- `frontend/app/components/earnings/NetworkMemberCard.vue`

Composable:

- `useEarningsNetwork`

Tipos:

- `frontend/app/types/earnings.ts`

Objetivo atual:

- ser a aba `Rede`, nao uma pagina generica de ganhos;
- mostrar rede do afiliado com dados completos, claros e rapidos;
- substituir parte fraca que existia na antiga aba de ganhos;
- aproximar a clareza da aba legada `Minha Equipe`.

Dados esperados:

- resumo de rede;
- totais de membros;
- membros ativos/inativos;
- producao;
- CPA;
- RevShare;
- deposito;
- ganhos de rede;
- nivel;
- casa;
- status;
- composicao por nivel;
- composicao por status;
- filtros e busca.

Otimizacoes esperadas:

- chamar apenas endpoint de rede;
- evitar carregar overview/ledger se a tela so mostra rede;
- computar filtros localmente quando apropriado;
- limitar renderizacao inicial dos membros;
- usar botao `Carregar mais`;
- preservar arrays e computed values sem recriacao pesada;
- evitar watchers amplos que disparam refetch desnecessario.

Design dos cards:

- dinheiro com destaque;
- nivel com badge claro;
- status com cor propria;
- producao e risco separados;
- distribuicao em grid responsivo;
- evitar todas as metricas na mesma cor;
- tornar obvio o que e ganho, o que e producao e o que e atividade.

### `/payments` Pagamentos

Arquivo:

- `frontend/app/pages/payments.vue`

Composable:

- `useWithdrawals`

Funcoes:

- saldo;
- solicitacao de saque;
- historico;
- fraude;
- dados PIX;
- bloqueios;
- possivel acao admin relacionada a fraude.

Cuidados:

- calculo real de saldo vem do backend;
- frontend nao deve recalcular saldo financeiro de forma independente;
- mensagens de impedimento de saque precisam ser claras.

### `/ranking` Ranking

Arquivo:

- `frontend/app/pages/ranking.vue`

Composable:

- `useRanking`

Funcoes:

- leaderboard;
- premios ativos;
- minhas recompensas;
- resgate.

### `/notifications` Notificacoes

Arquivo:

- `frontend/app/pages/notifications.vue`

Composable:

- `useNotifications`

Funcoes:

- listar notificacoes;
- agrupar por data;
- filtrar lidas/nao lidas/todas;
- marcar como lida;
- marcar todas;
- deletar;
- push subscription/teste quando aplicavel.

### `/settings` Configuracoes

Arquivo:

- `frontend/app/pages/settings.vue`

Funcoes:

- perfil;
- seguranca;
- notificacoes;
- onboarding/KYC;
- CPF;
- nascimento;
- WhatsApp;
- PIX;
- troca de senha;
- teste de push.

Regras no frontend:

- validar CPF antes de enviar;
- validar idade minima de 18 anos;
- usar endpoint remoto de check CPF quando necessario;
- indicar onboarding incompleto sem travar UI inteira.

### Auth

Arquivos:

- `frontend/app/pages/auth/login.vue`
- `frontend/app/pages/auth/register.vue`

Funcoes:

- login;
- cadastro;
- redirecionamentos;
- exibicao de status pendente/rejeitado/bloqueado quando backend retornar.

## Composables Principais

### `useDashboard`

Responsavel por:

- filtros;
- summary;
- daily;
- previous summary;
- balance;
- estados de loading/error;
- date presets;
- escopo.

### `useAffiliates`

Combina:

- perfil;
- rede;
- convidados;
- admin affiliates;
- filtros;
- modal de aprovacao;
- copia de link/codigo.

### `useEarningsNetwork`

Responsavel pela aba `Rede` em `/earnings`.

Deve:

- buscar `/v1/earnings/network`;
- normalizar filtros;
- manter estado enxuto;
- expor dados prontos para cards e resumos.

### `useWithdrawals`

Responsavel por:

- saldo de saque;
- historico;
- solicitacao;
- fraude;
- status de saque.

### `useNotifications`

Responsavel por:

- lista;
- unread count;
- read/delete;
- push.

### `useRanking`

Responsavel por:

- leaderboard;
- premios;
- recompensas;
- resgate.

## Tipos

Diretorio:

- `frontend/app/types`

Tipos financeiros e de rede devem refletir a resposta real do backend. Nao adicionar campo fake apenas para preencher UI sem garantir que o backend entrega.

## Proxy API

Arquivo:

- `frontend/server/api/[...path].ts`

Responsabilidade:

- encaminhar chamadas do Nuxt para backend real;
- preservar headers;
- simplificar chamadas client-side.

## Padroes de UX para Este Produto

O produto e uma ferramenta operacional/financeira para afiliados.

Portanto:

- priorizar leitura rapida;
- evitar layout de landing page;
- evitar visual decorativo sem funcao;
- metricas financeiras devem ser escaneaveis;
- status e alertas precisam ser inequivos;
- filtros devem ser previsiveis;
- paginas precisam lidar bem com loading, vazio e erro;
- usar cores com significado, nao apenas estetica.

## Cuidados em Alteracoes

- Nao duplicar regra financeira no frontend.
- Nao buscar endpoints pesados se a aba nao usa os dados.
- Preservar comportamento mobile.
- Verificar build do frontend apos mudancas grandes.
- Em paginas de rede/pagamento/dashboard, validar visualmente com dados carregados.
- Manter padrao dos composables existentes.
