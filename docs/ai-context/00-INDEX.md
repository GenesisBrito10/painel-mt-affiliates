# Contexto do Projeto para IAs

Este diretorio e o ponto de partida para qualquer IA ou desenvolvedor que va trabalhar no projeto Vallex/Vexxa sem precisar reabrir todos os arquivos primeiro.

Leia nesta ordem:

1. `01-ARCHITECTURE.md`
   - Visao geral do repositorio.
   - Superficies do sistema: backend novo, frontend novo, API legada, frontends legados.
   - Como as pecas se conectam.

2. `02-BUSINESS-RULES.md`
   - Regras de negocio principais.
   - Cadastro, aprovacao, rede, comissoes, saldo, saques, ranking, notificacoes e sincronizacao.

3. `03-BACKEND-REFERENCE.md`
   - Backend NestJS em `backend-vexxa`.
   - Modulos, rotas, entidades, servicos e pontos sensiveis.

4. `04-FRONTEND-REFERENCE.md`
   - Frontend Nuxt em `frontend`.
   - Abas, paginas, composables, componentes, padroes de UI e fluxo de dados.

5. `05-LEGACY-REFERENCE.md`
   - API legada em `api`.
   - Frontend legado em `frontend-legacy`.
   - Admin legado em `admin`.
   - Comportamentos legados que ainda servem de referencia.

## Regra de Ouro

O projeto esta em migracao. Antes de alterar comportamento de negocio, compare:

- Novo backend: `backend-vexxa`
- Novo frontend: `frontend`
- Legado de negocio: `api`, `frontend-legacy`, `admin`
- Documentos de plano: `.agent/ARCHITECTURE.md` e `action_plan_phase*.md`

O novo sistema deve seguir os padroes do projeto atual, mas muitas regras de negocio nasceram no legado. Nao assuma que uma regra esta errada so porque parece complexa: afiliados, rede, CPA, RevShare, fraude, saque e ranking tem dependencias financeiras.

## Estado Recente Importante

A aba `/earnings` do frontend novo foi reposicionada para ser a area de `Rede`, substituindo o menu `Ganhos`. Ela deve focar em informacoes da rede do afiliado e foi otimizada para evitar carregamento pesado da aba `Minha Rede`.

Arquivos recentes relacionados:

- `frontend/app/pages/earnings.vue`
- `frontend/app/layouts/default.vue`
- `frontend/app/components/earnings/NetworkMemberCard.vue`
- `frontend/app/composables/useEarningsNetwork.ts`
- `frontend/app/types/earnings.ts`
- `backend-vexxa/src/modules/dashboard/controllers/earnings.controller.ts`
- `backend-vexxa/src/modules/dashboard/services/dashboard-network.service.ts`

## Cuidados ao Trabalhar

- Nao reverta mudancas locais que voce nao fez.
- O repositorio raiz pode nao mostrar diffs internos de `backend-vexxa`, porque ele se comporta como um gitlink/submodulo sem `.gitmodules` visivel.
- Use o backend novo como fonte principal para novas APIs.
- Use o frontend novo como alvo principal de UX.
- Use legado para validar regra de negocio quando houver duvida.
- Mudancas financeiras precisam de teste ou validacao manual cuidadosa.
