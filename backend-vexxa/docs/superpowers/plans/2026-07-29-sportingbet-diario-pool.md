# Sportingbet Diário Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o pool e deal inativos da Sportingbet Diário e garantir atribuição monotônica nas abas mensal e diária.

**Architecture:** O parser e as funções puras de identidade/sequência permanecem no domínio Sportingbet compartilhado. A casa diária recebe módulo, sheet service, assignment service, scheduler e controller próprios para manter slug, aba e locks isolados; o fluxo central roteia `sportingbet-diario` para esse serviço. Um seed transacional cria casa, deal, regra e associação OTG inativos.

**Tech Stack:** NestJS, TypeScript, Prisma, PostgreSQL, Google Sheets API, Redis e Vitest.

---

### Task 1: Contrato da planilha e cursor monotônico

**Files:**

- Modify: `src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.spec.ts`
- Modify: `src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.ts`
- Modify: `src/modules/sportingbet-link-pool/domain/sportingbet.types.spec.ts`
- Modify: `src/modules/sportingbet-link-pool/domain/sportingbet.types.ts`

- [ ] **Step 1: Escrever testes RED para `E-MAIL` e sequência**

Adicionar testes que provem:

```ts
expect(
  parseSportingbetSheet([
    ['IDENTIFICAÇÃO', 'Afiliado', 'Tipo de Link', 'URL', 'STATUS', 'E-MAIL'],
    ['001', 'Bianca Rocha Lima', 'Telegram', 'https://daily/1', '', ''],
  ]),
).toMatchObject({ columns: { status: 'E', email: 'F' } });
```

E:

```ts
expect(
  selectSequentialSportingbetRows([
    row(2),
    row(12, 'marcado', 'old@example.com'),
    row(13),
    row(230),
  ]),
).toEqual([row(13), row(230)]);

expect(selectSequentialSportingbetRows([row(2), row(3)])[0]?.rowIndex).toBe(2);
```

- [ ] **Step 2: Executar RED**

```bash
pnpm vitest run src/modules/sportingbet-link-pool/domain/sportingbet-sheet.parser.spec.ts src/modules/sportingbet-link-pool/domain/sportingbet.types.spec.ts
```

Esperado: falha porque `E-MAIL` não é reconhecido e o seletor não existe.

- [ ] **Step 3: Implementar aliases e seletor**

O parser deve aceitar exatamente um cabeçalho de cada grupo:

```ts
const REQUIRED_HEADERS = {
  affiliate: ['afiliado'],
  linkType: ['tipo de link'],
  link: ['url'],
  status: ['status'],
  email: ['email', 'e-mail'],
} as const;
```

O domínio deve exportar:

```ts
export function selectSequentialSportingbetRows(rows: SheetRow[]): SheetRow[] {
  const lastControlledRow = rows.reduce(
    (last, row) =>
      row.status || row.email ? Math.max(last, row.rowIndex) : last,
    1,
  );
  return rows
    .filter((row) => row.rowIndex > lastControlledRow)
    .sort((a, b) => a.rowIndex - b.rowIndex);
}
```

Disponibilidade continua sendo validada separadamente para impedir atribuição
de linhas incompletas.

- [ ] **Step 4: Executar GREEN**

Executar o comando do Step 2 e esperar todos os testes passarem.

### Task 2: Sportingbet atual sem preenchimento de lacunas

**Files:**

- Modify: `src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.spec.ts`
- Modify: `src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.ts`
- Modify: `src/modules/sportingbet-link-pool/infrastructure/sportingbet-admin.controller.ts`

- [ ] **Step 1: Escrever testes RED**

Cobrir:

```ts
// linha 12 controlada faz a próxima atribuição usar a 13, sem voltar à 2
expect(result).toMatchObject({ assigned: true, rowIndex: 13 });
```

E um conflito na linha 13:

```ts
expect(sheetService.markRowUsed).toHaveBeenNthCalledWith(
  1,
  13,
  'owner@example.com',
);
expect(result).toMatchObject({ assigned: true, rowIndex: 14 });
```

Quando `markRowUsed(13, owner)` rejeitar, esperar `assigned=false` e nenhuma
escrita/atribuição da linha 14.

- [ ] **Step 2: Executar RED**

```bash
pnpm vitest run src/modules/sportingbet-link-pool/application/sportingbet-assignment.service.spec.ts
```

- [ ] **Step 3: Implementar seleção e reconciliação**

Usar `selectSequentialSportingbetRows(rows)`. Avaliar a primeira linha da cauda:

- linha incompleta retorna `pool_blocked`;
- conflito consulta também `user.email`;
- conflito é marcado na planilha e mutado em memória antes de avançar;
- falha de marcação retorna `sheet_write_failed`;
- somente uma linha nova é atribuída por solicitação.

Adicionar os motivos ao union `AssignReason`. O status administrativo deve
contar como disponíveis apenas as linhas completas após o cursor.

- [ ] **Step 4: Executar GREEN**

Executar o comando do Step 2 e os testes de domínio da Task 1.

### Task 3: Módulo `sportingbet-diario-link-pool`

**Files:**

- Create: `src/modules/sportingbet-diario-link-pool/domain/sportingbet-diario.types.ts`
- Create: `src/modules/sportingbet-diario-link-pool/application/sportingbet-diario-sheet.service.ts`
- Create: `src/modules/sportingbet-diario-link-pool/application/sportingbet-diario-sheet.service.spec.ts`
- Create: `src/modules/sportingbet-diario-link-pool/application/sportingbet-diario-assignment.service.ts`
- Create: `src/modules/sportingbet-diario-link-pool/application/sportingbet-diario-assignment.service.spec.ts`
- Create: `src/modules/sportingbet-diario-link-pool/application/sportingbet-diario-scheduler.service.ts`
- Create: `src/modules/sportingbet-diario-link-pool/application/sportingbet-diario-scheduler.service.spec.ts`
- Create: `src/modules/sportingbet-diario-link-pool/infrastructure/sportingbet-diario-admin.controller.ts`
- Create: `src/modules/sportingbet-diario-link-pool/sportingbet-diario-link-pool.module.ts`
- Create: `src/modules/sportingbet-diario-link-pool/index.ts`

- [ ] **Step 1: Escrever RED do sheet service diário**

O teste deve verificar:

```ts
expect(get).toHaveBeenCalledWith({
  spreadsheetId: 'sheet-1',
  range: "'Diário'!A1:ZZ",
});
expect(batchUpdate).toHaveBeenCalledWith(
  expect.objectContaining({
    spreadsheetId: 'sheet-1',
    requestBody: expect.objectContaining({
      data: [
        { range: "'Diário'!E2", values: [['marcado']] },
        { range: "'Diário'!F2", values: [['user@example.com']] },
      ],
    }),
  }),
);
```

- [ ] **Step 2: Implementar sheet service**

Usar `SPORTINGBET_SHEET_ID` e
`SPORTINGBET_DIARIO_SHEET_TAB ?? 'Diário'`, parser compartilhado, escrita apenas
nas colunas descobertas e aspas A1 para nomes de aba.

- [ ] **Step 3: Escrever RED da atribuição diária**

Verificar criação:

```ts
expect(tx.affiliateLink.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    bettingHouse: 'sportingbet-diario',
    campaignId: 'BiancaRochaLima::Telegram',
    affiliateId: 'BiancaRochaLima',
    linkType: 'Telegram',
    userLink: 'https://brsportingbet.net/registro17631',
    cpa: 60,
    revshare: 0,
  }),
});
```

- [ ] **Step 4: Implementar atribuição diária**

Usar constantes próprias:

```ts
export const SPORTINGBET_DIARIO_SLUG = 'sportingbet-diario';
export const SPORTINGBET_DIARIO_LOCK_KEY = 'sportingbet-diario:assign:lock';
export const SPORTINGBET_DIARIO_SCHEDULER_LOCK_KEY =
  'sportingbet-diario:scheduler:lock';
```

Reutilizar identidade e sequência do domínio Sportingbet, mas persistir e
consultar somente `sportingbet-diario`.

- [ ] **Step 5: Escrever RED do scheduler inativo**

Com casa inativa ou `autoAssignEnabled=false`, `backfillPending()` não deve
consultar pedidos nem ler a planilha. Com ambos ativos, deve buscar `PENDING`
com `resolvedCpa != null`, `orderBy createdAt asc`, e usar comissão do snapshot.

- [ ] **Step 6: Implementar scheduler, controller e módulo**

O scheduler consulta a configuração antes do lock:

```ts
const config = await prisma.bettingHouse.findUnique({
  where: { slug: SPORTINGBET_DIARIO_SLUG },
  select: { active: true, linkRule: { select: { autoAssignEnabled: true } } },
});
if (!config?.active || !config.linkRule?.autoAssignEnabled) return;
```

O controller usa `/v1/admin/sportingbet-diario`, e o módulo exporta assignment
e sheet services.

- [ ] **Step 7: Executar GREEN do módulo**

```bash
pnpm vitest run src/modules/sportingbet-diario-link-pool
```

### Task 4: Roteamento central e compilação

**Files:**

- Modify: `src/modules/link-request/link-request.module.ts`
- Modify: `src/modules/link-request/application/link-request.service.ts`
- Modify: `src/modules/sportingbet-link-pool/index.ts`
- Create: `src/modules/link-request/application/link-request.sportingbet-diario.spec.ts`

- [ ] **Step 1: Escrever RED de roteamento**

O teste deve criar uma solicitação elegível para
`bettingHouseSlug='sportingbet-diario'` e verificar que
`SportingbetDiarioAssignmentService.tryAssign` recebe o snapshot CPA 60/0.

- [ ] **Step 2: Implementar imports, injeção e switch**

Importar `SportingbetDiarioLinkPoolModule`, injetar
`SportingbetDiarioAssignmentService` e adicionar:

```ts
case SPORTINGBET_DIARIO_SLUG:
  return this.sportingbetDiarioAssignment;
```

Corrigir o barrel atual removendo exports inexistentes
`SPORTINGBET_CAMPAIGN_PREFIX` e `SPORTINGBET_CAMPAIGN_SUFFIX`, preservando
`buildSportingbetCampaignId` e `SPORTINGBET_SLUG`.

- [ ] **Step 3: Executar testes e typecheck**

```bash
pnpm vitest run src/modules/link-request/application/link-request.sportingbet-diario.spec.ts src/modules/sportingbet-link-pool src/modules/sportingbet-diario-link-pool
pnpm tsc --noEmit
```

### Task 5: Seed transacional e ativação futura

**Files:**

- Create: `scripts/setup-sportingbet-diario.mjs`

- [ ] **Step 1: Implementar dry-run idempotente**

O script usa `--apply` para commit e faz rollback por padrão. Deve:

```js
await tx.bettingHouse.upsert({
  where: { slug: 'sportingbet-diario' },
  update: inactiveHouse,
  create: { slug: 'sportingbet-diario', ...inactiveHouse },
});
```

Criar/atualizar um único deal com CPA 60, revshare 0,
`minAvgDepositPerFtd=40`, `conditionsText` contendo depósito médio 40 e rollover
2x, `active=false`.

Criar/atualizar a regra com `requestEnabled=false`,
`autoAssignEnabled=false`, `processOldRequests=true`, padrão/fallback/teto 60 e
desconto 5.

Copiar o `bookmarkerId` da associação OTG Sportingbet e criar
`ProviderAccountHouse.active=false` para a nova casa.

- [ ] **Step 2: Executar dry-run**

```bash
node --env-file=.env scripts/setup-sportingbet-diario.mjs
```

Esperado: preview mostra todos os componentes inativos e rollback confirmado.

- [ ] **Step 3: Executar verificações completas**

```bash
pnpm vitest run src/modules/sportingbet-link-pool src/modules/sportingbet-diario-link-pool src/modules/link-request/application/link-request.sportingbet-diario.spec.ts
pnpm eslint src/modules/sportingbet-link-pool src/modules/sportingbet-diario-link-pool scripts/setup-sportingbet-diario.mjs
pnpm tsc --noEmit
git diff --check
```

- [ ] **Step 4: Aplicar seed e verificar**

```bash
node --env-file=.env scripts/setup-sportingbet-diario.mjs --apply
node --env-file=.env scripts/setup-sportingbet-diario.mjs
```

A segunda execução deve mostrar estado idempotente e rollback. Uma leitura
independente deve confirmar casa/deal/regra/associação inativos.

- [ ] **Step 5: Verificar planilha sem escrita**

Ler `Diário!A1:ZZ` com credenciais somente leitura e confirmar zero linhas com
`STATUS` ou `E-MAIL`.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-07-29-sportingbet-diario-pool.md \
  src/modules/sportingbet-link-pool \
  src/modules/sportingbet-diario-link-pool \
  src/modules/link-request/link-request.module.ts \
  src/modules/link-request/application/link-request.service.ts \
  src/modules/link-request/application/link-request.sportingbet-diario.spec.ts \
  scripts/setup-sportingbet-diario.mjs
git commit -m "feat(sportingbet-diario): add inactive sequential link pool"
```
