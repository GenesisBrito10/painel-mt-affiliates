# Migração Pinbet Diário para Pinbet Mensal

## Objetivo

Migrar todos os vínculos operacionais e todo o saldo da `pinbet-diario` para a
`pinbet-mensal`, preservando:

- o CPA e o revshare atuais de cada link;
- os links `afp1` que os afiliados já divulgam;
- os links `afp2` já existentes no Mensal;
- IDs, valores e dados de gateway de todos os saques, inclusive `COMPLETED`;
- os status de todos os saques, exceto os `PENDING` do Diário, que serão
  cancelados explicitamente como `REJECTED`;
- o limite financeiro de 80% do Net P&L calculado separadamente por dimensão;
- um backup suficiente para rollback exato e logs por usuário.

Nenhuma notificação será enviada aos usuários durante a operação.

## Estado observado

A prévia de 5 de agosto de 2026 encontrou 1.628 links ativos no Diário, 108 no
Mensal e, em uma consulta posterior, 92 usuários presentes nas duas casas. A
mesma prévia encontrou 5 saques `PENDING`, de 5 usuários, somando R$ 1.001,37
bruto e R$ 941,29 líquido, sem `gatewayId` e sem envio ao gateway. Os números
mudaram durante a análise, portanto são apenas referência. A execução deve
refazer a prévia dentro do procedimento controlado e nunca usar contagens
históricas como condição de escrita.

O Diário usa `afp1` e campanhas `VALLEX...`; o Mensal usa `afp2` e campanhas
`MJM...`. O Mensal precisa continuar aceitando as duas dimensões depois da
migração.

## Abordagens consideradas

### 1. Troca atômica das chaves com dimensões separadas — escolhida

Mover os registros operacionais do Diário para o Mensal, preservar a dimensão
de origem e calcular o limite de cada dimensão antes de somar os valores
sacáveis. Essa opção mantém links, histórico financeiro, saques e taxas sem
criar créditos artificiais.

### 2. Crédito fixo do saldo atual

Manter o histórico no Diário e lançar um ajuste positivo no Mensal. Foi
descartada porque o crédito exigiria exceções ao limite de Net P&L e preservaria
apenas um retrato do momento, não a composição auditável do saldo.

### 3. Gerar novos links `MJM/afp2`

Foi descartada porque faltam links no pool, exigiria a troca dos links já
divulgados e não transferiria automaticamente o saldo atual.

## Modelo financeiro após a migração

Dentro de `pinbet-mensal`, o sistema manterá dois buckets lógicos:

- `afp1`: dados, links, ajustes e saques originados do Diário;
- `afp2`: dados, links, ajustes e saques que já pertenciam ao Mensal.

Para cada bucket, o sistema calcula:

```text
limite_restante = max(0, 80% * net_pl - saques_consumidos)
disponivel_bucket = min(max(0, saldo_bucket), limite_restante)
```

O disponível apresentado no Mensal será:

```text
disponivel_mensal = max(0, disponivel_afp1 + disponivel_afp2 - saques_pos_migracao)
```

Isso impede que Net P&L negativo ou limite ocioso de uma dimensão altere o
limite da outra. Novos saques criados após a migração consomem uma única vez a
soma já limitada.

## Identificação da dimensão

- Links migrados recebem `linkType='afp1'`.
- Links Mensal existentes recebem `linkType='afp2'`.
- Saques recebem uma dimensão financeira persistida antes da troca de casa:
  Diário vira `afp1`, Mensal vira `afp2` e novos saques posteriores à migração
  usam o bucket pós-migração. Os `PENDING` cancelados permanecem identificados
  como `afp1`, mas `REJECTED` não consome saldo.
- O cálculo de rede seleciona a taxa do líder pela mesma dimensão do link do
  membro. Isso é obrigatório para os usuários que terão mais de um link na
  mesma casa.
- Ajustes financeiros migrados mantêm a dimensão de origem. Se houver conflito
  de unicidade descoberto na prévia final, a operação deve abortar; não deve
  somar ou sobrescrever ajustes implicitamente.

## Escopo da troca de chaves

Dentro de uma única transação de banco:

- `affiliate_links`: `pinbet-diario` para `pinbet-mensal`, sem alterar
  `campaignId`, URL, CPA ou revshare;
- `affiliate_data`: `pinbet-diario` para `pinbet-mensal`, preservando IDs,
  datas e métricas;
- `withdrawal_requests`: antes da troca de casa, todo `PENDING` do Diário é
  alterado por compare-and-set para `REJECTED`, com motivo de migração no log e
  sem notificação. Em seguida, todos os saques passam de `pinbet-diario` para
  `pinbet-mensal`, preservando IDs, valores, gateway e timestamps. Os demais
  status, especialmente `COMPLETED`, não mudam;
- `balance_adjustments`: migrar com a dimensão `afp1`, sem alterar o valor;
- `fraud_counts`: migrar somente se a prévia final encontrar registros e se a
  dimensão puder ser determinada sem ambiguidade; caso contrário, abortar.

Os seguintes registros permanecem como histórico da operação original e não
são reclassificados: `link_requests`, `sync_logs`,
`affiliate_data_change_logs`, `commission_logs`, `audit_logs` e notificações.
`withdrawal_day_releases` também permanece histórico porque a cadência do
Mensal é diferente.

Ao final, `pinbet-diario` continua inativa, manual e com saques desabilitados.
`pinbet-mensal` fica ativa, automática e com saques habilitados na janela
mensal já configurada.

## Smartico e planilha

O sync da `pinbet-mensal` passa a buscar `afp1` e `afp2` sequencialmente, com o
mesmo tratamento de retry e throttling. Os resultados das duas consultas são
gravados em `affiliate_data` sob `pinbet-mensal`, mantendo campanhas disjuntas.
O sync do Diário permanece desativado para não duplicar dados.

As linhas utilizadas da aba Diário serão copiadas para a aba Mensal com status
e e-mail já preenchidos. Elas não entram no pool de links livres. A aba Diário
não será apagada e funcionará como uma segunda referência histórica. Falha na
escrita da planilha não reverte silenciosamente o banco: ela gera log de
inconsistência e uma repetição idempotente da etapa.

## Backup e rollback

Antes de qualquer alteração, o script gera:

1. um `batchId` único;
2. um arquivo JSON local com permissão restrita contendo o snapshot completo
   de todas as linhas que serão alteradas e das configurações das casas;
3. o SHA-256 do arquivo;
4. um log mestre e logs por usuário em `audit_logs`, contendo o `batchId`, IDs
   afetados, valores anteriores e destino;
5. o snapshot das linhas de planilha que serão anexadas e dos intervalos de
   destino.

O arquivo de backup só é considerado válido depois de ser relido, ter seu hash
recalculado e ter suas contagens comparadas com a prévia.

O rollback exige o arquivo, o `batchId` e confirmação explícita. Antes de
restaurar, valida que cada linha ainda corresponde ao estado pós-migração
esperado. Qualquer divergência aborta o rollback inteiro. A restauração do
banco ocorre em uma transação e devolve exatamente as casas, dimensões e
configurações anteriores sem apagar saques. As linhas anexadas à planilha só
são limpas se ainda coincidirem exatamente com o snapshot; caso contrário são
mantidas e a divergência é registrada.

## Procedimento de execução

1. Confirmar banco, usuário do banco e estado atual do Git sem expor segredos.
2. Desabilitar temporariamente novos saques e sincronizações Pinbet.
3. Fazer a prévia final, detectar conflitos, verificar gateway dos `PENDING` e
   calcular os saldos por usuário com e sem a reserva pendente.
4. Gerar, verificar e fechar o backup.
5. Bloquear as tabelas envolvidas e repetir as contagens dentro da transação.
6. Cancelar os `PENDING` do Diário por compare-and-set. A operação aborta se
   algum deles possuir `gatewayId`, `gatewaySentAt` ou tiver mudado de status.
7. Aplicar as demais mudanças e inserir os logs de auditoria.
8. Verificar as invariantes antes do commit; qualquer diferença provoca
   rollback automático.
9. Copiar as linhas da planilha de forma idempotente.
10. Executar um sync controlado das duas dimensões.
11. Reativar apenas a operação Mensal.

## Verificações obrigatórias

- Nenhum link, campanha, CPA ou revshare foi perdido.
- Todos os links que eram Diário agora pertencem ao Mensal e mantêm `afp1`.
- Todos os links Mensal anteriores continuam `afp2`.
- Contagens e somas de `affiliate_data` após a união são iguais às somas das
  duas casas antes da operação.
- Contagens, valores, gateway IDs e timestamps dos saques são idênticos;
  somente a casa, a dimensão e o cancelamento autorizado dos `PENDING` mudam.
- `COMPLETED`, `FAILED` e os `REJECTED` anteriores permanecem com os mesmos
  status; nenhum `PENDING` originado do Diário permanece após a operação.
- Para cada usuário, o disponível pós-migração no Mensal é igual à soma dos
  disponíveis pré-migração do Diário e do Mensal, recalculada sem a reserva dos
  `PENDING` cancelados, até o centavo.
- Os saques pós-migração são deduzidos uma única vez.
- O hash do backup, o log mestre e todos os logs por usuário existem.
- O comando de rollback passa por uma simulação somente leitura antes de ser
  considerado utilizável.

## Testes

- Testes unitários do cálculo separado `afp1`/`afp2`, incluindo Net P&L
  negativo, limite ocioso, saques anteriores e saques pós-migração.
- Testes do cálculo de rede com dois links Mensal e CPAs diferentes.
- Testes do extrator Smartico consultando as duas dimensões sem misturar
  campanhas.
- Testes do script em modo `--dry-run`, de execução idempotente e de rollback.
- Verificação focada do build e das suítes afetadas antes da operação real.
