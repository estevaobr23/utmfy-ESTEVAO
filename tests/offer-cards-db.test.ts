// Migration 20261121000001: séries diárias dos cards de oferta (report_spend_daily_rows / report_offer_orders_daily).
import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
let WS = "";
let OFFER = "";
const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

beforeAll(async () => {
  t = await freshDb();
  await t.su(`insert into auth.users (id, email) values ($1, 'eu@ex.com'), ($2, 'outro@ex.com')`, [USER, OTHER]);
  [{ id: WS }] = await t.su<{ id: string }>(`insert into workspaces (name, slug) values ('A', 'a') returning id`);
  await t.su(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [WS, USER]);
  [{ id: OFFER }] = await t.su<{ id: string }>(`insert into offers (workspace_id, name, slug) values ($1, 'Oferta', 'oferta') returning id`, [WS]);
  await t.su(`insert into meta_ad_accounts (workspace_id, account_id, active) values ($1, '111', true)`, [WS]);
  await t.su(`insert into fx_rates (currency, date, rate) values ('USD', '2026-11-01', 5), ('USD', '2026-11-02', 6)`);
  await t.su(`insert into meta_insights_daily (workspace_id, date, account_id, campaign_id, campaign_name, adset_id, ad_id, spend, currency) values
    ($1, '2026-11-01', '111', 'C1', 'Camp', 'S1', 'A1', 2, 'USD'),
    ($1, '2026-11-01', '111', 'C1', 'Camp', 'S1', 'A2', 1, 'USD'),
    ($1, '2026-11-02', '111', 'C1', 'Camp', 'S1', 'A1', 1, 'USD')`, [WS]);
  await t.su(`insert into orders (workspace_id, offer_id, external_order_id, status, gross_amount, fees, currency, paid_at, offer_type, source) values
    ($1, $2, 'o1', 'paid', 100, 10, 'BRL', '2026-11-01 15:00:00+00', 'main', 'webhook'),
    ($1, $2, 'o2', 'paid', 30, 0, 'BRL', '2026-11-01 16:00:00+00', 'order_bump', 'webhook'),
    ($1, $2, 'o3', 'refunded', 50, 0, 'BRL', '2026-11-02 02:00:00+00', 'main', 'webhook'),
    ($1, $2, 'o4', 'paid', 70, 0, 'BRL', '2026-11-02 15:00:00+00', 'main', 'test'),
    ($1, $2, 'o5', 'pending', 70, 0, 'BRL', null, 'main', 'webhook')`, [WS, OFFER]);
});

describe("report_spend_daily_rows", () => {
  it("soma por conjunto e dia, convertendo pelo câmbio do dia", async () => {
    const rows = await t.as<{ adset_id: string; day: string; spend: string }>(USER, `select adset_id, day::text as day, spend from report_spend_daily_rows($1, '2026-11-01', '2026-11-02', 'BRL') order by day`, [WS]);
    expect(rows.map((r) => [r.adset_id, r.day, Number(r.spend)])).toEqual([["S1", "2026-11-01", 15], ["S1", "2026-11-02", 6]]);
  });
  it("outro usuário não vê nada (RLS)", async () => {
    expect(await t.as(OTHER, `select * from report_spend_daily_rows($1, '2026-11-01', '2026-11-02', 'BRL')`, [WS])).toEqual([]);
  });
});

describe("report_offer_orders_daily", () => {
  it("vendas aprovadas por oferta e dia do fuso; ignora teste e pendente", async () => {
    const rows = await t.as<{ day: string; approved_count: string; gross_revenue: string; fees: string; refunded_amount: string }>(
      USER, `select day::text as day, approved_count, gross_revenue, fees, refunded_amount from report_offer_orders_daily($1, '2026-10-31', '2026-11-02', 'America/Sao_Paulo', 'BRL') order by day`, [WS]);
    // o3 foi paga às 02:00 UTC de 02/11 = 23:00 de 01/11 em São Paulo.
    expect(rows.map((r) => [r.day, Number(r.approved_count), Number(r.gross_revenue), Number(r.fees), Number(r.refunded_amount)])).toEqual([
      ["2026-11-01", 2, 180, 10, 50],
    ]);
  });
  it("outro usuário não vê nada (RLS)", async () => {
    expect(await t.as(OTHER, `select * from report_offer_orders_daily($1, '2026-10-31', '2026-11-02', 'America/Sao_Paulo', 'BRL')`, [WS])).toEqual([]);
  });
});
