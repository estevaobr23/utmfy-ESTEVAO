// Testes do banco: máquina de estados (eventos fora de ordem), dedupe,
// isolamento entre workspaces/ofertas (RLS) e relatórios.
import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers/db";

type Db = Awaited<ReturnType<typeof freshDb>>;
let t: Db;
let WS = "";
let WS2 = "";
let OFFER_A = "";
let OFFER_B = "";
const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const upsert = async (p: Record<string, unknown>) =>
  (await t.su<{ r: Record<string, unknown> }>("select public.upsert_order($1::jsonb) as r", [JSON.stringify({ workspace_id: WS, ...p })]))[0].r;

beforeAll(async () => {
  t = await freshDb();
  await t.su(`insert into auth.users (id, email) values ($1, 'eu@ex.com'), ($2, 'outro@ex.com')`, [USER, OTHER]);
  [{ id: WS }] = await t.su<{ id: string }>(`insert into workspaces (name, slug) values ('Principal', 'principal') returning id`);
  [{ id: WS2 }] = await t.su<{ id: string }>(`insert into workspaces (name, slug) values ('Outro', 'outro') returning id`);
  await t.su(`insert into workspace_members (workspace_id, user_id) values ($1, $2), ($3, $4)`, [WS, USER, WS2, OTHER]);
  [{ id: OFFER_A }] = await t.su<{ id: string }>(`insert into offers (workspace_id, name, slug) values ($1, 'Oferta A', 'oferta-a') returning id`, [WS]);
  [{ id: OFFER_B }] = await t.su<{ id: string }>(`insert into offers (workspace_id, name, slug) values ($1, 'Oferta B', 'oferta-b') returning id`, [WS]);
});

describe("máquina de estados do pedido", () => {
  it("Pix gerado → aprovado: mesmo pedido, sem duplicar", async () => {
    const a = await upsert({ external_order_id: "O1", status: "pending", raw_status: "waiting_payment", payment_method: "pix", gross_amount: 32.9, event_at: "2026-09-30T10:00:00Z", offer_id: OFFER_A });
    expect(a.inserted).toBe(true);
    const b = await upsert({ external_order_id: "O1", status: "paid", raw_status: "paid", gross_amount: 32.9, paid_at: "2026-09-30T10:05:00Z", event_at: "2026-09-30T10:05:00Z" });
    expect(b.applied).toBe(true);
    expect(b.status).toBe("paid");
    const rows = await t.su(`select count(*)::int n from orders where external_order_id = 'O1'`);
    expect(rows[0].n).toBe(1);
  });

  it("webhook atrasado de Pix gerado NÃO regride paid → pending", async () => {
    const r = await upsert({ external_order_id: "O1", status: "pending", raw_status: "waiting_payment", event_at: "2026-09-30T10:00:00Z" });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("regression_blocked");
    expect(r.status).toBe("paid");
  });

  it("webhook duplicado é idempotente (same_status, sem histórico extra)", async () => {
    const before = await t.su(`select count(*)::int n from order_status_history h join orders o on o.id = h.order_id where o.external_order_id = 'O1'`);
    const r = await upsert({ external_order_id: "O1", status: "paid", raw_status: "paid", event_at: "2026-09-30T10:05:00Z" });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe("same_status");
    const after = await t.su(`select count(*)::int n from order_status_history h join orders o on o.id = h.order_id where o.external_order_id = 'O1'`);
    expect(after[0].n).toBe(before[0].n);
  });

  it("reembolso é aplicado e evento antigo de paid não volta o status", async () => {
    const r = await upsert({ external_order_id: "O1", status: "refunded", raw_status: "refunded", refunded_at: "2026-10-01T09:00:00Z", event_at: "2026-10-01T09:00:00Z" });
    expect(r.applied).toBe(true);
    const late = await upsert({ external_order_id: "O1", status: "paid", raw_status: "paid", event_at: "2026-10-01T10:00:00Z" });
    expect(late.applied).toBe(false);
    expect(late.status).toBe("refunded");
    const [o] = await t.su(`select status, refunded_at, paid_at from orders where external_order_id = 'O1'`);
    expect(o.status).toBe("refunded");
    expect(o.paid_at).not.toBeNull();
  });

  it("chargeback depois de pago", async () => {
    await upsert({ external_order_id: "O2", status: "paid", raw_status: "paid", paid_at: "2026-09-30T11:00:00Z", event_at: "2026-09-30T11:00:00Z", gross_amount: 50 });
    const r = await upsert({ external_order_id: "O2", status: "chargedback", raw_status: "chargedback", chargedback_at: "2026-10-05T11:00:00Z", event_at: "2026-10-05T11:00:00Z" });
    expect(r.status).toBe("chargedback");
    const back = await upsert({ external_order_id: "O2", status: "refunded", raw_status: "refunded", event_at: "2026-10-06T11:00:00Z" });
    expect(back.applied).toBe(false);
    expect(back.status).toBe("chargedback");
  });

  it("eventos fora de ordem: aprovado chega ANTES do Pix gerado", async () => {
    await upsert({ external_order_id: "O3", status: "paid", raw_status: "paid", paid_at: "2026-09-30T12:05:00Z", event_at: "2026-09-30T12:05:00Z" });
    const r = await upsert({ external_order_id: "O3", status: "pending", raw_status: "waiting_payment", event_at: "2026-09-30T12:00:00Z" });
    expect(r.status).toBe("paid");
  });

  it("recusado (cartão) → Pix gerado mais novo → pago", async () => {
    await upsert({ external_order_id: "O4", status: "refused", raw_status: "refused", event_at: "2026-09-30T13:00:00Z" });
    const pix = await upsert({ external_order_id: "O4", status: "pending", raw_status: "waiting_payment", event_at: "2026-09-30T13:01:00Z" });
    expect(pix.applied).toBe(true);
    const stale = await upsert({ external_order_id: "O4", status: "refused", raw_status: "refused", event_at: "2026-09-30T12:59:00Z" });
    expect(stale.applied).toBe(false);
    expect(stale.reason).toBe("stale_event");
    const paid = await upsert({ external_order_id: "O4", status: "paid", raw_status: "paid", event_at: "2026-09-30T13:03:00Z" });
    expect(paid.status).toBe("paid");
  });

  it("refund_requested → paid quando o comprador desiste (evento mais novo)", async () => {
    await upsert({ external_order_id: "O5", status: "paid", raw_status: "paid", paid_at: "2026-09-30T14:00:00Z", event_at: "2026-09-30T14:00:00Z" });
    await upsert({ external_order_id: "O5", status: "refund_requested", raw_status: "refund_requested", event_at: "2026-10-01T14:00:00Z" });
    const r = await upsert({ external_order_id: "O5", status: "paid", raw_status: "paid", event_at: "2026-10-02T14:00:00Z" });
    expect(r.status).toBe("paid");
  });

  it("não apaga campos com null em atualização parcial", async () => {
    await upsert({ external_order_id: "O6", status: "pending", gross_amount: 99.9, product_external_id: "P1", event_at: "2026-09-30T15:00:00Z" });
    await upsert({ external_order_id: "O6", status: "paid", event_at: "2026-09-30T15:10:00Z" });
    const [o] = await t.su(`select gross_amount::float g, product_external_id from orders where external_order_id = 'O6'`);
    expect(o.g).toBe(99.9);
    expect(o.product_external_id).toBe("P1");
  });

  it("constraint impede pedido duplicado da mesma plataforma", async () => {
    await expect(
      t.su(`insert into orders (workspace_id, provider, external_order_id, status) values ($1, 'cakto', 'O1', 'paid')`, [WS]),
    ).rejects.toThrow();
  });
});

describe("dedupe de webhook", () => {
  it("mesmo dedupe_key não é gravado duas vezes", async () => {
    await t.su(`insert into webhook_events (workspace_id, dedupe_key, payload) values ($1, 'k1', '{}')`, [WS]);
    const r = await t.su(`insert into webhook_events (workspace_id, dedupe_key, payload) values ($1, 'k1', '{}') on conflict do nothing returning id`, [WS]);
    expect(r.length).toBe(0);
  });
});

describe("RLS e isolamento", () => {
  it("usuário só enxerga o próprio workspace", async () => {
    await t.su(`select public.upsert_order($1::jsonb)`, [JSON.stringify({ workspace_id: WS2, external_order_id: "X1", status: "paid" })]);
    const mine = await t.as(USER, `select external_order_id from orders order by 1`);
    expect(mine.map((r) => r.external_order_id)).not.toContain("X1");
    const theirs = await t.as(OTHER, `select external_order_id from orders`);
    expect(theirs.map((r) => r.external_order_id)).toEqual(["X1"]);
  });

  it("membro não escreve pedidos diretamente (só service_role)", async () => {
    await expect(t.as(USER, `insert into orders (workspace_id, external_order_id, status) values ($1, 'HACK', 'paid')`, [WS])).rejects.toThrow();
    await expect(t.as(USER, `update orders set status = 'paid' where external_order_id = 'O2' returning id`)).resolves.toEqual([]);
  });

  it("usuário não cria oferta em workspace alheio", async () => {
    await expect(t.as(USER, `insert into offers (workspace_id, name, slug) values ($1, 'x', 'x')`, [WS2])).rejects.toThrow();
    const ok = await t.as(USER, `insert into offers (workspace_id, name, slug) values ($1, 'Nova', 'nova') returning id`, [WS]);
    expect(ok.length).toBe(1);
  });

  it("upsert_order não pode ser chamado por authenticated", async () => {
    await expect(t.as(USER, `select public.upsert_order('{"workspace_id":"${WS}","external_order_id":"Z","status":"paid"}'::jsonb)`)).rejects.toThrow();
  });

  it("secret_refs é inacessível para membros", async () => {
    const rows = await t.as(USER, `select * from secret_refs`).catch(() => "denied");
    expect(rows === "denied" || (Array.isArray(rows) && rows.length === 0)).toBe(true);
  });

  it("isolamento de ofertas: relatório da Oferta B não contém receita da A", async () => {
    await upsert({ external_order_id: "R-A", status: "paid", paid_at: "2026-09-20T15:00:00Z", gross_amount: 100, offer_id: OFFER_A, event_at: "2026-09-20T15:00:00Z" });
    await upsert({ external_order_id: "R-B", status: "paid", paid_at: "2026-09-20T15:00:00Z", gross_amount: 40, offer_id: OFFER_B, event_at: "2026-09-20T15:00:00Z" });
    const b = await t.as(USER, `select sum(gross_revenue)::float g from report_order_rows($1, array[$2]::uuid[], '2026-09-20', '2026-09-20', 'America/Sao_Paulo')`, [WS, OFFER_B]);
    expect(b[0].g).toBe(40);
    const all = await t.as(USER, `select sum(gross_revenue)::float g from report_order_rows($1, null, '2026-09-20', '2026-09-20', 'America/Sao_Paulo')`, [WS]);
    expect(all[0].g).toBe(140);
    const foreign = await t.as(OTHER, `select count(*)::int n from report_order_rows($1, null, '2026-09-01', '2026-10-30', 'America/Sao_Paulo')`, [WS]);
    expect(foreign[0].n).toBe(0);
  });
});

describe("gasto e importação da Meta", () => {
  it("importação duplicada faz upsert (sem duplicar) e respeita revisão", async () => {
    const [acc] = await t.su<{ id: string }>(`insert into meta_ad_accounts (workspace_id, account_id, active) values ($1, '999', true) returning id`, [WS]);
    await t.su(`insert into offer_ad_accounts (workspace_id, offer_id, ad_account_id) values ($1, $2, $3)`, [WS, OFFER_A, acc.id]);
    const ins = `insert into meta_insights_daily (workspace_id, date, account_id, campaign_id, adset_id, ad_id, spend, impressions, clicks, currency)
                 values ($1, '2026-09-20', '999', 'C1', 'S1', 'A123', $2, 1000, 20, 'BRL')
                 on conflict (workspace_id, account_id, ad_id, date) do update set spend = excluded.spend`;
    await t.su(ins, [WS, 9]);
    await t.su(ins, [WS, 10]);
    const rows = await t.as(USER, `select ad_id, spend::float s from report_spend_rows($1, array[$2]::uuid[], '2026-09-20', '2026-09-20')`, [WS, OFFER_A]);
    expect(rows).toEqual([{ ad_id: "A123", s: 10 }]);
    const other = await t.as(USER, `select count(*)::int n from report_spend_rows($1, array[$2]::uuid[], '2026-09-20', '2026-09-20')`, [WS, OFFER_B]);
    expect(other[0].n).toBe(0);
  });

  it("campaign_filter separa gasto de uma conta compartilhada entre ofertas", async () => {
    const [acc] = await t.su<{ id: string }>(`insert into meta_ad_accounts (workspace_id, account_id, active) values ($1, '888', true) returning id`, [WS]);
    await t.su(`insert into offer_ad_accounts (workspace_id, offer_id, ad_account_id, campaign_filter) values ($1, $2, $3, 'CESTA'), ($1, $4, $3, 'SOFA')`, [WS, OFFER_A, acc.id, OFFER_B]);
    await t.su(`insert into meta_insights_daily (workspace_id, date, account_id, campaign_id, campaign_name, adset_id, ad_id, spend) values
      ($1, '2026-09-21', '888', 'C10', '[CESTA] Topo', 'S10', 'A10', 30), ($1, '2026-09-21', '888', 'C11', '[SOFA] Topo', 'S11', 'A11', 70)`, [WS]);
    const a = await t.as(USER, `select sum(spend)::float s from report_spend_rows($1, array[$2]::uuid[], '2026-09-21', '2026-09-21')`, [WS, OFFER_A]);
    const b = await t.as(USER, `select sum(spend)::float s from report_spend_rows($1, array[$2]::uuid[], '2026-09-21', '2026-09-21')`, [WS, OFFER_B]);
    const all = await t.as(USER, `select sum(spend)::float s from report_spend_rows($1, null, '2026-09-21', '2026-09-21')`, [WS]);
    expect([a[0].s, b[0].s, all[0].s]).toEqual([30, 70, 100]);
  });
});

describe("câmbio explícito", () => {
  it("conta em USD: sem câmbio fica fora; com câmbio entra convertida", async () => {
    const [acc] = await t.su<{ id: string }>(`insert into meta_ad_accounts (workspace_id, account_id, active, currency) values ($1, '777', true, 'USD') returning id`, [WS]);
    await t.su(`insert into offer_ad_accounts (workspace_id, offer_id, ad_account_id) values ($1, $2, $3)`, [WS, OFFER_B, acc.id]);
    await t.su(`insert into meta_insights_daily (workspace_id, date, account_id, campaign_id, adset_id, ad_id, spend, currency) values ($1, '2026-09-22', '777', 'CU', 'SU', 'AU', 10, 'USD')`, [WS]);
    const q = `select coalesce(sum(spend), 0)::float s from report_spend_rows($1, array[$2]::uuid[], '2026-09-22', '2026-09-22', 'BRL')`;
    expect((await t.as(USER, q, [WS, OFFER_B]))[0].s).toBe(0);
    const ex = await t.as(USER, `select account_id, spend::float s from report_spend_excluded($1, '2026-09-22', '2026-09-22', 'BRL')`, [WS]);
    expect(ex).toEqual([{ account_id: "777", s: 10 }]);
    await t.su(`update meta_ad_accounts set fx_rate = 5.5 where id = $1`, [acc.id]);
    expect((await t.as(USER, q, [WS, OFFER_B]))[0].s).toBe(55);
  });
});

describe("dispatch CAPI", () => {
  it("um dispatch por (pedido, pixel, evento); pixels independentes", async () => {
    const [o] = await t.su<{ id: string }>(`select id from orders where external_order_id = 'O5'`);
    const px = await t.su<{ id: string }>(`insert into pixels (workspace_id, external_pixel_id, name) values ($1, '100000001', 'A'), ($1, '100000002', 'B'), ($1, '100000003', 'C') returning id`, [WS]);
    for (const p of px) {
      await t.su(`insert into conversion_dispatches (workspace_id, order_id, pixel_id, event_name, event_id) values ($1, $2, $3, 'Purchase', 'cakto:O5:Purchase') on conflict do nothing`, [WS, o.id, p.id]);
      await t.su(`insert into conversion_dispatches (workspace_id, order_id, pixel_id, event_name, event_id) values ($1, $2, $3, 'Purchase', 'cakto:O5:Purchase') on conflict do nothing`, [WS, o.id, p.id]);
    }
    await t.su(`update conversion_dispatches set status = 'sent' where pixel_id in ($1, $2)`, [px[0].id, px[1].id]);
    await t.su(`update conversion_dispatches set status = 'failed' where pixel_id = $1`, [px[2].id]);
    const rows = await t.su(`select status, count(*)::int n from conversion_dispatches where order_id = $1 group by 1 order by 1`, [o.id]);
    expect(rows).toEqual([{ status: "failed", n: 1 }, { status: "sent", n: 2 }]);
  });
});

describe("sessão do tracker", () => {
  it("first-touch preservado, last-touch atualizado, contadores somam", async () => {
    const base = { workspace_id: WS, session_id: "sabcdefgh1234", event: "pageview" };
    await t.su(`select track_session($1::jsonb)`, [JSON.stringify({ ...base, first_touch: { utm_source: "FB", utm_content: "ad1|111111111" }, last_touch: { utm_source: "FB", utm_content: "ad1|111111111" } })]);
    await t.su(`select track_session($1::jsonb)`, [JSON.stringify({ ...base, first_touch: { utm_source: "ig" }, last_touch: { utm_source: "ig", utm_content: "ad2|222222222" } })]);
    await t.su(`select track_session($1::jsonb)`, [JSON.stringify({ ...base, event: "checkout_click" })]);
    const [s] = await t.su(`select first_touch->>'utm_source' ft, utm_source, utm_content, pageviews, checkout_clicks from tracking_sessions where session_id = 'sabcdefgh1234'`);
    expect(s).toEqual({ ft: "FB", utm_source: "ig", utm_content: "ad2|222222222", pageviews: 2, checkout_clicks: 1 });
  });
});
