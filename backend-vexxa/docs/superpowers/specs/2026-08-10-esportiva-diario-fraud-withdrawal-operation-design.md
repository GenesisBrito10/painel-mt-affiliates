# Esportiva Diário: limpeza de saques pendentes e distribuição de CPA fraude

## Objetivo

Executar uma manutenção financeira produtiva, restrita à casa `esportiva-diario`, que:

1. apague todos os saques com status `PENDING` da casa;
2. lance como CPA fraude exatamente 20% do valor bruto desses saques, usando como referência operacional aprovada R$ 15.575,00 e alvo de R$ 3.115,00;
3. distribua o débito entre usuários reais com saldo na casa, considerando o CPA atual de cada usuário;
4. impeça concentração excessiva da perda e preserve rastreabilidade completa.

Os números observados em 10 de agosto de 2026 são uma fotografia, não uma autorização para usar dados antigos no `--apply`: 64 saques `PENDING`, 62 usuários e R$ 15.575,00, sem `gatewayId` ou `gatewaySentAt`. O modo de aplicação deve recalcular e exigir exatamente esses totais antes de gravar; qualquer divergência aborta a operação.

## Regra financeira aprovada

Um lançamento de fraude é contado em unidades inteiras por usuário. Para cada alvo:

`debitoFraude = CPA atual do usuário em esportiva-diario x incremento de fraud_count`

As regras da distribuição são:

- incrementar no máximo 1 CPA fraude por usuário;
- usar somente usuário `AFFILIATE`, `APPROVED`, ativo, não excluído e `isExternal=false`;
- exigir vínculo ativo em `esportiva-diario`, com CPA positivo, usando o vínculo ativo mais recente do usuário na casa;
- calcular o saldo pelo `DashboardBalanceService` real, filtrado por `esportiva-diario`;
- considerar o saldo posterior à exclusão dos pendentes: saldo atual da casa mais o valor dos pendentes da mesma casa que será liberado;
- selecionar somente usuário cujo CPA seja no máximo 50% desse saldo pós-exclusão;
- exigir que, após o débito, o usuário preserve pelo menos 50% do saldo pós-exclusão e saldo não negativo;
- encontrar uma combinação cuja soma dos CPAs individuais seja exatamente R$ 3.115,00;
- maximizar a quantidade de usuários dentro das regras e randomizar a escolha entre combinações equivalentes;
- usar uma semente explícita e reproduzível, registrada no relatório e nos logs de auditoria.

Na fotografia aprovada, 73 usuários atendem ao limite de 50%, com capacidade de uma unidade por pessoa de R$ 3.635,00. Existe combinação exata de R$ 3.115,00 distribuída por até 63 usuários, com CPAs individuais entre R$ 40,00 e R$ 60,00. O lote aplicado deve ser derivado da nova leitura, e não de IDs capturados durante a análise.

## Script operacional

Um único script versionado será responsável por `dry-run`, aplicação e verificação. O comportamento padrão será somente leitura; escrita exigirá `--apply` e os parâmetros explícitos do lote.

Entradas fixas e protegidas:

- casa: `esportiva-diario`;
- valor bruto esperado dos pendentes: R$ 15.575,00;
- percentual: 20%;
- alvo de fraude: R$ 3.115,00;
- limite: 1 CPA por usuário;
- comprometimento máximo: 50% do saldo pós-exclusão;
- identificador e motivo únicos do lote;
- semente aleatória explícita.

O script não aceitará trocar a casa ou relaxar limites por argumento. Uma nova operação com valores diferentes exigirá revisão consciente do código ou uma especificação nova.

## Dry-run

O dry-run deve:

1. consultar os saques `PENDING` somente de `esportiva-diario` e reportar quantidade, usuários distintos, valores bruto e líquido e presença de identificadores/envios ao gateway;
2. abortar se houver `gatewayId`, `gatewaySentAt` ou qualquer indício de submissão ao provedor;
3. carregar candidatos e calcular saldos com paralelismo limitado, usando múltiplos workers somente para leituras independentes;
4. calcular saldo pós-exclusão, CPA, percentual comprometido e saldo projetado de cada candidato;
5. executar o solucionador de combinação exata com a semente informada;
6. gerar um manifesto JSON imutável do lote contendo snapshot temporal, hashes, saques, alvos, CPA, saldos antes/depois, totais e semente;
7. encerrar sem abrir transação de escrita e sem alterar banco, notificar usuários ou chamar webhooks.

O resumo de terminal deve omitir dados pessoais desnecessários. O manifesto local pode conter os IDs técnicos exigidos para auditoria e deve ficar fora do Git.

## Aplicação transacional

O `--apply` não confiará cegamente no manifesto. Dentro de uma única transação ele deve:

1. adquirir um advisory lock exclusivo para a operação da casa;
2. bloquear e reler os saques-alvo com o predicado exato `bettingHouse='esportiva-diario' AND status='PENDING'`;
3. exigir novamente 64 linhas, 62 usuários, R$ 15.575,00 e zero vínculo/envio ao gateway;
4. reler os vínculos, CPAs e `fraud_counts` dos usuários selecionados;
5. recalcular sequencialmente os saldos dos alvos no mesmo contexto transacional e confirmar todas as regras de elegibilidade, o limite de 50% e a soma exata de R$ 3.115,00;
6. abortar se o lote já tiver logs com o mesmo identificador, se algum CPA/saldo/saque divergir ou se já existir fraude positiva inesperada;
7. apagar os 64 saques com `DELETE ... RETURNING`;
8. fazer `upsert` de `fraud_counts`, incrementando exatamente de 0 para 1 para cada alvo;
9. criar um `fraud_log` por usuário com `oldCount=0`, `newCount=1`, motivo, administrador responsável, identificador do lote e semente;
10. criar um `audit_log` único para a exclusão dos saques, incluindo IDs, quantidades, totais, hashes e o vínculo com o lote de fraude;
11. validar contagens e totais escritos antes do `COMMIT`.

As escritas ficam intencionalmente serializadas dentro da transação. O paralelismo é usado no dry-run e nas verificações independentes, onde não compromete atomicidade nem aumenta o risco de corrida.

## Verificação posterior independente

Após o commit, uma nova conexão deve verificar:

- zero saque `PENDING` em `esportiva-diario`;
- zero `APPROVED` ou `PROCESSING` inesperado na casa;
- estados `COMPLETED`, `FAILED` e `REJECTED` preservados;
- exatamente a quantidade planejada de usuários distintos no lote;
- zero usuários externos;
- cada alvo com incremento exato de `fraud_count` de 0 para 1;
- soma de `CPA x incremento` exatamente igual a R$ 3.115,00;
- nenhum saldo projetado negativo e comprometimento individual máximo de 50%;
- quantidade correta de `fraud_logs` e um `audit_log` da exclusão;
- ausência de notificações, webhooks ou alterações fora de `esportiva-diario`.

O relatório final deve separar claramente: valores do preview, valores retornados pela transação e valores encontrados na verificação independente.

## Falhas e recuperação

Qualquer falha anterior ao commit provoca `ROLLBACK` integral. O script não tentará ajustar automaticamente totais, selecionar usuários extras ou excluir estados diferentes de `PENDING`.

Se a conexão cair depois do pedido de commit e antes da confirmação ao cliente, o operador deve executar somente o modo de verificação. A proteção por identificador único do lote impede reaplicação incerta. Não haverá rotina automática de compensação; eventual reversão exigirá operação específica baseada nos logs e no manifesto.

## Testes

Os testes automatizados devem cobrir:

- cálculo de 20% e representação monetária sem erro de ponto flutuante;
- combinação exata de CPAs diferentes;
- maximização da quantidade de usuários;
- desempate aleatório reproduzível pela semente;
- exclusão de usuário externo, inativo, sem vínculo ativo, sem saldo ou acima do limite de 50%;
- saldo pós-exclusão incluindo somente pendentes de `esportiva-diario`;
- aborto por divergência de valor/quantidade, gateway vinculado, lote reaplicado, CPA alterado ou fraude já existente;
- ausência de escrita no dry-run;
- rollback integral quando qualquer validação transacional falhar;
- preservação de saques de outras casas e de estados não `PENDING`.

## Fora de escopo

- alterar a fórmula global de saldo ou o `DashboardBalanceService`;
- apagar saques de outra casa ou estados diferentes de `PENDING`;
- enviar notificações administrativas ou aos afiliados;
- modificar CPA, vínculo, dados de afiliado, comissões ou ajustes de saldo;
- aplicar um valor aproximado de fraude: o total deve ser exatamente R$ 3.115,00.
