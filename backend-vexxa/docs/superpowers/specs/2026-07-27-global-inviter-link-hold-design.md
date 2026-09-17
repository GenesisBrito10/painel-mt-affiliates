# Bloqueio global quando o convidante não possui link na casa

## Objetivo

Impedir que um pedido de link seja aprovado com CPA de fallback quando o
solicitante possui convidante e esse convidante ainda não possui link real
ativo com CPA na mesma casa.

A regra vale globalmente para todas as casas, incluindo a Sportingbet.

## Comportamento

- Usuário sem convidante continua seguindo a regra configurada da casa.
- Usuário com convidante que possui link real ativo com CPA na casa continua
  seguindo o cálculo normal da regra.
- Usuário com convidante sem link real ativo com CPA na casa recebe uma
  resolução com `hold=true`.
- Pedidos em espera permanecem `PENDING`, com `resolvedCpa=null`, e não
  consomem links da pool.
- O backfill reavalia os pedidos em espera e permite a atribuição quando o
  convidante passa a ter link real ativo com CPA na casa.

Links placeholder, registros apenas de comissão, links removidos e links sem
CPA não satisfazem a condição.

## Arquitetura

A validação será uma pré-condição global em `CpaResolutionService.resolveCpa`,
antes das ramificações `INVITER_DISCOUNT`, `RANGE` e `MIRROR`. Isso evita que
qualquer tipo de regra contorne o bloqueio usando fallback, default, faixa ou
espelhamento.

A lista `HOLD_WHEN_INVITER_NO_CPA_HOUSES` e seu helper deixam de controlar o
comportamento, pois a regra passa a ser universal.

O fluxo existente de persistência já interpreta `hold=true` gravando
`resolvedCpa=null`. O fluxo de backfill também preserva e reavalia esse estado,
portanto não requer um segundo mecanismo de bloqueio.

## Testes

Os testes devem comprovar:

1. Sportingbet com convidante sem link/CPA retorna `hold=true`, sem fallback.
2. Uma casa genérica com `INVITER_DISCOUNT` também permanece em espera.
3. Regras `RANGE` e `MIRROR` não contornam a pré-condição global.
4. Usuário sem convidante mantém o comportamento atual.
5. Convidante com link real e CPA permite o cálculo normal.

A implementação seguirá TDD: primeiro os testes falhando, depois a alteração
mínima no resolvedor e, por fim, a suíte relacionada completa.
