# Sportingbet Diário: pool, deal e atribuição sequencial

## Objetivo

Criar a casa e o deal `sportingbet-diario`, com pool próprio na aba `Diário` da
mesma planilha usada pela Sportingbet, mantendo toda a configuração inativa até
liberação posterior.

Também corrigir a seleção de linhas da Sportingbet para que novas atribuições
sigam uma sequência monotônica e não voltem a preencher lacunas antigas.

## Estado inicial verificado

- A aba `Links` possui 2.151 linhas de dados, 53 linhas controladas e 175
  lacunas antes da última linha controlada, que é a linha 229.
- A aba `Diário` possui 1.000 linhas de dados e nenhuma atribuição.
- A aba `Diário` usa os cabeçalhos `IDENTIFICAÇÃO`, `Afiliado`,
  `Tipo de Link`, `URL`, `STATUS` e `E-MAIL`.
- Não existe atualmente uma casa `sportingbet-diario` no banco.

## Casa, deal e regra

A implantação cria, de forma idempotente:

- casa:
  - slug: `sportingbet-diario`;
  - nome: `SportingBet Diário`;
  - inativa;
  - depósito médio mínimo da casa: R$ 40;
  - cadência diária, sem janelas mensais de saque;
- deal:
  - nome: `SportingBet Diário`;
  - inativo;
  - CPA: R$ 60;
  - revshare: 0;
  - depósito médio: R$ 40;
  - condição: `Rollover 2x`;
- regra:
  - `INVITER_DISCOUNT`;
  - inativa para solicitações e atribuição automática;
  - CPA padrão e fallback configurados em R$ 60;
  - teto do CPA do convidante em R$ 60;
  - desconto de R$ 5;
  - revshare 0;
  - reprocessamento de pedidos antigos habilitado para funcionar quando a casa
    e a atribuição forem ativadas.

Quando a casa for ativada:

- usuário sem convidante recebe CPA 60;
- usuário com convidante e link real com CPA na casa recebe o CPA do convidante
  menos R$ 5, respeitando o teto configurado;
- usuário com convidante sem link real com CPA na casa permanece `PENDING`,
  sem fallback, conforme a regra global existente.

## Planilha

O pool diário usa:

- planilha: `SPORTINGBET_SHEET_ID`;
- aba padrão: `Diário`;
- override opcional: `SPORTINGBET_DIARIO_SHEET_TAB`.

O parser é compartilhado com a Sportingbet e localiza colunas por cabeçalho. O
campo de e-mail aceita os aliases `EMAIL` e `E-MAIL`. Os demais campos exigidos
são `Afiliado`, `Tipo de Link`, `URL` e `STATUS`; `IDENTIFICAÇÃO` é ignorado.

Cada linha é um item independente. Nomes repetidos não formam pacotes.

Identidade persistida:

- `affiliateId`: afiliado sem espaços, preservando letras, acentos e caixa;
- `linkType`: `Tipo de Link` sem espaços externos;
- `campaignId`: `<affiliateId>::<linkType>`;
- `userLink`: `URL`;
- label do link entregue: `linkType`.

## Seleção sequencial

A seleção deixa de usar a primeira lacuna vazia da planilha.

Para cada aba:

1. localizar a maior `rowIndex` que tenha `STATUS` ou e-mail preenchido;
2. ignorar todas as lacunas anteriores ou iguais a essa linha;
3. ordenar as linhas seguintes por `rowIndex`;
4. atribuir somente a primeira linha completa e livre;
5. depois de marcá-la, a próxima solicitação usa a linha seguinte.

Consequências:

- na aba `Links`, a próxima atribuição começa na linha 230;
- na aba `Diário`, a primeira atribuição começa na linha 2;
- lacunas históricas da aba `Links` não são reaproveitadas automaticamente.

Se a próxima linha já estiver vinculada no banco, mas estiver vazia na
planilha, o serviço primeiro reconcilia essa própria linha com o e-mail do
usuário já vinculado. Somente após a reconciliação bem-sucedida avança para a
linha seguinte. Se a reconciliação falhar, o ciclo para sem atribuir uma linha
posterior. Linhas incompletas ou inválidas também bloqueiam a sequência em vez
de serem puladas silenciosamente.

O Redis serializa atribuições por casa. A Sportingbet mensal e a diária usam
locks distintos porque trabalham em abas e identidades de casa diferentes.

## Persistência e integração

Será criado um módulo `sportingbet-diario-link-pool` com:

- serviço da aba `Diário`;
- atribuição para `bettingHouse='sportingbet-diario'`;
- scheduler próprio, que encerra sem consultar/atribuir quando a casa ou
  `autoAssignEnabled` estiver inativa;
- endpoint administrativo de status/backfill;
- roteamento pelo fluxo central de solicitações.

A conta OTG existente não será duplicada. O seed cria apenas um
`ProviderAccountHouse` inativo para `sportingbet-diario`, copiando o
`bookmarkerId` da associação Sportingbet/OTG atual. O scheduler do pool não
atribui até a casa e a regra serem ativadas; o cron de métricas não inclui a
nova casa até a associação OTG ser ativada.

## Segurança operacional

- O seed é idempotente.
- Casa, deal, regra de solicitação, atribuição e associação OTG permanecem
  inativos.
- A implantação não marca, limpa ou reorganiza linhas da planilha.
- A aba `Links` mantém suas marcações atuais; somente a estratégia de próximas
  escolhas muda.
- Credenciais continuam vindo do ambiente e não são gravadas no código.

## Testes e verificação

Cobertura obrigatória:

1. parser aceita `EMAIL` e `E-MAIL`;
2. seletor da Sportingbet ignora lacunas anteriores à última linha controlada;
3. aba nova começa na menor linha de dados;
4. conflito no banco é reconciliado antes de avançar;
5. falha de reconciliação impede pular para linha posterior;
6. atribuição diária persiste slug, afiliado, tipo, URL e CPA/revshare;
7. scheduler diário processa pedidos por data de criação e marca em lote;
8. roteamento central escolhe a atribuição diária;
9. seed dry-run mostra todos os registros inativos;
10. execução do seed é verificada por uma segunda leitura independente do
    banco;
11. leitura autenticada confirma que nenhuma linha da aba `Diário` foi marcada
    durante a implantação.
