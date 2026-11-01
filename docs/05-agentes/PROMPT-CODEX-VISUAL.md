# PROMPT PARA O GPT CODEX — Reconstrução VISUAL do UTMFY (cores, proporções, densidade e animações)

> Cole este arquivo inteiro no Codex e **anexe junto a imagem de referência** (print do painel da UTMify original, tela "Resumo", 1919×993). Todas as medidas abaixo foram **tiradas pixel a pixel dessa imagem**; onde digo "medido" é o valor real, onde digo "sugerido" não aparece na imagem e é decisão de design coerente com o resto.

---

## 0. Missão em uma frase

Fazer o painel do UTMFY **parecer a UTMify original**: mesma paleta, cartões maiores e mais densos, sem bordas/sombras pesadas, espaçamentos e raios iguais, funil com o mesmo degradê, e animações sutis. **Só visual. Nenhuma linha de lógica, dado, texto ou rota muda.**

## 1. Regras inegociáveis

1. **Somente aparência**: classes Tailwind, CSS (`globals.css`), `style` inline, markup puramente estrutural (wrappers `div`/`span`, SVG de ícone) e animações CSS.
2. **NÃO mexer em**: `src/lib/**`, `src/app/actions.ts`, `src/app/api/**`, `supabase/**`, queries, métricas, cálculo de ROAS/ROI/lucro, props e tipos dos componentes, rotas, nomes de campos de formulário, `tests/**` (exceto se um teste de *snapshot de classe* quebrar — aí ajuste só o seletor e explique).
3. **Não alterar nenhum texto exibido** (labels, hints, mensagens, "Atualizado agora"…). Pode mudar tipografia, cor, tamanho, peso e posição.
4. **Sem dependências novas** (nada de framer-motion, MUI, shadcn, lucide, chart libs). Ícones = SVG inline. Animações = CSS puro.
5. **Next.js 16.3 + React 19 + Tailwind v4**: este Next tem mudanças de API. Antes de escrever código, leia o guia relevante em `node_modules/next/dist/docs/`. Tailwind v4 usa `@import "tailwindcss"` + `@theme` no CSS (não há `tailwind.config.js`).
6. **Comportamentos recentes que devem continuar funcionando idênticos** (só recolora): botão **Atualizar** (`refresh-button.tsx`, estados idle/starting/running), tabela Meta Ads com **colunas redimensionáveis por arrasto** (`meta-table.tsx`), **modal de orçamento** (`budget-editor.tsx`, renderizado via portal), info "orçamento X → Y" na coluna **Últ. atualização**, e **ROAS/ROI verde/vermelho** na tabela.
7. Trabalhe numa **branch** (`visual/utmify-original`). **Não dê push na `main`** (push na main = deploy em produção). Entregue commits pequenos e por área.
8. Antes de entregar: `npm run typecheck && npm test` devem passar. (`npm run lint` já tem 2 erros antigos em `src/lib/supabase/types.ts` — não são seus, não "corrija".)

---

## 2. Referência medida (UTMify original, tela Resumo, 1919×993 a 100%)

### 2.1 Paleta (tokens)

| Token | Valor | Origem | Uso |
|---|---|---|---|
| `--app-bg` | **`#161d31`** | medido | fundo da página (entre os cartões) e do cabeçalho do grupo "CONTA" na sidebar |
| `--surface` | **`#283046`** | medido | **TODO** cartão: header, bloco Resumo, KPIs, funil, sidebar, selects |
| `--text` | **`#d0d2d6`** | medido | texto padrão e labels (a UTMify não usa branco puro em label) |
| `--text-strong` | `#ffffff` | sugerido | títulos e valores neutros |
| `--primary` | **`#005ae3`** | medido (botão Atualizar) | botões, links, foco |
| `--primary-active` | **`#0356d7`** | medido (item ativo da sidebar) | item de menu ativo |
| `--danger` | **`#ee4542`** | medido (ROAS/ROI/Lucro negativos) | texto, ícone "i" e label do KPI em estado ruim |
| `--success` | `#28c76f` | sugerido | KPI em estado bom, ROAS/ROI/Lucro positivos |
| `--warning` | `#ff9f43` | sugerido | pendentes/atenção |
| `--input-border` | **`#404656`** | medido | borda 1px dos selects/inputs (fundo transparente = cor do cartão) |
| `--divider` | `#3b4253` | sugerido | linha fina dentro do bloco Resumo (acima dos filtros) |
| `--surface-hover` | `#2f3850` | sugerido | hover de linha/cartão |
| `--muted` | `#a3a6b4` | sugerido | hints, subtítulos |

**Diferenças a corrigir no nosso app** (hoje): fundo `#11192d` (mais escuro e azulado → trocar por `#161d31`), cartão `#27334d` com **borda `#384662` + sombra** (trocar por `#283046`, **sem borda e sem sombra**), sidebar `#222d46` com `border-r` (trocar por cartão `#283046` flutuante), azul `#0874f9` (→ `#005ae3`), vermelho `#ff5b6b` (→ `#ee4542`).

### 2.2 Geometria (px)

| Elemento | Medida |
|---|---|
| Sidebar | **234 px** de largura, vive como **cartão flutuante** (raio ~6px) a 10 px do topo/esquerda; gutter de **26 px** até o conteúdo |
| Cabeçalho da página ("Dashboard – CONTA 01 EUA") | cartão, **57 px** de altura, raio 6 px, título ~19 px semibold |
| Espaço cabeçalho → bloco Resumo | **26 px** |
| Bloco "Resumo" | cartão **~158 px**: linha de título (Resumo 17–18 px bold + "Atualizado agora mesmo" + botão) → divisor → linha de filtros |
| Espaço Resumo → KPIs | **23 px** |
| **Cartão KPI** | **85 px de altura**, raio **6 px**, **padding 20 px**, **sem borda, sem sombra** |
| Gap horizontal e vertical entre KPIs | **19 px** |
| Espaço KPIs → Funil | **19 px** |
| Botão **Atualizar** | **126 × 34 px**, fundo `--primary`, raio 4 px, texto 14 px semibold branco |
| Selects de filtro | **34 px** de altura, borda 1px `--input-border`, raio 4 px, fundo transparente, seta à direita; label 11 px acima |
| Item de menu da sidebar | passo vertical **38 px**, pílula ativa **172×38** com raio 5 px e fundo `--primary-active`; ícone 16–18 px + texto 14 px `--text` |
| Grupo "CONTA 01 E…" | faixa com fundo `--app-bg` (`#161d31`), raio 5 px, chevron à direita |

### 2.3 Grade dos KPIs — **uma única grade de 4 colunas com larguras diferentes**

Larguras medidas: **526 / 389 / 254 / 390 px** (gap 19) ⇒ proporção **1,35 : 1 : 0,65 : 1**.

```css
.kpi-grid { display:grid; gap:19px; grid-template-columns: minmax(0,1.35fr) minmax(0,1fr) minmax(0,.65fr) minmax(0,1fr); }
```

| | col 1 | col 2 | col 3 | col 4 |
|---|---|---|---|---|
| Linha 1 | Faturamento líquido | Gastos com anúncios | ROAS | Lucro |
| Linha 2 | CPA | Vendas pendentes | ROI | ARPU |
| Linha 3 | *(vazia)* | Vendas reembolsadas | Margem | Taxas |

Hoje `report.tsx` (`KpiGrid`) usa 3 grades separadas (4/4/3 colunas iguais). **Unifique numa só** e deixe a linha 3 começando na coluna 2 (`col-start-2` no primeiro cartão). Abaixo de `1280px`: 2 colunas; abaixo de `768px`: 1 coluna.

### 2.4 Anatomia do cartão KPI (medido)

- Padding **20 px** em todos os lados; altura **85 px** (sem hint). Label no topo, valor embaixo, ícone "i" no canto superior direito a 20 px da borda.
- **Label**: ~12,5 px, **semibold**, cor `--text` (`#d0d2d6`), **sem** `uppercase` agressivo (hoje usamos `uppercase tracking-wide 11px` — remover; capitalização normal "Faturamento Líquido").
- **Valor**: **~24 px**, **bold**, `--text-strong`, `tabular-nums`, 10 px abaixo do label.
- **Ícone "i"**: círculo de 12–13 px, borda 1 px, na **mesma cor do tom do cartão** (neutro `--text`, ruim `--danger`, bom `--success`).
- **Tom colore label + valor + ícone juntos** (na referência, ROAS 0,00 / ROI 0,00 / Lucro −53,38 ficam vermelhos por inteiro: título, número e ícone). O fundo do cartão **nunca muda de cor**.
- **Hint** (texto pequeno abaixo do valor, ex.: "líquido − gasto − custos"): a referência não mostra hint; **nós mantemos** (não podemos tirar texto). Renderize em **11,5 px**, `--muted`, 4 px abaixo do valor; cartão com hint usa `min-height: 100px`. O `definition` continua no tooltip do "i".
- Tooltip do "i": fundo `#1b2236`, borda 1px `#3b4253`, raio 6 px, 12 px, `--text`, sombra suave (único lugar onde sombra é permitida).

Regra de tom (já existe na lógica — **não alterar a lógica**, só as cores): bom = `--success`, ruim = `--danger`, atenção = `--warning`, neutro = `--text-strong`.

### 2.5 Funil de conversão (medido)

- Cartão `--surface`, altura total ~395 px; título "Funil de Conversão (Meta Ads)" ~15–16 px semibold branco + "i" à direita.
- Faixa com **248 px** de altura (hoje `H = 250`, ok), **degradê horizontal contínuo** (trocar `COLORS` em `conversion-funnel.tsx`, mantendo `funnelPath/funnelRatios` intactos). Paradas medidas ao longo da largura:

| posição | cor |
|---|---|
| 0 % | `#0259e2` |
| 14 % | `#1953d3` |
| 33 % | `#3d4bbe` |
| 52 % | `#6142a9` |
| 65 % | `#5e387f` |
| 77 % | `#6e3576` |
| 100 % | `#8a2d65` |

(azul vivo → índigo → roxo → vinho; **sem o magenta saturado atual** `#cf347d`)
- Divisórias verticais: **1 px sólido `#9896dc`** de ponta a ponta (hoje `border-[#7c6fe0]/40` — mais clara/visível).
- Porcentagens dentro da faixa: **17–18 px bold branco**. Títulos das etapas: ~15 px bold branco no topo. Valores absolutos embaixo: 14 px semibold branco.
- Cartão sem borda nem sombra.

### 2.6 Sidebar

Estrutura: logo no topo → seletor de contexto (grupo escuro `--app-bg`) → itens com **ícone à esquerda** (SVG inline 18 px, traço 1.75, cor `--text`) → itens fixos no rodapé. Item ativo = pílula `--primary-active` com texto branco, **sem glow** (hoje há `shadow-[0_0_18px…]` — remover). Hover = `--surface-hover`. Texto 14 px, passo 38 px. O botão "Trocar workspace", e-mail e "Sair" ficam no rodapé em `--text`/`--muted`, sem bloco de cor diferente (hoje `#1d2840` — usar `--app-bg`).
Arquivo: `src/components/sidebar.tsx` (desktop `aside` na linha ~215 e `MobileNav`).

---

## 3. Mapa de trabalho (arquivo por arquivo)

1. **`src/app/globals.css`** — redefina os tokens de `:root` (§2.1) como **fonte única**. Mantenha o bloco "Compatibilidade dark" (`body .bg-white` etc.) mas aponte para os tokens novos. Adicione os `@keyframes` do §4 e `@media (prefers-reduced-motion: reduce)`.
2. **Caça aos hex soltos** — há ~22 arquivos com cores hard-coded. Rode `grep -rnE "#[0-9a-fA-F]{6}" src` e **substitua por tokens** (use `bg-[var(--surface)]` ou registre as cores em `@theme inline` e use `bg-surface`). Mapa de substituição (os mais frequentes hoje):
   - `#27334d`, `#27334d`-família (`#2d3a56`, `#34415e`, `#202b43`, `#222e47`, `#202c45`) → `--surface` / `--surface-hover` (apenas `#161d31` para áreas "afundadas")
   - `#11192d`, `#172137`, `#1b263d`, `#1d2840` → `--app-bg`
   - `#384662`, `#394761`, `#3a4762`, `#46546e`, `#4a5872`, `#34415d`, `#35435e` → **remover borda** de cartões; para bordas de input use `--input-border`; divisores internos `--divider`
   - `#0874f9`, `#1681ff`, `#0865d8`, `#54a8ff` → `--primary` (hover: escurecer 8 %); link claro `#5b9dff`
   - `#8f9bb1`, `#9aa6bb`, `#aab4c6`, `#aeb8c9`, `#7f8ca4`, `#8fa1bb`, `#cbd3df`, `#dce2ec`, `#e2e7ef`, `#d4dbe7` → `--text` ou `--muted` (simplifique: **só 3 tons de texto**: strong/text/muted)
   - `#25d17f` → `--success`; `#ff5b6b` → `--danger`; `#f5b942`, `#ffb347` → `--warning`
3. **`src/components/ui.tsx`** — `Kpi`, `Card`, `PageHeader`, `SectionTitle`, `Badge`, `inputCls`, botões: aplicar §2.4 (Kpi), cartão sem borda/sombra com raio 6 px, `PageHeader` = cartão 57 px. `Card`: cabeçalho interno separado por `--divider` de 1 px (sem `border-b` pesado), padding 20 px.
4. **`src/components/report.tsx`** (`KpiGrid`) — grade única §2.3; só classes/estrutura; **não mexer** em `roasTone`, valores, hints, `definition`.
5. **`src/components/dashboard.tsx`** — barra "Resumo" vira o **bloco §2.2**: linha de título (nome da seção à esquerda; "Atualizado …" + botão à direita), divisor, depois os filtros. (O `PeriodBadge`/texto de fuso/moeda existente permanece, em `--muted` 12 px.)
6. **`src/components/filters.tsx`** — `FilterBar`: labels 11 px `--text` (sem `uppercase`), selects/inputs 34 px com `--input-border` (arrumar `inputCls` em `ui.tsx`), botão "Filtrar" no padrão do botão primário (34 px), "Mais filtros" alinhado à direita com chevron.
7. **`src/components/refresh-button.tsx`** — **só estilo**: botão 34 px `--primary`; durante `busy` mostrar spinner CSS de 14 px à esquerda do texto existente; nota "Atualizado agora" em `--success`/`--warning` 12 px.
8. **`src/components/summary/conversion-funnel.tsx`** — §2.5.
9. **`src/components/summary/analytics-grid.tsx`** — `ChartCard` no mesmo cartão (sem borda/sombra, padding 20), `PALETTE` dos gráficos: `["#005ae3","#28c76f","#ff9f43","#7367f0","#ee4542","#00cfe8"]`; donut com buraco do mesmo `--surface`.
10. **`src/app/(app)/layout.tsx` + `sidebar.tsx`** — shell: `bg --app-bg`, sidebar flutuante 234 px com 10 px de margem e raio 6 px, `main` com padding 26 px; `MobileNav` com os mesmos tokens.
11. **Tabelas**: `src/components/meta/meta-table.tsx`, `src/components/meta-ads.tsx`, `src/components/orders.tsx`, `CampaignTree` em `report.tsx`: cabeçalho `--app-bg`/`#1f2740` com texto `--text` 12 px semibold (sem MAIÚSCULAS forçadas, exceto onde já é padrão), linhas 44–48 px de altura, hover `--surface-hover`, zebra desligada, divisores horizontais 1 px `--divider`, **sem bordas verticais** entre colunas. Preserve: handles de resize, sticky left/top, tooltips, cores ROAS/ROI (usar `--success`/`--danger`).
12. **`src/components/meta/budget-editor.tsx`** — só tokens (o modal já usa portal): painel `--surface`, overlay `rgb(0 0 0 / .6)` com `backdrop-filter: blur(2px)`, raio 8 px, sem borda dura.
13. **`src/components/loading-skeletons.tsx`** — mesmo formato (cartões de 85 px e funil de ~395 px) com shimmer (§4) para evitar "pulo" de layout quando os dados chegam.
14. **Demais telas** (`ofertas`, `pixels`, `saude`, `eventos`, `configuracoes`, `login`…): não redesenhar; só passar nos tokens para herdar a nova paleta e espaçamento.

---

## 4. Animações e microinterações (CSS puro, sutis, 150–600 ms)

Defina em `globals.css` e respeite `prefers-reduced-motion` (desligar tudo, manter só a mudança de cor).

| Onde | Efeito | Spec |
|---|---|---|
| Cartões KPI na entrada | fade + subir 6 px | `animation: rise .45s cubic-bezier(.2,.7,.2,1) both`; **stagger 40 ms** por cartão via `style={{animationDelay}}` ou `nth-child` |
| Hover de cartão KPI | fundo vai a `--surface-hover` | `transition: background-color .15s` (sem sombra, sem `translateY`) |
| Funil | revela da esquerda p/ direita | `clip-path: inset(0 100% 0 0)` → `inset(0)` em **700 ms** `ease-out`; porcentagens fazem fade-in 300 ms depois |
| Valores dos KPIs | fade de 200 ms quando mudam | `transition: opacity` / `key` já existente (não criar estado novo) |
| Botões | press | `:active { transform: scale(.98) }`, `transition: background-color .15s, transform .1s` |
| Foco (teclado) | anel | `outline: 2px solid color-mix(in srgb, var(--primary) 55%, transparent); outline-offset: 2px` |
| Item da sidebar | hover/ativo | `transition: background-color .15s, color .15s` |
| Botão Atualizar em `busy` | spinner | `border: 2px solid rgb(255 255 255 / .35); border-top-color:#fff; animation: spin .7s linear infinite` |
| Skeleton | shimmer | gradiente `--surface` → `#2f3850` → `--surface`, `background-size:200% 100%`, `animation: shimmer 1.4s linear infinite` |
| Tooltip "i" | fade-in | 120 ms |

---

## 5. Responsividade

Verifique **1919×993** (idêntico à referência), **1440×900**, **1024×768**, **768** e **390×844**. KPIs: ≥1280 grade §2.3; 768–1279 duas colunas; <768 uma coluna. Sidebar vira `MobileNav` abaixo de `md` (já existe). Nada de scroll horizontal na página (só dentro das tabelas).

## 6. Acessibilidade

Contraste (calculado, WCAG): `#d0d2d6` sobre `#283046` = **8,7:1** ✔; `--muted` `#a3a6b4` = **5,4:1** ✔; `--success` `#28c76f` = **5,9:1** ✔; `--warning` `#ff9f43` = **6,4:1** ✔; `--danger` `#ee4542` = **3,5:1** — serve só para **valores grandes/bold (24 px)**, ícones e o label do KPI em estado ruim (que é bold); em **texto pequeno vermelho** (hints, mensagens de erro, células de tabela) use `#ff6a67` (**4,7:1**). Foco visível em tudo que é interativo. Respeitar `prefers-reduced-motion`.

## 7. Como validar (obrigatório antes de entregar)

1. `npm run dev`, abrir `/` (Resumo) e `/campanhas` (Meta Ads) logado.
2. Tirar **print do antes e do depois** em 1919×993 e **sobrepor com a imagem de referência**: cartões a **85 px**, gaps **19 px**, larguras **526/389/254/390 ± 3 px**, cores dentro de ±2 em cada canal para `--app-bg`, `--surface`, botão e vermelho.
3. `git diff --stat`: **nenhum** arquivo em `src/lib/**`, `src/app/actions.ts`, `src/app/api/**`, `supabase/**`, `tests/**`. Se aparecer, desfaça.
4. `npm run typecheck && npm test` verdes.
5. Conferir que continuam funcionando: clicar **Atualizar**, arrastar a borda de uma coluna da tabela Meta Ads, abrir o lápis de orçamento (modal), ordenar uma coluna, expandir campanha → conjunto → anúncio.
6. Entregar: lista de arquivos alterados, **antes/depois** dos prints, e qualquer decisão "sugerida" que você teve que tomar (marque o que não estava na imagem).

## 8. Fora de escopo (não faça)

Novos recursos, novas métricas, mudança de textos, reorganização de rotas, troca de biblioteca, dark/light toggle, modo claro, redesign de logo, qualquer alteração de banco ou API.
