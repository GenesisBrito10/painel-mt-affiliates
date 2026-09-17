# Regras de Negocio

Este arquivo resume as regras funcionais e financeiras conhecidas do projeto.

## Usuarios, Papeis e Status

Papeis:

- `AFFILIATE`: afiliado comum.
- `ADMIN`: administrador.

Status:

- `PENDING`: usuario aguardando aprovacao.
- `APPROVED`: usuario aprovado.
- `REJECTED`: usuario rejeitado.
- `BLOCKED`: usuario bloqueado.

Campos importantes de `User`:

- `active`
- `ageVerified`
- `withdrawalBlocked`
- `bonusBalance`
- `referralCode`
- `referredById`
- dados PIX/KYC: `pixKeyType`, `pixKey`, `cpf`, `birthDate`, `whatsapp`
- campos de compliance de deposito
- soft delete via `deletedAt`

## Cadastro

No cadastro:

- usuario nasce como `PENDING`;
- senha e armazenada com bcrypt;
- `referralCode` unico e gerado automaticamente;
- se um codigo de indicacao for informado, `referredById` aponta para o afiliado indicador;
- administradores e/ou indicador podem ser notificados.

Usuario pendente, rejeitado, bloqueado ou inativo nao deve ter acesso completo ao sistema.

## Login e Sessao

Regras conhecidas:

- limite de tentativas de login: 5 tentativas;
- janela de lockout: 15 minutos;
- access token JWT;
- refresh token rotativo;
- refresh token salvo como hash SHA-256;
- se houver reuso suspeito de refresh token, a familia pode ser revogada;
- logout revoga refresh token.

## Onboarding, KYC e PIX

O frontend novo possui fluxo de configuracoes/onboarding em `/settings`.

Dados esperados:

- nome;
- CPF;
- data de nascimento;
- WhatsApp;
- tipo de chave PIX;
- chave PIX.

Regras:

- CPF deve ser valido;
- usuario deve ter pelo menos 18 anos;
- CPF pode ser verificado remotamente por `/users/me/onboarding/check-cpf`;
- sem PIX completo, saque deve ser bloqueado;
- dados de PIX devem ser copiados para o saque no momento da solicitacao para preservar historico.

## Indicacao e Rede

A rede e baseada em `User.referredById`.

Nivel:

- nivel 1: usuarios indicados diretamente;
- nivel 2: indicados dos indicados;
- nivel 3: terceiro nivel.

O backend novo trabalha com arvore de rede e relatorios derivados dela.

Endpoints relacionados:

- `/api/v1/network/tree`
- `/api/v1/network/referrals`
- `/api/v1/network/fraud-report`
- `/api/v1/earnings/network`

## Links de Afiliado

Tabela principal: `AffiliateLink`.

Campos importantes:

- `userId`
- `bettingHouse`
- `campaignId`
- `affiliateId`
- `cpa`
- `revshare`
- `active`

Regras:

- links sao por usuario e por casa;
- `campaignId` e obrigatorio;
- `campaignId + bettingHouse` deve ser unico;
- nao existe fallback global seguro de CPA/RevShare;
- o link e a taxa do afiliado sao usados para calcular performance e rede;
- aprovacao de afiliado pode criar ou atualizar links por casa.

## Casas de Aposta

Tabela principal: `BettingHouse`.

Campos importantes:

- `slug`
- `name`
- `active`
- `syncEnabled`
- `syncSchedule`
- `syncMode`
- `withdrawalDay`
- `withdrawalStartDay`
- `withdrawalEndDay`
- `lastSyncAt`

Regras:

- casas ativas aparecem em filtros, deals, links e saques;
- casa pode definir dia especifico ou janela de saque;
- sync pode ser automatico ou manual.

## Dados de Performance

Tabela principal: `AffiliateData`.

Campos importantes:

- `campaignId`
- `bettingHouse`
- `date`
- `campaignName`
- `utmCampaign`
- `clicks`
- `registrations`
- `ftds`
- `qftd`
- `deposit`
- `revShare`
- `cpaQualified`
- `cpaValue`
- `totalCommission`

Uso:

- dashboard;
- saldo;
- ranking;
- rede;
- relatarios de links/campanhas;
- validacao de saque;
- compliance de deposito.

## CPA, RevShare e Comissao Direta

Para ganhos proprios do afiliado:

- CPA direto vem de CPA qualificado multiplicado pela taxa CPA do afiliado;
- RevShare direto usa percentual de revshare do afiliado sobre base de revshare;
- comissao total pode vir da importacao, mas calculos sensiveis devem seguir as regras do backend novo;
- fraude direta reduz saldo.

## Ganhos de Rede

A rede paga sobre a diferenca de comissao entre a raiz e o afiliado de nivel 1 que ancora a ramificacao.

Regra geral:

1. Montar rede ate 3 niveis.
2. Para um membro da rede, identificar o afiliado de nivel 1 responsavel pela ramificacao.
3. Comparar taxa do usuario raiz com taxa do afiliado nivel 1 na mesma casa.
4. `spreadCPA = rootCPA - level1CPA`.
5. `spreadRevShare = rootRevShare - level1RevShare`.
6. Se o spread for negativo, usar 0.
7. CPA de rede = `spreadCPA * cpaQualified`.
8. RevShare de rede = `spreadRevShare% * revShare`.

Consequencias:

- o ganho de rede nao e simplesmente a soma das comissoes dos indicados;
- o nivel 2 e 3 tambem usam o nivel 1 como ancora de margem;
- taxa mal configurada pode zerar margem;
- a exibicao de rede deve deixar claro nivel, casa, producao, ganho e status.

## Fraude

Tabela principal: `FraudCount`.

Regras:

- fraude pode ser direta ou de rede;
- fraude direta reduz ganhos proprios;
- fraude de rede reduz margem da rede;
- desconto de fraude de rede usa margem CPA do spread;
- usuarios com fraude podem impactar saque e exibicao no dashboard;
- administradores podem visualizar detalhes e bloquear usuarios quando necessario.

Endpoints/telas relacionados:

- dashboard fraud details/overview;
- payments/fraudes;
- network fraud report.

## Saldo

O saldo consolidado considera:

- CPA direto;
- RevShare direto;
- CPA de rede;
- RevShare de rede;
- bonus;
- descontos de fraude direta;
- descontos de fraude de rede;
- saques aprovados;
- saques pendentes;
- taxa de saque;
- possiveis exclusoes de periodo por configuracao.

O servico de saldo do backend novo e a fonte mais segura para valores financeiros.

Campos exibidos normalmente:

- saldo bruto;
- saldo disponivel;
- saldo liquido apos taxa;
- ganhos proprios;
- ganhos de rede;
- bonus;
- descontos;
- pendente;
- sacado;
- taxa.

## Bloqueio por Periodo de Auditoria

Configuracoes podem excluir um periodo de calculo:

- `withdrawal_block_active`
- `withdrawal_block_start_date`
- `withdrawal_block_end_date`

Quando ativo, dados de performance dentro do periodo podem ser desconsiderados do saldo/saque.

## Compliance de Deposito

Campos e logs:

- `DepositComplianceStatus`
- `DepositComplianceFailReason`
- `DepositComplianceLog`

Regra funcional:

- saque pode exigir media minima de deposito por CPA;
- falha pode ocorrer por dados proprios abaixo do minimo, rede abaixo do minimo ou ambos;
- cabecas de rede podem ser isentos dependendo da regra;
- bonus pode ser tratado de forma diferenciada;
- falha pode bloquear saque.

## Saques

Tabela principal: `WithdrawalRequest`.

Status:

- `PENDING`
- `APPROVED`
- `REJECTED`

Regras antes de criar saque:

- usuario deve estar autenticado e aprovado;
- `withdrawalBlocked` impede saque;
- PIX/KYC obrigatorios;
- casa deve permitir saque no dia/janela atual;
- valor deve respeitar minimo configurado;
- saldo disponivel deve cobrir o valor;
- compliance de deposito deve passar, salvo excecoes;
- deve haver trava para evitar mais de um saque por dia;
- ha taxa de saque configuravel, padrao observado de 6%;
- valor original, taxa e valor liquido devem ser persistidos.

Regras administrativas:

- admin aprova ou rejeita;
- aprovacao reduz disponibilidade futura via calculo de saldo;
- rejeicao deve registrar motivo/admin note quando aplicavel;
- notificacoes e audit logs devem ser gerados.

## Deals e Solicitacoes de Link

Entidades:

- `Deal`
- `LinkRequest`

Fluxo:

1. Usuario acessa deals disponiveis.
2. Solicita afiliacao ou link.
3. Admin analisa.
4. Admin pode cumprir a solicitacao com links em JSON.
5. Usuario passa a visualizar links/campanhas liberados.

Status de `LinkRequest`:

- `PENDING`
- `FULFILLED`
- `REJECTED`

Regra de liberacao para solicitar deals:

- para deals de outras casas, o botao de solicitacao e liberado pela performance do usuario na Superbet;
- a metrica e `deposito medio = deposito / FTD`;
- o limite minimo fica configuravel no banco por deal/casa em `deals.minAvgDepositPerFtd`;
- o minimo de QFTD fica configuravel no banco por deal/casa em `deals.minQualifiedFtd`;
- a janela de analise fica configuravel pela setting `deal_eligibility_window_days`;
- padroes de fallback no codigo: 80 reais de deposito medio, 15 QFTD e 15 dias;
- quando `deals.minAvgDepositPerFtd` for `0`, a trava de deposito medio fica liberada mesmo se o usuario estiver sem FTD;
- a Superbet continua sendo a casa base de metricas (`superbet`);
- se o usuario ainda nao tiver vinculo/campaignId/affiliateId na Superbet, ele nao atende ao requisito para pedir deals de outras casas;
- deals da propria Superbet e casas onde o usuario ja possui `AffiliateLink` nao exigem essa trava.
- afiliados aprovados com onboarding completo devem solicitar um acordo/link da Superbet antes de acessar o restante do painel.

## Dashboard

O dashboard novo agrega:

- filtros de casa e periodo;
- escopo direto/rede/todos;
- KPIs;
- saldo;
- series diarias;
- campanhas;
- performance de links;
- ranking;
- fraude;
- status de sync;
- agenda de saque.

Importante:

- saldo nao deve variar indevidamente com o escopo visual quando o conceito e saldo consolidado;
- resumo e series podem variar por escopo;
- filtros devem preservar estado e evitar chamadas redundantes.

## Aba Rede no Frontend Novo

A pagina `/earnings` foi reposicionada como `Rede`.

Objetivo:

- mostrar informacoes da rede do afiliado;
- deixar claro quem esta produzindo, em qual nivel, em qual casa e quanto gera;
- substituir uma experiencia fraca de "Ganhos" por uma area completa de rede.

Boas praticas aplicadas/esperadas:

- nao carregar dados pesados desnecessarios;
- buscar apenas dados de rede;
- filtros client-side quando ja houver snapshot suficiente;
- renderizacao progressiva dos membros;
- cards com hierarquia visual clara;
- cores diferentes para status, dinheiro, producao, nivel e risco.

## Ranking e Premios

Entidades:

- `RankingPrize`
- `RankPrize`
- `PrizeWinner`

Regras:

- rankings geralmente usam CPA como metrica principal;
- premios podem estar ativos, encerrados ou finalizados;
- premio pode ser saldo, fisico ou outro;
- finalizacao registra vencedores;
- reversao/finalizacao/admin actions devem ser auditaveis;
- usuario pode consultar leaderboard, premios ativos e recompensas.

## Notificacoes

Entidades:

- `Notification`
- `PushSubscription`
- `NotificationSnapshot`

Tipos:

- `REGISTRATION`
- `COMMISSION_CHANGE`
- `WITHDRAWAL_APPROVED`
- `STATUS_CHANGE`
- `GENERAL`

Regras:

- usuarios veem lista e contador de nao lidas;
- podem marcar como lida, marcar todas, deletar;
- admins podem enviar broadcast;
- push usa VAPID e web-push;
- filas podem ser usadas para entrega.

## Sincronizacao com Provedores

Entidades:

- `ProviderAccount`
- `ProviderAccountHouse`
- `SyncLog`

Regras:

- credenciais de provedor sao criptografadas;
- cada casa pode mapear `bookmakerId`/identificador externo;
- sync pode rodar no startup, por agenda ou manualmente;
- resultados devem gerar `SyncLog`;
- dados importados alimentam `AffiliateData`.

## Configuracoes

Tabela principal: `Setting`.

Usos conhecidos:

- valor minimo de saque;
- taxa de saque;
- bloqueio/auditoria de periodos;
- possiveis limites/compliance.

Configuracoes administrativas ficam em `/api/admin/settings` no backend novo.

## Auditoria

Tabela principal: `AuditLog`.

Eventos sensiveis que devem gerar auditoria:

- aprovacao/rejeicao/bloqueio de usuario;
- alteracao de links/comissoes;
- criacao/aprovacao/rejeicao de saque;
- ranking/premios;
- sync/admin actions;
- ajustes financeiros.

## Cuidados em Mudancas de Regra

Antes de alterar qualquer calculo:

- confirmar se afeta dinheiro exibido;
- confirmar se afeta saque;
- comparar backend novo com legado;
- validar com dados reais ou fixtures;
- evitar fallback silencioso de taxa;
- preservar arredondamento e tratamento de nulos;
- documentar qualquer divergencia intencional.
