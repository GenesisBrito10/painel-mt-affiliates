# Global Inviter Link Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manter pendente qualquer pedido cujo solicitante tenha convidante sem link real ativo com CPA na mesma casa.

**Architecture:** `CpaResolutionService.resolveCpa` aplicará uma pré-condição global antes de escolher entre `INVITER_DISCOUNT`, `RANGE` e `MIRROR`. O retorno existente `hold=true` continuará sendo interpretado pelo fluxo de criação e backfill como `PENDING` com `resolvedCpa=null`.

**Tech Stack:** NestJS, TypeScript, Prisma e Vitest.

---

### Task 1: Provar a regra global no resolvedor

**Files:**
- Modify: `src/modules/link-request/application/cpa-resolution.service.spec.ts`

- [ ] **Step 1: Escrever testes falhando**

Adicionar casos que chamam `resolveCpa` com convidante sem link/CPA e verificam
`hold=true`, `fallbackUsed=false` e ausência do toggle de fallback para:

```ts
it.each([
  ['sportingbet', LinkRuleType.INVITER_DISCOUNT],
  ['casa-range', LinkRuleType.RANGE],
  ['casa-mirror', LinkRuleType.MIRROR],
])('%s com convidante sem link fica em espera', async (houseSlug, ruleType) => {
  const svc = new CpaResolutionService(makePrisma(null));
  const result = await svc.resolveCpa({
    houseSlug,
    userId: 'user-1',
    inviterId: 'inviter-1',
    rule: makeRule({ houseSlug, ruleType }),
  });

  expect(result.hold).toBe(true);
  expect(result.fallbackUsed).toBe(false);
  expect(result.togglesApplied).toContain('holdInviterNoCpa');
});
```

- [ ] **Step 2: Executar o teste e confirmar RED**

Run:

```bash
pnpm vitest run src/modules/link-request/application/cpa-resolution.service.spec.ts
```

Expected: FAIL nos novos casos porque Sportingbet e casas genéricas ainda usam
fallback, e `MIRROR`/`RANGE` resolvem antes do bloqueio.

### Task 2: Aplicar a pré-condição global

**Files:**
- Modify: `src/modules/link-request/application/cpa-resolution.service.ts`
- Modify: `src/modules/link-request/domain/types/link-request.types.ts`

- [ ] **Step 1: Implementar o bloqueio mínimo**

Logo após criar `build`, consultar o CPA real do convidante na casa:

```ts
if (inviterId) {
  const inviterCpa = await this.readRealCpa(inviterId, houseSlug);
  if (inviterCpa === null) {
    toggles.push('holdInviterNoCpa');
    return build({ hold: true });
  }
}
```

Remover `HOLD_WHEN_INVITER_NO_CPA_HOUSES`, `holdsWhenInviterNoCpa` e a
ramificação condicionada à lista. Manter o cálculo atual quando o convidante
possuir CPA real.

- [ ] **Step 2: Executar o teste e confirmar GREEN**

Run:

```bash
pnpm vitest run src/modules/link-request/application/cpa-resolution.service.spec.ts
```

Expected: todos os testes do arquivo passam.

- [ ] **Step 3: Refatorar sem duplicar consulta**

Reutilizar o CPA carregado pela pré-condição no ramo `INVITER_DISCOUNT`, evitando
uma segunda chamada a `affiliateLink.findFirst`.

### Task 3: Verificação e commit

**Files:**
- Verify: `src/modules/link-request/application/cpa-resolution.service.ts`
- Verify: `src/modules/link-request/application/cpa-resolution.service.spec.ts`
- Verify: `src/modules/link-request/domain/types/link-request.types.ts`

- [ ] **Step 1: Executar verificações focadas**

```bash
pnpm vitest run src/modules/link-request/application/cpa-resolution.service.spec.ts src/modules/link-request/application/link-request.create.spec.ts
pnpm eslint src/modules/link-request/application/cpa-resolution.service.ts src/modules/link-request/application/cpa-resolution.service.spec.ts src/modules/link-request/domain/types/link-request.types.ts
pnpm tsc --noEmit
```

Expected: testes, lint e compilação passam sem novos erros.

- [ ] **Step 2: Revisar o diff**

```bash
git diff --check
git diff -- src/modules/link-request/application/cpa-resolution.service.ts src/modules/link-request/application/cpa-resolution.service.spec.ts src/modules/link-request/domain/types/link-request.types.ts
```

Expected: somente a regra global, testes e remoção da lista especial.

- [ ] **Step 3: Commitar**

```bash
git add src/modules/link-request/application/cpa-resolution.service.ts src/modules/link-request/application/cpa-resolution.service.spec.ts src/modules/link-request/domain/types/link-request.types.ts docs/superpowers/plans/2026-07-27-global-inviter-link-hold.md
git commit -m "fix(link-request): hold when inviter has no house link"
```
