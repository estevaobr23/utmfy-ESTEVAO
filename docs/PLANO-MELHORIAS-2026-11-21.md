# Plano de melhorias da UTMFY — 21/11/2026

> Só planejamento: nada foi alterado no código, no banco nem na Vercel. Material do concorrente (CashFlow) é **só estudo**.
> Prints do concorrente: `chasflow-concorrente-prints/NN-<tema>.png` (raiz do repo; é a mesma pasta que
> `Claude code capt cutr\UTMFY\...`, que é um atalho/junction para este repo). O caminho pedido
> (`chasflow-concorrente utmfy\prints\`) não pôde ser usado porque `chasflow-concorrente utmfy` é um **arquivo** (a transcrição).
> Os prints (17 MB) **não devem ir para o git**: adicionar `chasflow-concorrente*` ao `.gitignore` na próxima edição.
> Como os prints foram feitos: o navegador do VS Code não toca YouTube (o Electron não tem decodificador AAC no MediaSource:
> "Não é possível tocar este vídeo"), então o vídeo foi baixado só com a imagem (yt-dlp, para a pasta temporária) e os quadros
> foram extraídos com ffmpeg nos tempos da transcrição.

---

## 1. Bugs

### 1.1 (PRINCIPAL) Ao reabrir a UTMFY, a oferta escolhida volta para "Todas as ofertas" — esforço **P**

**Reproduzido em produção (21/11, navegador do VS Code):** abrir `/ofertas/<id>/resumo` → o cookie `utmfy_offer=<id>` é gravado
(30 dias, `path=/`) → abrir `https://utmfy-tracker.vercel.app/` → a página mostra "Todas as ofertas · consolidado" **e o cookie some**.

**Causa raiz (não é cookie de sessão nem path):** o cookie está certo (`max-age=2592000; path=/`, `src/components/sidebar.tsx:46-48`).
O problema é a regra de navegação:
1. Quem reabre o painel entra pela **raiz `/`** (favorito, digitando o endereço, ou depois do login: `src/app/login/actions.ts:12`
   faz `redirect("/")`; o `proxy.ts:30-35` manda para `/login` apagando o caminho de destino).
2. A raiz `/` (`src/app/(app)/page.tsx`) **sempre** renderiza o consolidado; ela não lê o cookie.
3. `resolveSelectedOffer` (`src/lib/core/offer-navigation.ts:73-77`) só usa a oferta lembrada em telas de **Administração**;
   em `/`, `/campanhas`, `/pedidos`, `/ofertas` devolve `null` **de propósito**.
4. Com `null`, o `useEffect` do `useOfferContext` (`sidebar.tsx:44-50`) grava `utmfy_offer=; max-age=0` → **apaga a lembrança**.
   Ou seja: abrir a raiz é tratado como se o usuário tivesse escolhido "Todas as ofertas".

O cookie hoje só serve para não perder a oferta ao passear pela Administração; nunca para "abrir onde parei".

**Correção proposta (exata):**
- `src/app/(app)/page.tsx`: antes de renderizar, ler `cookies().get(OFFER_COOKIE)`; se existir, **validar** que a oferta é do
  workspace atual e não está arquivada (`offers.select("id").eq("id", saved).eq("workspace_id", ws.id).neq("status","archived")`)
  e, se o parâmetro `todas` **não** estiver na URL, `redirect(\`/ofertas/${saved}/resumo\`)` levando `preset/from/to` se vierem.
  (Validar no servidor evita laço: oferta apagada → `not-found` → link "Todas as ofertas" → `/` → redirect de novo.)
- Escolha explícita do consolidado passa a ser `/?todas=1`:
  - `sidebar.tsx:108` (`go("/")` e os `router.prefetch("/")`) → `"/?todas=1"`; antes do `router.push`, apagar o cookie na hora
    (`document.cookie = "utmfy_offer=; path=/; max-age=0"`), para não depender do `useEffect`.
  - `src/app/(app)/ofertas/not-found.tsx:10` → `href="/?todas=1"`.
  - Link "Resumo" do modo consolidado (`ALL_SECTIONS` em `sidebar.tsx:14`) continua `/`: nesse modo o cookie já está vazio.
- `offer-navigation.ts`: atualizar o comentário/JSDoc da regra ("abrir a raiz volta para a última oferta; só a escolha explícita
  limpa") e os testes em `tests/offer-navigation.test.ts` (+ teste do redirect da raiz com cookie válido / inválido / `todas=1`).
- Opcional (mesmo PR, P): login preservar o destino — `proxy.ts` grava `?next=<caminho>` ao mandar para `/login` e
  `signIn` faz `redirect(next seguro || "/")` (só caminhos internos começando com `/`).

Risco: baixo (só navegação). Teste: Playwright — escolher oferta, fechar contexto, abrir `/` → cai em `/ofertas/<id>/resumo`;
escolher "Todas as ofertas" → fica no consolidado e continua nele após reabrir.

### 1.2 Período (filtro de datas) se perde ao trocar de oferta ou de aba — esforço **P/M**
- Causa: o período vive só na query string. `offerSwitchHref` (`offer-navigation.ts:79-82`) descarta a query **por regra**
  ("nunca filtros da query string") e os links da lateral (`offerSectionLinks`, `ALL_SECTIONS`) também não levam `preset/from/to`.
  Resultado: está em "Este mês" na oferta A, troca para B (ou Resumo → Meta Ads) → volta para **Hoje**. Reabrir o navegador também
  volta para Hoje.
- Correção: manter só o período (não os demais filtros) entre telas: cookie `utmfy_period` (preset ou from/to, 30 dias) gravado quando
  o formulário de filtro é enviado; `parseFilters` usa o cookie quando a URL não traz período; links da lateral e `offerSwitchHref`
  passam a anexar `preset/from/to` atuais. Ajustar o teste de `offerSwitchHref`.

### 1.3 Seletor de período pode mostrar valor diferente do filtro aplicado — esforço **P**
- `src/components/period-control.tsx:19`: `useState(preset)` só lê a prop na montagem. Ao voltar com o botão "voltar" do navegador
  (ou outro filtro que mude a URL sem remontar), o select e os campos De/Até (`defaultValue`) ficam com o valor antigo.
- Correção: em `filters.tsx:25`, `key={\`${f.preset}|${f.from}|${f.to}\`}` no `<PeriodControl>` (remonta quando o filtro muda).

### 1.4 Workspace escolhido se perde ao fechar o navegador — esforço **P**
- `src/app/actions.ts:57` (`switchWorkspace`) e `:470` (`createDemo`) gravam `utmfy_ws` **sem `maxAge`** = cookie de sessão; ao
  fechar o navegador volta para o 1º workspace não-demo. Mesmo tipo de bug do 1.1 (só aparece com mais de um workspace).
  O de `createDemo` também está sem `secure`.
- Correção: `maxAge: 60*60*24*180` e `secure` em produção nos dois.

### 1.5 "Gerenciar ofertas" lento e pesado — esforço **M** (resolve junto com os cards, seção 3)
- `src/app/(app)/ofertas/page.tsx:15-20` chama `loadReport` **uma vez por oferta**; cada chamada faz ~9 consultas e
  `report_spend_rows` é pedido **para o workspace inteiro** (`p_offer_ids: null`) e recortado no TypeScript. Com 6 ofertas =
  ~54 consultas e 6× o gasto do workspace inteiro. Vai piorar a cada oferta nova (arquivadas também entram).
- Correção: carregar gasto/pedidos do período **uma vez** e recortar por oferta (mesma regra de escopo de `loadReport`), ou nova
  função `report_offer_cards` (seção 3.3).

### 1.6 Pequenos problemas visuais/funcionais na tela de ofertas — esforço **P**
- Status em inglês cru (`active`, `archived`, `paused`) — `ofertas/page.tsx:36`; o cabeçalho da oferta já traduz (`ativa/pausada/arquivada`).
- Ordem por nome mistura arquivadas no topo; ativas deveriam vir primeiro (e arquivadas recolhidas).
- Período fixo "7 dias" (`ofertas/page.tsx:14`), sem filtro de período nem ordenação.
- No celular a tabela corta a coluna ROAS (rolagem horizontal) — visto no print do painel em 21/11.
- Classes antigas do tema claro (`text-slate-900`, `text-sky-700`) dependem de remapeamento no `globals.css`; trocar pelos tokens.

### 1.7 Observação (não é bug, é decisão a confirmar)
- Com a correção 1.1, digitar o endereço da UTMFY passa a abrir a última oferta. O consolidado fica a 1 clique
  ("Todas as ofertas"). Confirmar com o usuário que é isso que ele quer (é o que ele descreveu).

---

## 2. Funções do concorrente (CashFlow) — o que é, se já temos, valor, esforço, prioridade

Valor = para quem vende infoproduto low ticket por Meta Ads, várias ofertas ao mesmo tempo, Cakto/Wiapy/Hotmart e CAPI própria.
Esforço: P (≤1 dia), M (2–4 dias), G (1+ semana). Prioridade: A (fazer já), B (próximo), C (depois/talvez).

| # | Função (print) | O que é | Já temos? | Valor | Esf. | Prio |
|---|---|---|---|---|---|---|
| 1 | **Cards de oferta com resultado** (`07-cards-de-ofertas`, `08-cards-ordenar`) | Grade de cards por oferta: lucro em destaque, faturamento, gasto, ROAS, margem, botões "Gestão" e "Tráfego"; abas Todas/Ativa/Pausa; busca; período; ordenar por lucro/faturamento/ROAS/investimento/prejuízo; alternar Cards/Lista | Não: hoje é tabela (`/ofertas`) com 7 dias fixos | **Muito alto** (é o pedido dele) | M | **A** |
| 2 | **Placar positivas × negativas** (`07`) | "5 de 7 ofertas positivas (71%)" / "2 de 7 negativas" com barra | Não | Alto: leitura do portfólio em 1 s | P | **A** |
| 3 | **Top 3 ofertas + distribuição de lucro** (`02-top3-ofertas-do-dia`, `04-evolucao-e-distribuicao-lucro`) | No Resumo consolidado: 3 ofertas que mais lucram hoje e duas colunas (positivas / negativas) com lucro, reembolso, imposto | Não (Resumo só soma) | Alto | M | **A** |
| 4 | **Sparkline nos KPIs** (`06-dashboard-mes-sparklines`) | Faturamento, investimento, lucro e ROAS com mini gráfico diário dentro do card | Parcial: temos gráfico por hora, não série diária nos cartões | Alto (com período > 1 dia) | M | **A** |
| 5 | **Taxa de rastreio por oferta** (`18-tracking-cards-por-oferta`, `20-tracking-taxa-de-rastreio`) | "432 de 435 vendas enviadas à Meta (99,3%)", lista de eventos enviados | Parcial: `capi-medir` (CLI), `conversion_dispatches`, Eventos e logs; falta o número por oferta na tela | **Muito alto** (CAPI é nosso diferencial; mostra se a oferta está "cega") | P/M | **A** |
| 6 | **Feed de vendas ao vivo** (`03-feed-vendas-ao-vivo`) | Lista do dia com hora, plataforma, status (aprovada/pendente), produto + bumps, gráfico de vendas por hora | Parcial: Pedidos + gráfico por hora; sem atualização automática | Médio/alto (acompanhar o dia) | M | B |
| 7 | **Análise avançada da oferta** (`11-analise-avancada-padrao`) | Maior receita/lucro/ROAS do período (com data), menor lucro/ROAS, sequência positiva (dias), média de investimento/lucro por dia | Não | Alto para decidir escala | M | B |
| 8 | **Performance por período** (`12-performance-por-periodo`) | Linhas diárias de faturamento, investimento, lucro + vendas e ROAS por dia (ver o que aconteceu ao subir/baixar verba) | Parcial (só por hora) | Alto | M | B |
| 9 | **Dias fortes e fracos** (`13-dias-fortes-e-fracos`) | Ranking por dia da semana (lucro/ROAS médio) | Não | Médio | P | B |
| 10 | **Registro diário de performance** (`14-registro-performance-diario`, `28-relatorio-diario`) | Tabela dia a dia (vendas, gasto, faturamento, lucro, ROAS, CPA, margem) | Parcial (Meta Ads por dia da conta) | Médio | P | B |
| 11 | **Vendas por produto / bumps** (`15-vendas-por-produto-bumps`) | Principal × básico/completo × bumps × upsell, com conversão de cada bump | **Sim** (Vendas por produto com selo de tipo) — falta "taxa de conversão do bump" | Médio | P | B |
| 12 | **Ranking + investimento por oferta** (`16-ranking-e-investimento-por-oferta`) | Rosca "% da verba por oferta" e ranking de lucro | Não | Alto (para onde vai o dinheiro) | P | **A** (junto dos cards) |
| 13 | **Comparação de ofertas / períodos** (`17-comparacao-de-ofertas`) | Lado A × lado B (mesma oferta em 2 períodos ou 2 ofertas): lucro, ROAS, margem, ticket, vencedor por métrica | Não | Médio/alto | M | B |
| 14 | **Criação guiada da oferta + checklist de tracking** (`09-nova-oferta-guiada`, `19-tracking-checklist-guiado`, `21-tracking-links-checkout`) | Passo a passo: pixel+token → script da página → links de checkout → UTMs → tirar pixel do checkout | Parcial: fazemos por prompt (`utmfy.mjs oferta-nova`); a tela só mostra integrações/tracking | Médio (para ele o prompt já resolve; útil como **checklist de verificação**) | M | C |
| 15 | **Auto-criar oferta na 1ª venda** (`09`) | Venda de produto sem oferta → cria o card sozinho | Parcial (`offer-auto-link` liga produto conhecido) | Baixo/médio (ele cria por prompt) | M | C |
| 16 | **"Ofertas em movimento" no tráfego** (`22-trafego-ofertas-em-movimento`, `23-trafego-resumo-da-oferta`) | Mini-cards por oferta (lucro + ROAS) acima do gerenciador; clicar filtra as campanhas da oferta | Parcial: Meta Ads por oferta existe; falta a faixa de mini-cards | Alto (troca rápida entre ofertas) | P (reusa o card) | **A**/B |
| 17 | **Padrão de métricas (semáforo)** (`24-padrao-de-metricas`) | Usuário define bom/médio/ruim para CPM, CPC, CTR, custo por IC, ROAS…; a tabela pinta as células | Não | Alto (decisão rápida no gerenciador) | M | B |
| 18 | **Anotações e histórico de alterações** (`25-anotacoes`, `26-historico-de-alteracoes`) | Notas por dia/oferta; lista de mudanças de orçamento com CPA/gasto antes×depois | Parcial: "Últ. atualização" + log `META_BUDGET_*`/`META_BID_UPDATED`; sem notas nem marcadores no gráfico | Médio/alto | M | B |
| 19 | **Comparar conjuntos / criativos lado a lado** (`27-comparar-conjuntos`) | Selecionar conjuntos/anúncios e ver comparativo; miniatura do criativo, dados de hook/body/CTA | Parcial (seleção + filtro; vídeo `meta_video_daily`) | Médio | M/G | C |
| 20 | **Gestão financeira / DRE** (`29-gestao-financeira`) | Lançamentos de entrada/saída, categorias, recorrência, DRE do mês | Parcial: `cost_rules` (outros custos/impostos) | Baixo/médio | G | C |
| 21 | **Integrações em catálogo** (`30-integracoes-plataformas`, `31-integracao-contas-anuncio`) | Grade de plataformas; contas de anúncio com imposto por conta | Temos Cakto/Hotmart/Wiapy + Meta; imposto por conta não | Baixo | P | C |
| 22 | **Editar layout do painel** (`05-editar-layout`) | Arrastar/ocultar blocos | **Sim** (modo edição) | — | — | — |
| 23 | **Barra de meta de faturamento** (topo dos prints, "R$ 123k / R$ 500k") | Progresso do mês rumo a uma meta | Não | Baixo/médio (motivacional) | P | C |
| 24 | **FAQ + assistente** (`32-faq-e-assistente`) | Perguntas frequentes e bot | Temos "Falar com o Claude" | Baixo | — | C |

**Top 5 que valem copiar já:** (1) cards de oferta com resultado + ordenação + placar positivas/negativas; (2) taxa de rastreio
CAPI por oferta no card; (3) sparklines diárias nos KPIs e nos cards; (4) "Top ofertas / distribuição de lucro / % da verba por
oferta" no Resumo consolidado; (5) análise avançada + performance por período da oferta (melhor/pior dia, sequência positiva).

---

## 3. Redesenho dos cards de oferta (Gerenciar ofertas)

### 3.1 Cabeçalho da tela
```
Gerenciar ofertas                                   [Este mês ▾]  [Ordenar: Maior lucro ▾]  [▦ Cards | ☰ Lista]
┌──────────────────────────────┐ ┌──────────────────────────────┐ ┌──────────────────────────────┐
│ ● OFERTAS POSITIVAS          │ │ ● OFERTAS NEGATIVAS          │ │ VERBA DO PERÍODO             │
│ 3 de 4              75%      │ │ 1 de 4              25%      │ │ R$ 1.240  ◔ 51% Plantas      │
│ ███████████████░░░░░         │ │ █████░░░░░░░░░░░░░░░         │ │           ◔ 30% Gatos ES …   │
└──────────────────────────────┘ └──────────────────────────────┘ └──────────────────────────────┘
[Ativas 2] [Pausadas 0] [Arquivadas 4] [Todas 6]        🔍 Buscar oferta…
```

### 3.2 Card (grade 3–4 colunas no PC, 1 coluna no celular)
```
┌──────────────────────────────────────────────────────┐
│ ● ATIVA   100 Suportes e Móveis p/ Plantas    BRL ⋯  │  ← status traduzido + moeda + menu (configurar, arquivar)
│ Wiapy · pixel 1234…  ·  2 campanhas ativas            │  ← plataforma(s) das vendas + nº campanhas ACTIVE
│                                                      │
│ LUCRO                                   ROAS 1,45×   │
│ R$ 1.025,57  ▲ 12% vs período anterior               │  ← verde/vermelho; seta comparando com o período anterior
│ ▁▂▃▂▅▆▅▇█▆  (lucro por dia, barras +/−)              │  ← sparkline diária (barra verde acima de 0, vermelha abaixo)
│                                                      │
│ Faturamento  R$ 5.724   Gasto  R$ 4.189   Margem 18% │
│ Vendas 61    CPA R$ 68,67   Ticket R$ 93,84          │
│                                                      │
│ Rastreio Meta ███████████░ 98% (60/61) · CAPI ligada │  ← verde ≥95%, âmbar 80–95, vermelho <80 / "CAPI desligada"
│ Gasto incompleto ⚠ (se o spendStatus não for confiável) │
│ [ Resumo ]  [ Meta Ads ]  [ Tracking ]               │
└──────────────────────────────────────────────────────┘
```
Regras: sem gasto confiável → lucro/ROAS/CPA = "—" com selo "gasto incompleto" (mesma regra de hoje). Oferta sem venda e sem gasto
no período → card compacto ("sem movimento"). Arquivadas recolhidas por padrão. Cores pelos tokens da paleta Grafite + Violeta
(lucro `#1fae5b`, prejuízo `#ef4444`, pendente `#f5a524`); sem azul. Sparkline em SVG próprio (como `hourly-charts.tsx`).
A **mesma peça em versão mini** (nome + lucro + ROAS) vira a faixa "Ofertas em movimento" no topo de Meta Ads consolidado (item 16).

### 3.3 Dados: o que já existe e o que falta
| Dado do card | Fonte hoje | Falta |
|---|---|---|
| Faturamento, gasto, lucro, ROAS, CPA, margem, vendas, ticket | `loadReport(...).summary` (RPCs `report_spend_rows`, `report_order_rows`, regra de escopo por oferta em TS) | Nada — só tirar o N+1 (bug 1.5) |
| Gasto confiável | `spendStatus.reliable` | — |
| Status, nome, moeda | `offers` | — |
| Pixel da oferta / CAPI ligada | `offer_pixels` + `pixels.server_tracking_enabled` | — |
| Taxa de rastreio (enviadas/vendas) | `conversion_dispatches` (status `sent` por `order_id`, evento Purchase) × `orders` pagos da oferta | Consulta agregada por oferta (sem migração; `select ... group by` via RPC ou 1 query + agrupamento em TS) |
| Plataforma | `orders.provider` (cakto/hotmart/wiapy) | Agrupar distinct por oferta |
| Campanhas ativas | `meta_campaigns.effective_status` + `offer_meta_bindings`/derivação por pixel | Contar ACTIVE dentro do escopo da oferta |
| **Série diária (sparkline)** | Não existe: os RPCs agregam o período inteiro, sem coluna de dia | **Migração nova**: `report_spend_rows_daily` (igual a `report_spend_rows` + `date`) para aplicar o MESMO recorte por oferta em TS; vendas por dia saem de `orders.paid_at` no fuso do workspace (sem migração) |
| Variação vs período anterior | Rodar o mesmo agregado no período anterior | Só código (dobra 1 consulta) |
| % da verba por oferta, positivas/negativas | Derivado dos cards | — |

Proposta de implementação: um loader único `loadOfferCards(sb, ws, filters)` que busca gasto (por dia) e pedidos do período **uma vez**,
aplica o escopo de cada oferta (reaproveitando `scopeOfferSpendRows*` e `mergeBindings`) e devolve os cards já com série diária.
Componentes novos: `components/offers/offer-card.tsx`, `offer-scoreboard.tsx`, `sparkline.tsx`.

---

## 4. Plano em fases

**Fase 1 — bugs + cards (≈ 1 semana)**
1. Bug 1.1 (oferta lembrada ao reabrir) + login com `next` + testes. P
2. Bugs 1.3 e 1.4 (seletor de período, cookie do workspace). P
3. Bug 1.2 (período persiste entre ofertas/abas). P/M
4. Loader único + cards de oferta (seção 3) com placar, ordenação, abas de status, período e taxa de rastreio; lista como alternativa. M
5. Migração `report_spend_rows_daily` para as sparklines (**exige aprovação do usuário**; só schema `utmfy`). Se não aprovada,
   o card sai sem sparkline de gasto/lucro (só vendas por dia) e a sparkline entra depois.

**Fase 2 — Resumo consolidado e tráfego (≈ 1 semana)**
- KPIs com sparkline diária (períodos > 1 dia), Top 3 ofertas, distribuição de lucro (positivas × negativas), rosca de verba por oferta.
- Faixa "Ofertas em movimento" (mini-cards) no topo de Meta Ads consolidado.
- Feed de vendas do dia com atualização automática (polling leve a cada 60 s ou Supabase Realtime no schema `utmfy`).

**Fase 3 — análise da oferta (≈ 1 semana)**
- Análise avançada (melhor/pior dia, sequência positiva, médias diárias), performance por período (linhas diárias), dias fortes e
  fracos, registro diário; taxa de conversão dos bumps.

**Fase 4 — decisão de tráfego (≈ 1–2 semanas)**
- Padrão de métricas (semáforo) por workspace (tabela nova `metric_thresholds`), anotações por oferta/dia (tabela nova) e marcadores
  das mudanças de orçamento/lance no gráfico; comparação de ofertas/períodos.

**Fase 5 — talvez**
- Checklist visual de tracking por oferta (espelho do `utmfy.mjs verificar`), meta de faturamento, gestão financeira/DRE, central de criativos.

### Riscos
- **Produção:** push em `main` = deploy imediato. Fazer cada fase em commits pequenos, `typecheck/lint/test` antes e conferir a tela com
  Playwright (`npm run dev`, porta 3200) antes do push; confirmar deploy **Ready**.
- **Migrações:** banco compartilhado com outro app — só schema `utmfy`, `create or replace`/`if not exists`, sem mexer em funções que a
  CAPI ou os webhooks usam; aprovação explícita antes de aplicar. Novas tabelas (Fase 4) com RLS por workspace.
- **CAPI:** as telas novas só **leem** `conversion_dispatches`; nada de reenvio nem evento de teste no pixel de produção. A taxa de rastreio
  precisa contar só `Purchase` e só pedidos pagos da oferta (bumps não geram Purchase separado — conferir antes de mostrar % < 100%).
  Wiapy: a UTMFY já tem receptor (`/api/webhooks/wiapy`); conferir se as vendas Wiapy entram em `conversion_dispatches` antes de exibir a taxa.
- **Desempenho:** cards e Resumo consolidado não podem voltar ao N+1; meta: ≤ 6 consultas para a tela de ofertas inteira.
- **Fuso/gasto:** sparkline de gasto por dia usa o dia da conta (Nova York) se vier do diário; deixar claro no tooltip ou usar o por hora
  quando cobrir o período (mesma regra do `withAlignedSpend`).
- **Redirect da raiz:** validar a oferta no servidor para não criar laço com o `not-found`.

### Observação de teste feito
Para reproduzir o bug 1.1 foi aberto o painel no navegador do VS Code; a última visita foi à raiz `/`, o que **limpou** a oferta lembrada
naquele navegador (efeito do próprio bug). Nada mais foi alterado.
