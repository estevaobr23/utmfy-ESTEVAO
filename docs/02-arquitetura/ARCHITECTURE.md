# ARQUITETURA

## Stack

Next.js 16 (App Router, Server Components + Server Actions, `proxy.ts`) · TypeScript · Tailwind 4 ·
Supabase (Postgres 17, Auth, RLS, Vault, pg_cron/pg_net) · Vercel. Sem biblioteca de UI; `zod` para validar
entrada pública. Webhook, tracker e crons são **Route Handlers** (um só código TS testado) — não Edge Functions.

```
src/
  lib/core/        lógica PURA e testada (sem I/O)
    utm.ts           parser de UTMs (NOME|ID, ID|NOME, só ID, só nome, macros, encoding)
    attribution.ts   motor de atribuição (EXACT_ID > UTM_PARSED > NAME_MATCH ...)
    metrics.ts       ÚNICA fonte das fórmulas (ROAS, CPA, líquido, lucro...)
    report.ts        árvore Campanha → Conjunto → Anúncio
    cakto/           normalize.ts (payload → pedido), signature.ts (HMAC), fixtures.ts
    meta.ts          normalização de insights, classificação de erros, janelas
    capi.ts          evento Purchase (event_id determinístico, hashes)
    checkout-url.ts  espelho TS do public/t.js (usado no Diagnóstico)
    diagnostic.ts    diagnóstico de URL · utm-template.ts gerador/lint de template
  lib/services/    I/O no servidor (service_role)
    orders.ts        caminho ÚNICO de gravação de pedido + atribuição + fila CAPI
    cakto-webhook.ts cakto-client.ts cakto-sync.ts meta-client.ts meta-sync.ts
    capi-dispatch.ts tracking.ts demo.ts logs.ts
  lib/queries.ts   consultas da UI (RLS do usuário)
  app/             telas (app)/..., api/webhooks/cakto, api/track, api/cron/[job], api/meta/oauth/*
public/t.js        tracker público (ES5, sem dependências)
supabase/migrations/  schema, funções, RLS
```

## Modelo de dados (resumo)

| Tabela | Papel |
| - | - |
| `workspaces`, `workspace_members` | isolamento; papéis owner/admin/viewer |
| `offers`, `offer_cakto_items` | oferta interna ↔ N produtos/ofertas Cakto (um item Cakto só pode ter uma oferta) |
| `cakto_connections`, `meta_connections` | estado das conexões (**sem secrets**) |
| `secret_refs` | referência a secrets do **Vault**; sem policy → só service_role |
| `meta_ad_accounts`, `offer_ad_accounts` | contas (N:N com ofertas, `campaign_filter` opcional, `fx_rate` manual) |
| `meta_ads` | catálogo campanha → conjunto → anúncio |
| `meta_insights_daily` | gasto/impressões/cliques por anúncio/dia; PK `(workspace, account, ad, date)` → upsert |
| `pixels`, `offer_pixels` | N:N; `server_tracking_enabled`, token no Vault ou env |
| `orders` | pedido normalizado; `unique(workspace, provider, external_order_id)` |
| `order_status_history` | toda transição, inclusive as **rejeitadas** (com motivo) |
| `order_attribution` | UTMs, sck, fbc/fbp, sessão, IDs/nomes, status/método/razão, issues |
| `webhook_events` | auditoria; `unique(provider, dedupe_key)` (sha256 do corpo cru); payload sem secret/PII |
| `tracking_sessions` | sessão do tracker (first/last touch, fbclid/fbc/fbp, UA) |
| `conversion_dispatches` | 1 por (pedido, pixel, evento); `unique(pixel, event_id)` |
| `integration_logs`, `sync_jobs`, `reconciliation_changes` | observabilidade |
| `cost_rules` | estrutura para custos futuros (taxas, imposto, custo por venda, fixos) |

**RLS**: todo SELECT exige `is_member(workspace_id)`. Configuração (ofertas, mapeamentos, pixels, custos) aceita
escrita de owner/admin. Dados de integração (pedidos, eventos, insights, logs) **só são escritos com service_role**.
`anon` não lê tabela nenhuma. `upsert_order`, `track_session`, `store_secret`, `read_secret` são revogados de
`anon/authenticated`.

## Máquina de estados do pedido (`public.upsert_order`)

Status normalizados em níveis:

| Nível | Status |
| - | - |
| 0 — pré-pagamento | `pending`, `refused`, `canceled` |
| 1 — pago/vivo | `paid`, `refund_requested`, `disputed` (MED/prechargeback/protesto) |
| 2 — final | `refunded`, `chargedback` |

- nível novo **maior** → aplica (pending → paid, paid → refunded)
- nível novo **menor** → **rejeita** (`regression_blocked`): paid nunca volta a pending; refunded nunca volta a paid
- **mesmo nível** → aplica só se o evento não for mais antigo (`stale_event`) — ex.: cartão recusado → Pix gerado;
  refund_requested → paid quando o comprador desiste
- nível 2: refunded → chargedback permitido; o inverso não

Roda com `SELECT ... FOR UPDATE` (webhooks concorrentes não se atropelam). Campos descritivos nunca são apagados
com null. O "tempo do evento" é o `X-Cakto-Timestamp` (webhook) ou o momento da leitura (API = foto atual).

## Fórmulas (src/lib/core/metrics.ts)

| Métrica | Fórmula |
| - | - |
| Receita bruta | Σ valor cobrado (`amount`) dos pedidos aprovados no período (por `paid_at`), inclusive os que depois viraram reembolso/chargeback |
| Reembolsos / Chargebacks | Σ valor dos aprovados no período cujo status atual é refunded / chargedback |
| Receita líquida | bruta − reembolsos − chargebacks − taxas Cakto |
| Lucro estimado | líquida − gasto − outros custos (`cost_rules`) |
| ROAS | bruta ÷ gasto (null se gasto = 0) · ROAS líquido = líquida ÷ gasto |
| Vendas aprovadas | nº de pedidos **principais** (`offer_type=main`) aprovados — bump/upsell não inflam o CPA |
| CPA | gasto ÷ vendas aprovadas · Ticket = bruta ÷ vendas |
| Pix gerados / conversão | pedidos Pix criados no período · pagos ÷ gerados (mesma coorte) |
| CTR / CPC | cliques ÷ impressões · gasto ÷ cliques |

O banco devolve só **somas** (`report_order_rows`, `report_spend_rows`); toda razão é calculada em `derive()`.
Nenhuma tela calcula ROAS por conta própria.

**Datas e moeda**: dias no fuso do workspace (padrão America/Sao_Paulo); gasto Meta usa a data da conta.
Moedas diferentes não são somadas; conta em outra moeda só entra com `fx_rate` manual.

**Gasto por oferta**: vem das contas associadas à oferta; se uma conta serve várias ofertas, `campaign_filter`
(substring do nome da campanha) separa o gasto. "Todas as ofertas" soma todas as contas monitoradas uma única vez.

## Decisões

- Cakto é a verdade financeira; conversões reportadas pela Meta ficam em `meta_purchases` (só referência).
- Sem fuzzy matching: nome só atribui se for **exato e único**. Preferimos "não rastreada" a atribuição falsa.
- Webhook responde 2xx sempre que o evento foi gravado (a Cakto não reenvia não-2xx); falhas viram log e
  a reconciliação recupera.
- Modo DEMO = workspace separado (`is_demo`), com faixa amarela; nunca mistura com produção.
