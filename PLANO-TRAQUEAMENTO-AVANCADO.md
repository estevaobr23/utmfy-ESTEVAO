# Plano — Traqueamento avançado (CAPI) dentro da UTMFY

Estado: **plano, nada implementado** (diagnóstico feito em 18/10/2026, só leitura).
Origem: chat `TRAQUEMAENTO-AVANÇADO.MD` + os containers GTM em `Desktop\TRAQUEAMENTO\` (`Web-Cakto.json`, `Server-Cakto.json`).

## 0. Andamento (19/10/2026)

- Publicado: `t.js` com `sck=<sessão>` e `external_id`; correção do `callback` (93/146 vendas agora ligadas à sessão); IP+geo nas sessões;
  hash do nome; Purchase enriquecido; envio imediato após a venda aprovada; limpeza de IP (30d) e sessões (90d). Migration `20261019000001` aplicada.
- Teste da CAPI (`test_event_code`): Purchase de servidor aceito pela Meta (`events_received: 1`, sem avisos).
- Fila antiga: 102 envios marcados `skipped` (`pre_capi_backlog`).
- Interruptores ligados em 19/10: `pixels.server_tracking_enabled = true` (pixel 4126700287461816) e `CAPI_ENABLED=true` na Vercel. **Nenhum envio real
  ocorreu** (0 vendas depois do deploy).
- ⚠️ Descoberto depois: o pixel **no checkout da Cakto já envia Purchase (navegador + servidor, token CAPI) desde 15/10** (`INTEGRACAO-CHATS.md`).
  Os `event_id` são diferentes: ligar a CAPI da UTMFY junto **dobra** o Purchase. **Ativação em espera até decidir**: (1) Cakto remetente e UTMFY
  desligada; (2) trocar de lado (desligar Purchase/CAPI na Cakto); (3) os dois com `event_id` igual (ver o `event_id` de um Purchase da Cakto no
  Gerenciador de Eventos). Desligar um lado antes de ligar o outro.
- Depois: razão compras Meta ÷ vendas UTMFY (perto de 100% = ok; bem acima = duplicidade).

## 1. Veredito

**Não precisamos de Stape, GTM nem Cloudflare.** A UTMFY (Vercel + Supabase) já é o "servidor": recebe o webhook da
Cakto, tem as sessões do `t.js`, tem fila de envio com retry e dedup, cofre de token por pixel e a flag
`server_tracking_enabled`. O que falta é **completar os dados que a Meta quer** e **ligar**. Custo extra: US$ 0.

Por que não o caminho do chat (Cloudflare Workers + D1): criaria um segundo sistema com os mesmos dados da UTMFY
(sessões, pedidos, pixel por oferta). O receio com o Supabase não se confirma: banco inteiro com **78 MB**, schema
`utmfy` com **8 MB** (sessões: 2 MB). Uma sessão por visita, com limpeza de 30–60 dias, cabe com folga.

## 2. O que os dois JSONs do GTM fazem (e onde isso vive na UTMFY)

| Peça do GTM | O que faz | Equivalente na UTMFY |
|---|---|---|
| Web · `cHTML - Index` | gera um id (`sck`) guardado em cookie/localStorage, guarda UTMs, põe `sck` e `src` em **todos** os links/iframes | `t.js` (hoje manda `callback=<sessão>`, **não** manda `sck`) |
| Web · `FB PageView / InitiateCheckout` + `event_id` | pixel no navegador com `event_id` | `t.js` com `data-pixel` (sem `event_id` compartilhado com o servidor) |
| Server · `Stape Store Writer` (no `begin_checkout`) | grava por `sck`: IP, user-agent, página, `fbp`, `fbc`, id do usuário, estado/país | **falta**: não guardamos IP nem geo; sessão hoje não liga ao pedido |
| Server · Client `/lead/` (webhook Cakto) | recebe a venda aprovada | `/api/webhooks/cakto?o=<token>` (já existe) |
| Server · `Store Lookup` por `data.sck` | recupera IP/UA/fbp/fbc do clique | **falta** (a ligação pedido→sessão está em 0%) |
| Server · `FB Purchase` (CAPI) | Purchase com fn, ln, em, ph, ct, st, country, **IP**, UA, fbp, fbc, external_id, valor, order_id | `capi.ts` + `capi-dispatch.ts`: só em, ph, fbc, fbp, UA, valor, order_id |
| Server · `FB PageView/InitiateCheckout` (CAPI) | os mesmos eventos pelo servidor, deduplicados | **falta** |
| GA4 web+server | métricas GA4 | fora do escopo (não usamos GA4) |

## 3. Diagnóstico medido hoje (banco de produção)

- **146 vendas pagas** (100 nos últimos 7 dias). Têm e-mail e telefone com hash: 146/146.
- `fbc` e `fbp` nas vendas: **93/100** (vêm do pixel da própria Cakto no checkout). Bom ponto de partida.
- UTMs e `ad_id`: 97/100 vendas dos últimos 7 dias. A atribuição de anúncio já funciona.
- **`sck` nas vendas: 0. Ligação venda→sessão do tracker: 0/100.** O `callback` que o `t.js` manda não volta (ou não chega ao
  banco). Consequência: nenhuma venda herda IP nem user-agent do clique.
- **CAPI desligada**: `CAPI_ENABLED=false`, pixel dos gatos com `server_tracking_enabled=false`, token no cofre.
  **102 envios parados na fila**; a Meta só aceita evento com até 7 dias, então só as 100 recentes ainda servem, e perdem validade a cada dia.
- Mesmo ligando hoje, o Purchase sairia **sem `client_ip_address`** e sem nome/cidade/estado (qualidade baixa), e
  `buildPurchaseEvent` **exige user-agent** que hoje só viria da sessão (0% ligada): quase tudo falharia com `missing_client_user_agent`.

### 3.1 Medição da lacuna Meta × UTMFY (18/10/2026, só leitura)

Janela 11–17/10 (fuso de Nova York, o da conta de anúncio `act_2094401681297034`):

| | Compras que a Meta reporta | Vendas pagas na UTMFY | Meta enxerga |
|---|---|---|---|
| Total da janela | **72** | **96** | **75%** |
| Dias cheios com tráfego (15, 16, 17) | 61 | 88 | 69% (79%, 62%, 69%) |
| Campanha AD 2 (`…640550650`) | 30 | 49 | 61% |
| Campanha AD 1 VEO 3 (`…645760650`) | 19 | 25 | 76% |

- **Cerca de 1 em cada 4 vendas não chega à Meta** (~24 vendas em 7 dias). O pixel da Cakto está disparando Purchase (a página só manda PageView/IC), então o risco de duplicidade ao ligar a CAPI é real.
- **PIX = 84 das 96 vendas (87,5%)**; cartão 10, Apple Pay 2. Hipótese coerente com a perda (PIX aprovado fora da página), **não provada**.
- Já temos `fbc` em 74 das 84 vendas PIX: o casamento com o clique é viável.
- Ressalvas: a Meta conta por dia de impressão e nós por dia de pagamento, então o dia a dia oscila (em 11/10 e 12/10 a Meta até passa de nós); o total da janela é mais confiável que o dia. Janela de atribuição padrão da Meta (7d clique / 1d view). Valor não comparado (a Meta converte BRL→USD).

## 4. Lacunas, em ordem de impacto

1. **Sem `sck`**: é a chave que a Cakto devolve em `data.sck` no webhook. Sem ela não há como recuperar IP/UA do clique.
2. **Sem IP do cliente** (peso grande no match da Meta). O beacon do `t.js` passa pelo nosso servidor, então dá para guardar
   (IPv6 quando houver) + geo da Vercel (país/estado/cidade).
3. **Dados do comprador incompletos**: falta nome/sobrenome, cidade/estado/país e `external_id` no Purchase.
4. **Sem eventos de servidor antes da compra** (InitiateCheckout, PageView) com o mesmo `event_id` do navegador.
5. **Duplicidade de Purchase** (risco, ver 6): o pixel da Cakto já dispara Purchase no navegador.
6. Valor: o GTM usava a comissão (`commissions.0.totalAmount`); a UTMFY usa `gross_amount`. Decidir qual valor vai à Meta.
7. Fila velha e ainda desligada; sem monitoramento de qualidade (% das vendas com IP/UA/fbc/fbp).

## 5. Fases (cada uma entrega valor sozinha)

**Fase 0 — Provas antes de código** (sem tocar produção)
- Compra de teste ou 1 pedido real: confirmar que `data.sck` chega no webhook quando `?sck=` está na URL do checkout.
- Descobrir se o pixel da Cakto no checkout manda `event_id` no Purchase (define a estratégia de deduplicação, item 6).
- Confirmar que o token que temos (`META_CAPI_TOKEN`/cofre do pixel) é aceito pela CAPI do pixel `4126700287461816`,
  **só com `test_event_code`**.

**Fase 1 — Coleta (t.js + beacon)**
- `t.js`: usar o id da sessão como `sck`, com os links do checkout levando `sck=<sessão>` (mantém `callback`).
- `t.js`: gerar `event_id` por clique no checkout e passar ao `fbq` e ao beacon.
- `/api/track`: gravar IP (cabeçalho da Vercel) e geo (país/estado/cidade) na sessão; retenção automática de 30–60 dias.
- *Mudança de schema* em `utmfy.tracking_sessions`: **exige aprovação explícita antes de aplicar em produção.**

**Fase 2 — Ligar venda ↔ sessão**
- Normalização do webhook: usar `sck` (e `callback`) para achar a sessão; preencher `order_attribution.session_id`.
- Métrica no painel: % de vendas com sessão, IP, UA, fbc, fbp.

**Fase 3 — Purchase completo**
- `capi.ts`: adicionar `fn`, `ln`, `ct`, `st`, `country`, `client_ip_address`, `external_id`; UA e URL vindos da sessão com
  fallback; valor conforme decisão 6. Testes unitários (já existe suíte para `capi.ts`).
- Ligar em **modo teste** (`test_event_code`) em 1 pixel, conferir no Gerenciador de Eventos (Qualidade de Correspondência).
- Só então `CAPI_ENABLED=true` e `server_tracking_enabled` no pixel dos gatos.

**Fase 4 — Eventos antes da compra**
- InitiateCheckout (e PageView, se fizer sentido) pelo servidor, mesmo `event_id` do navegador.

**Fase 5 — Automatizar por oferta**
- `utmfy.mjs oferta-nova` passa a: ligar `server_tracking_enabled`, ligar o token do pixel, rodar uma checagem de qualidade
  e incluir no `verificar` (✓ token ok, ✓ sck chegando, ✓ evento de teste aceito). Nova oferta = 1 comando, como hoje.

## 6. Riscos e decisões

- **Duplicidade de Purchase (o maior risco).** Com a CAPI ligada e o pixel da Cakto também disparando Purchase, a Meta pode
  contar a venda duas vezes (ROAS inflado no Gerenciador). Caminhos: (a) mesmo `event_id` dos dois lados, se a Cakto
  expuser; (b) desativar Purchase do navegador no checkout da Cakto e confiar no servidor; (c) manter só o do navegador.
  Decidir **depois da Fase 0**, com evento de teste.
- **LGPD:** IP e user-agent são dado pessoal. Guardar só o necessário, apagar em 30–60 dias, citar na política de privacidade.
- **Valor enviado:** bruto (o que o cliente pagou) vs. líquido/comissão. A Meta otimiza pelo valor; escolher e manter igual
  ao que o painel chama de faturamento.
- **Fila antiga (102 envios):** só os dos últimos 7 dias ainda valem; decidir se reenviamos ou descartamos ao ligar.
- Migrations em produção só com aprovação; push em `main` = deploy (confirmar Ready); testes `typecheck + lint + test`.

## 7. O que preciso do usuário

1. Aprovar a direção (UTMFY completa, sem Stape/GTM/Cloudflare).
2. Autorizar a **Fase 0** (inclui um teste com `test_event_code`, sem afetar campanhas).
3. Valor do Purchase: **bruto** (recomendo, igual ao painel) ou comissão?
