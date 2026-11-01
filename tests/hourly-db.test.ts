// Migration 20261031000001: gasto por hora (tabela + report_hourly_spend + RLS).
import { beforeAll, describe, expect, it } from "vitest";
import { freshDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof freshDb>>;
let WS = "";
let WS2 = "";
const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

beforeAll(async () => {
  t = await freshDb();
  await t.su(`insert into auth.users (id, email) values ($1, 'eu@ex.com'), ($2, 'outro@ex.com')`, [USER, OTHER]);
  [{ id: WS }] = await t.su<{ id: string }>(`insert into workspaces (name, slug) values ('A', 'a') returning id`);
  [{ id: WS2 }] = await t.su<{ id: string }>(`insert into workspaces (name, slug) values ('B', 'b') returning id`);
  await t.su(`insert into workspace_members (workspace_id, user_id) values ($1, $2), ($3, $4)`, [WS, USER, WS2, OTHER]);
  await t.su(`insert into meta_ad_accounts (workspace_id, account_id, active) values ($1, '111', true)`, [WS]);
  await t.su(`insert into fx_rates (currency, date, rate) values ('USD', '2026-10-20', 5), ('USD', '2026-10-21', 6)`);
  await t.su(`insert into meta_insights_hourly (workspace_id, date, hour, account_id, campaign_id, campaign_name, adset_id, spend, currency) values
    ($1, '2026-10-20', 10, '111', 'C1', 'Camp 1', 'S1', 2, 'USD'),
    ($1, '2026-10-21', 10, '111', 'C1', 'Camp 1', 'S1', 1, 'USD'),
    ($1, '2026-10-21', 11, '111', 'C1', 'Camp 1', 'S2', 4, 'USD'),
    ($2, '2026-10-21', 10, '999', 'CX', 'Outra', 'SX', 50, 'USD')`, [WS, WS2]);
});

describe("report_hourly_spend", () => {
  it("soma por conjunto e hora, convertendo pelo câmbio de cada dia", async () => {
    const rows = await t.as<{ adset_id: string; hour: number; spend: string; currency: string }>(
      USER, `select adset_id, hour, spend, currency from report_hourly_spend($1, '2026-10-20', '2026-10-21', 'BRL') order by adset_id, hour`, [WS]);
    expect(rows.map((r) => [r.adset_id, Number(r.hour), Number(r.spend), r.currency])).toEqual([["S1", 10, 2 * 5 + 1 * 6, "BRL"], ["S2", 11, 24, "BRL"]]);
  });

  it("filtra por período e por conjunto", async () => {
    const rows = await t.as<{ adset_id: string; spend: string }>(USER, `select adset_id, spend from report_hourly_spend($1, '2026-10-21', '2026-10-21', 'BRL', null, null, 'S2')`, [WS]);
    expect(rows.map((r) => [r.adset_id, Number(r.spend)])).toEqual([["S2", 24]]);
  });

  it("sem câmbio a linha fica de fora em vez de virar valor errado", async () => {
    await t.su(`insert into meta_insights_hourly (workspace_id, date, hour, account_id, campaign_id, adset_id, spend, currency) values ($1, '2026-01-01', 3, '111', 'C1', 'S1', 9, 'USD')`, [WS]);
    const rows = await t.as(USER, `select * from report_hourly_spend($1, '2026-01-01', '2026-01-01', 'BRL')`, [WS]);
    expect(rows).toEqual([]);
  });

  it("RLS: membro de outro workspace só enxerga o próprio gasto", async () => {
    const other = await t.as(OTHER, `select * from meta_insights_hourly where workspace_id = $1`, [WS]);
    expect(other).toEqual([]);
    const own = await t.as<{ n: string }>(OTHER, `select count(*)::text n from meta_insights_hourly`);
    expect(Number(own[0].n)).toBe(1);
  });

  it("membro não escreve na tabela (só o service_role)", async () => {
    await expect(t.as(USER, `insert into meta_insights_hourly (workspace_id, date, hour, account_id, campaign_id, adset_id) values ($1, '2026-10-22', 1, '111', 'C', 'S')`, [WS])).rejects.toThrow();
  });
});
