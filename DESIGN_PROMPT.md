# Prompt: Redesign Completo — Vallex Group (Frontend + Admin)

## Contexto do Projeto

Você está redesenhando dois painéis de um sistema de afiliados de apostas esportivas:

1. **Frontend** (`/frontend`) — painel do afiliado (usuário final)
2. **Admin** (`/admin`) — painel administrativo interno

Ambos são aplicações **Nuxt 3 + Nuxt UI v3 + Tailwind CSS v4**. O código já existe e funciona. Você **não reescreve a lógica**, apenas transforma o visual: cores, tipografia, layout, componentes, espaçamento, hierarquia visual.

---

## Identidade Visual da Marca — Vallex Group

### Paleta de Cores (extraída do brand book oficial)

```
Primário Gold:     #F5B800   → amarelo vibrante do logo "Valle"
Primário Purple:   #7C3AED   → roxo do "X" do logo
Dark BG:           #0A0A0E   → fundo principal (quase preto)
Surface:           #111115   → cards, sidebar
Surface Elevated:  #1A1A20   → modais, dropdowns, hover states
Border:            #252530   → separadores e bordas
Border Accent:     rgba(245,184,0,0.2) → bordas com toque dourado
Text Primary:      #FFFFFF
Text Secondary:    #A1A1B5
Text Muted:        #555568
Success:           #22C55E
Error:             #EF4444
Warning:           #F5B800   → mesmo gold
Info:              #7C3AED   → mesmo purple
```

### Tipografia

- **Font Family:** `Inter` (ou `Plus Jakarta Sans` como fallback)
- **Display / KPI numbers:** `font-black`, tamanho grande (2xl–4xl), `font-variant-numeric: tabular-nums`
- **Headings:** `font-bold`, tracking normal
- **Labels / badges:** `uppercase`, `font-semibold`, `text-xs`, `letter-spacing: 0.08em`
- **Body:** `font-normal`, `text-sm`

### Linguagem de Design

- **Dark-first**: fundos escuros, texto claro. ZERO tema claro.
- **Accent lines**: linhas diagonais ou stripes finas em gold/purple (como no carro e na mochila do brand book) usadas como detalhe em cards de destaque.
- **Cards**: `bg-surface`, `border border-border`, `rounded-xl`. KPI cards têm `border-t-2 border-gold`.
- **Botões primários**: `bg-gold text-black font-bold` — amarelo com texto preto, alto contraste, on-brand.
- **Botões secundários**: `bg-purple text-white font-semibold`.
- **Botões destrutivos**: `bg-transparent text-red-400 border border-red-500/30 hover:bg-red-500/10`.
- **Badges de status**: pill pequeno, cor de fundo 15% opacidade + texto sólido. Ex: APPROVED = `bg-green-500/15 text-green-400`.
- **Glow sutil**: em saldo principal e botão CTA: `box-shadow: 0 0 24px rgba(245,184,0,0.12)`.
- **Sem gradientes coloridos aleatórios** — só onde a marca naturalmente os usa.
- **Ícones**: lucide-icons (já em uso). 16px em texto, 20px standalone.

---

## Design System — Tokens Globais

```css
/* assets/css/main.css */
:root {
  --color-gold: #F5B800;
  --color-purple: #7C3AED;
  --color-bg: #0A0A0E;
  --color-surface: #111115;
  --color-surface-elevated: #1A1A20;
  --color-border: #252530;
  --color-text: #FFFFFF;
  --color-text-secondary: #A1A1B5;
  --color-text-muted: #555568;
}
```

---

## Layout Global

### Sidebar (ambos os painéis)

- Largura: `w-64` desktop, drawer no mobile
- Background: `bg-[var(--color-surface)] border-r border-[var(--color-border)]`
- Logo no topo: "Valle" em gold + "X" em purple + "GROUP" em muted
- Nav items:
  - Padrão: `text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-surface-elevated)]`
  - Ativo: `text-[var(--color-gold)] bg-[var(--color-surface-elevated)] border-l-2 border-[var(--color-gold)]`
  - Estrutura: ícone (20px) + label, gap-3, padding `px-4 py-2.5`
- Footer: avatar (iniciais, bg-purple) + nome + role badge

### Header (barra superior)
- `h-14 bg-[var(--color-surface)] border-b border-[var(--color-border)]`
- Esquerda: título da página (`font-semibold text-white`)
- Direita: seletor de casa + ícone notificações (badge gold quando há novas) + avatar

---

## FRONTEND — Painel do Afiliado

### Princípios UX

1. Afiliado vê em 3 segundos: saldo disponível, ganho do mês, pendências.
2. Toda métrica tem: label descritivo acima, valor grande, variação vs período anterior abaixo.
3. Tudo filtrável por casa de apostas (filtro global no header).
4. Mobile-first: afiliados acessam majoritariamente por celular.

---

### `pages/index.vue` — Dashboard Principal

**4 KPI cards no topo** (2×2 mobile, 4×1 desktop):

```
┌─────────────────────────┐  ┌─────────────────────────┐
│ i  SALDO DISPONÍVEL     │  │ i  GANHOS DO MÊS        │
│                         │  │                         │
│  R$ 12.450,00           │  │  R$ 8.230,00            │
│  ↑ +8,3% vs mês ant.   │  │  CPA + RevShare         │
└─────────────────────────┘  └─────────────────────────┘
┌─────────────────────────┐  ┌─────────────────────────┐
│ i  FTDs DO MÊS          │  │ i  CLIQUES DO MÊS       │
│                         │  │                         │
│  23                     │  │  1.847                  │
│  ↑ +3 vs mês anterior  │  │  ↓ -12% vs mês ant.    │
└─────────────────────────┘  └─────────────────────────┘
```

Card do Saldo: borda top gold + glow sutil. Botão "Solicitar Saque" inline abaixo do valor.

**Card de Saldo destacado** (abaixo dos KPIs):
- Valor: `text-4xl font-black text-[var(--color-gold)]`
- Status: LIBERADO (green badge) ou BLOQUEADO (red badge)
- Botão "Solicitar Saque": `bg-gold text-black font-bold w-full rounded-lg py-3`
- Últimos 3 saques: lista compacta (status + valor + data)

**Gráfico de Performance** (line chart, 30 dias):
- Linha gold = CPA, linha purple = RevShare
- Fundo: `bg-surface`, grid: `border-border/40`
- Tooltip escuro com dados do dia

**Breakdown por Casa**:
- Lista: logo + nome da casa | CPA R$ | RevShare R$ | FTDs | barra de proporção gold
- Ordenado por maior ganho

---

### `pages/earnings.vue` — Ganhos Detalhados

**Filtros inline no topo:**
- Período: Hoje | Esta semana | Este mês | Mês passado | Todo o tempo
- Casa: dropdown (sincronizado com filtro global)

**Tabs:**
1. **Resumo** — 4 KPI cards: CPA Total, RevShare Total, FTDs, Registros
2. **Por Casa** — tabela: Casa | Campanha | Cliques | Registros | FTDs | CPA R$ | RevShare R$ | Total R$
3. **Minha Rede** — indicados com comissão gerada

**Tabela:**
- Header: `bg-surface-elevated text-text-muted text-xs uppercase tracking-wider`
- Hover: `hover:bg-surface-elevated/50 transition-colors duration-150`
- Números: `font-mono text-right`
- Totais no rodapé: `font-bold`
- Loading: skeleton de linhas (não spinner)
- Empty: ícone + "Nenhum dado para o período selecionado"

---

### `pages/payments.vue` — Saques e Pagamentos

**Layout 2 colunas desktop** (tabela 2/3 | resumo + ação 1/3):

**Tabela de Saques:**
- Colunas: Data | Casa | Valor | Método | Status
- Status badges:
  - PENDENTE: `bg-amber-500/15 text-amber-400`
  - APROVADO: `bg-blue-500/15 text-blue-400`
  - PAGO: `bg-green-500/15 text-green-400`
  - REJEITADO: `bg-red-500/15 text-red-400`
- Expandir linha: motivo de rejeição, dados de pagamento

**Card "Solicitar Saque" (coluna direita):**
- Saldo disponível em destaque (text-gold text-3xl font-black)
- Input valor com máscara R$
- Seletor de método (PIX / TED)
- Botão CTA gold
- Aviso de prazo ("Processado em até 3 dias úteis")

---

### `pages/links.vue` — Meus Links

**Tabs:**
1. **Links Ativos** — cards por casa
2. **Solicitar Link** — form
3. **Deals** — cards de CPA/RevShare especial

**Card de Link Ativo:**
```
┌─ [LOGO]  Nome da Casa              [● ATIVO] ──┐
│  https://t.vallex.com/xyz123   [Copiar ⧉]       │
│  ───────────────────────────────────────────     │
│  1.234 cliques  ·  45 registros  ·  12 FTDs     │
│                               [Ver relatório →]  │
└──────────────────────────────────────────────────┘
```

**Solicitar Link:** seletor de casa com logos, campo campanha opcional, botão gold.

---

### `pages/affiliates.vue` — Minha Rede

- Card de resumo topo: total indicados | ativos | comissão da rede (texto gold)
- Lista de indicados: avatar iniciais (bg-purple) + nome/email + status + casas (HouseBadges) + comissão gerada
- Expandir indicado → sub-rede (1 nível)

---

### `pages/ranking.vue` — Ranking

- Pódio visual: 1º (gold), 2º (silver), 3º (bronze) em destaque
- Tabela restante: posição | afiliado | pontuação | premiação
- Posição do usuário logado: linha destacada com borda gold

---

### `pages/notifications.vue` — Notificações

- Lista cronológica: ícone + tipo + mensagem + data
- Não lidas: dot gold à esquerda + `bg-surface-elevated`
- Botão "Marcar todas como lidas"

---

### `pages/settings.vue` — Configurações do Afiliado

- Seções: Dados Pessoais | Segurança | Notificações
- Formulários dark estilizados
- Botão "Salvar" por seção (não global)

---

### `pages/deals.vue` — Deals

- Cards de deals: casa + tipo + validade + status
- Botão "Solicitar" → modal de confirmação

---

### `pages/auth/register.vue` — Cadastro

- Layout split: esquerda dark com branding (logo grande, tagline "Sua rede. Sua performance."), direita form
- Campos: Nome, E-mail, Senha, Confirmar Senha, Código de indicação (opcional)
- Botão: `bg-gold text-black font-bold w-full py-3 rounded-lg`
- Link "Já tenho conta → Entrar"

### `pages/auth/login.vue` — Login

- Mesmo split layout
- Campos: E-mail + Senha
- Botão gold + link "Esqueci minha senha"

### `pages/auth/pending.vue` — Aguardando Aprovação

- Sem sidebar, tela centralizada
- Ícone relógio (64px, color gold)
- Título "Cadastro em análise"
- Sub: "Nossa equipe está revisando seu cadastro. Você receberá um e-mail assim que aprovado."
- Botão "Sair" outline

---

## ADMIN — Painel Administrativo

### Princípios UX

1. Tabelas são o centro — filtros rápidos e ações inline economizam tempo.
2. Dados financeiros sempre com sinal e cor. Status sempre com badge.
3. Ações destrutivas sempre com modal de confirmação.
4. Densidade controlada: linhas de 48px (tap target adequado).

---

### `pages/index.vue` — Dashboard Admin

**5 KPI cards (linha superior):**
- Afiliados Ativos
- Pendentes de Aprovação (badge alerta se > 0, borda red)
- Volume Saques Pendentes (R$)
- FTDs do Mês (rede toda)
- Ganho Bruto da Rede no Mês

**Painel de Alertas:**
- Cards de urgência: saques pendentes há +48h | link requests sem resposta | afiliados com saldo bloqueado
- Cada alert → link direto para seção

**Gráfico:** linha: afiliados ativos vs FTDs vs volume saques, 30 dias

---

### `pages/affiliates/index.vue` — Gestão de Afiliados

**Filtros (barra compacta):**
- Input busca nome/e-mail (debounce 350ms)
- Select status: Todos | Pendente | Aprovado | Rejeitado | Bloqueado
- Select casa

**Tabela:**

| Afiliado | Status | Indicador | Casas | Entrada | Ações |

- **Afiliado**: `font-bold text-white` + `text-xs text-muted` email
- **Status**: StatusBadge
- **Casas**: HouseBadges (máx 2 visíveis + "+N")
- **Ações** (só ícones com tooltip hover):
  - PENDING: ✓ (green, Aprovar) + ✗ (red, Rejeitar)
  - APPROVED: 👁 (primary, Ver Painel — só se APPROVED)
  - Todos: 🔒 (warning, Bloquear Saldo) + ⋯ (mais opções)

**Modal Aprovar:** nome/email do afiliado + select casa + inputs CPA/RevShare + preview do acordo + botão "Confirmar Aprovação"

**Rodapé:** "Mostrando X–Y de Z afiliados" + paginação numérica

---

### `pages/affiliates/[id].vue` — Espelho do Painel

- Banner topo: `bg-purple/15 border border-purple/30 rounded-lg` com "Visualizando painel de **Nome** (email)" + botão "← Voltar"
- Conteúdo: espelho exato do dashboard do afiliado, modo leitura (ações desabilitadas)

---

### `pages/links.vue` — Gestão de Links (Admin)

**Tabs:**
1. **Link Requests**: Afiliado | Casa | Status | Data | Ações (Aprovar/Rejeitar)
2. **Deal Requests**: Afiliado | Casa | CPA req | RevShare req | Status | Ações

Expandir linha = detalhes completos. Ações inline com confirmação para rejeitar.

---

### `pages/withdrawals.vue` — Saques (Admin)

**Filtros:** Status | Casa | Período

**Tabela:**
| Afiliado | Casa | Valor | Método | Solicitado em | Status | Ações |

- Valor: `font-mono text-right`
- Ações: Aprovar (green) | Rejeitar (red, com modal motivo) | Marcar Pago (blue)
- Expandir: dados PIX/bancários + histórico de saques do afiliado

**Rodapé sticky:** Pendente: R$ X | Aprovado: R$ Y | Pago (mês): R$ Z

---

### `pages/houses.vue` — Casas de Apostas

**Grid 3 colunas desktop:**

```
┌─────────────────────────────────────────────────┐
│  [LOGO]  Superbet               [● ATIVA]       │
│  slug: superbet                                  │
│  ─────────────────────────────────────────────  │
│  12 afiliados   ·   R$ 45.000 vol./mês          │
│  [Editar ✎]                    [Desativar ○]    │
└──────────────────────────────────────────────────┘
```

Botão "Nova Casa" (gold) no topo → modal: nome, slug, logo URL, URL base.

---

### `pages/prizes.vue` — Prêmios e Ranking

- Tabela: Posição | Prêmio | Tipo | Período | Ações (editar inline)
- Botão "+ Adicionar Prêmio" gold

---

### `pages/settings.vue` — Configurações do Sistema

**Seções (cards separados):**
1. Geral: nome plataforma, logo, e-mail suporte
2. Comissões Padrão: CPA/RevShare por casa
3. Saques: valor mínimo, prazo, métodos
4. Notificações: templates por evento
5. Integrações: chaves API por casa

Cada card tem botão "Salvar" próprio no rodapé.

---

### `pages/audit.vue` — Log de Auditoria

- Tabela: Data/hora | Usuário | Ação | Entidade | Detalhes
- Expandir linha: diff JSON (before/after) em `font-mono bg-surface-elevated rounded p-3`
- Filtro por usuário e tipo de ação
- 100 por página

---

### `pages/sync.vue` — Sincronização

- Status por casa: dot verde (OK) / vermelho (erro) + última sync há X min
- Botão "Sync Agora" por casa + "Sync Tudo" (gold)
- Log recente: `font-mono text-xs bg-surface-elevated rounded p-4 max-h-64 overflow-y-auto`
- Spinner + botão "Cancelar" durante sync ativa

---

### `pages/notifications.vue` — Notificações (Admin)

- Form broadcast: título + body + segmento (todos / por casa / afiliado específico)
- Histórico de broadcasts: data | segmento | título | destinatários
- Contador assinaturas push ativas por casa

---

## Componentes Compartilhados

### `KpiCard.vue`
Props: `label`, `value`, `trend?`, `trendLabel?`, `icon`, `accentColor?: 'gold' | 'purple' | 'green' | 'red'`
- Borda top 2px na cor do accent
- Glow sutil se accentColor === 'gold'

### `StatusBadge.vue`
Mapeamento fixo de status → cor:
- APPROVED / ATIVO / PAGO → green
- PENDING / AGUARDANDO / EM_ANALISE → amber
- REJECTED / BLOQUEADO → red
- PROCESSANDO / APROVADO (saque) → blue

### `HouseBadge.vue`
- Pill dark: `bg-surface-elevated border border-border rounded-full px-2 py-0.5`
- Logo 16px + nome `text-xs`

### `DataTable.vue` (wrapper)
- Header sticky
- Hover `transition-colors duration-150`
- Loading: linhas skeleton (não spinner)
- Empty: ícone (48px) + mensagem contextual

---

## Regras Absolutas

1. **Nunca** cores hardcoded no template — sempre CSS variables ou Tailwind configurado
2. **Nunca** `bg-blue-500` para ação primária — sempre `bg-[var(--color-gold)] text-black`
3. **Nunca** tabela sem skeleton de loading e estado vazio com mensagem
4. **Sempre** números financeiros: `font-mono`, alinhados à direita
5. **Sempre** datas em pt-BR (`dd/mm/yyyy`)
6. **Sempre** valores monetários via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`
7. **Sempre** rota ativa na sidebar: `border-l-2 border-gold bg-surface-elevated text-gold`
8. **Mobile**: sidebar vira bottom nav com 5 ícones (frontend) ou drawer (admin)
9. **Sem animações pesadas** — só `transition-colors duration-150` e `transition-opacity`
10. **Dark mode only** — sem toggle de tema

---

## Ordem de Implementação

1. `assets/css/main.css` + `app.config.ts` — tokens base
2. `layouts/default.vue` frontend e admin — sidebar + header
3. Componentes: `KpiCard`, `StatusBadge`, `DataTable`
4. Frontend: `index` → `earnings` → `payments` → `links` → `affiliates` → `ranking` → resto
5. Admin: `index` → `affiliates/index` → `withdrawals` → `links` → `houses` → resto

---

## Referência de Mood

**Binance meets sports betting.** Dark denso, confiável, premium mas com energia. Gold como ação principal. Purple como marca. Preto profundo como base. Cada número mostrado tem implicação financeira real — design respeita isso com clareza absoluta, zero ambiguidade.
