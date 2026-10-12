// Migration 20261011000005: tabelas novas, report_video_rows, RLS e não-regressão do gasto.
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
  await t.su(`insert into meta_ads (workspace_id, account_id, campaign_id, adset_id, ad_id, has_video, creative_type) values
    ($1, '111', 'C1', 'S1', 'V1', true, 'VIDEO'), ($1, '111', 'C1', 'S1', 'I1', false, 'SHARE')`, [WS]);
  await t.su(`insert into meta_insights_daily (workspace_id, date, account_id, campaign_id, adset_id, ad_id, spend, impressions, clicks, currency) values
    ($1, '2026-10-10', '111', 'C1', 'S1', 'V1', 7.72, 827, 10, 'USD'), ($1, '2026-10-10', '111', 'C1', 'S1', 'I1', 3.00, 500, 4, 'USD')`, [WS]);
  const v = `insert into meta_video_daily (workspace_id, date, account_id, campaign_id, adset_id, ad_id, impressions, video_plays, plays_3s, thruplays, p25, p100, avg_watch_seconds)
    values ($1, $2, '111', 'C1', 'S1', $3, $4, $5, $6, $7, $8, $9, $10)
    on conflict (workspace_id, account_id, ad_id, date) do update set impressions = excluded.impressions, plays_3s = excluded.plays_3s`;
  await t.su(v, [WS, "2026-10-10", "V1", 827, 799, 190, 69, 70, 25, 5]);
  await t.su(v, [WS, "2026-10-11", "V1", 100, 90, 40, 10, 12, 3, 4]);
  await t.su(v, [WS, "2026-10-10", "I1", 500, 3, null, null, null, null, 1]);
});

describe("migration de métricas avançadas", () => {
  it("report_video_rows soma por anúncio no período e traz o tipo de criativo", async () => {
    const rows = await t.as<{ ad_id: string; has_video: boolean; impressions: number; plays_3s: number; video_plays: number; watch_seconds: string }>(
      USER, `select * from report_video_rows($1, '2026-10-10', '2026-10-11') order by ad_id`, [WS]);
    expect(rows.map((r) => r.ad_id)).toEqual(["I1", "V1"]);
    const v1 = rows.find((r) => r.ad_id === "V1")!;
    expect(v1).toMatchObject({ has_video: true, impressions: 927, plays_3s: 230, video_plays: 889 });
    expect(Number(v1.watch_seconds)).toBe(5 * 799 + 4 * 90);
    expect(rows.find((r) => r.ad_id === "I1")!.has_video).toBe(false);
  });

  it("upsert pela chave primária não duplica (reimportação idempotente)", async () => {
    const before = await t.su<{ n: number }>(`select count(*)::int n from meta_video_daily`);
    await t.su(`insert into meta_video_daily (workspace_id, date, account_id, campaign_id, adset_id, ad_id, impressions, plays_3s)
      values ($1, '2026-10-10', '111', 'C1', 'S1', 'V1', 830, 191)
      on conflict (workspace_id, account_id, ad_id, date) do update set impressions = excluded.impressions, plays_3s = excluded.plays_3s`, [WS]);
    const after = await t.su<{ n: number }>(`select count(*)::int n from meta_video_daily`);
    expect(after[0].n).toBe(before[0].n);
  });

  it("RLS: outro workspace não lê vídeo, orçamento nem alcance", async () => {
    await t.su(`insert into meta_campaigns (workspace_id, account_id, campaign_id, daily_budget_minor, currency) values ($1, '111', 'C1', 401, 'USD')`, [WS]);
    await t.su(`insert into meta_adsets (workspace_id, account_id, campaign_id, adset_id) values ($1, '111', 'C1', 'S1')`, [WS]);
    await t.su(`insert into meta_reach_period (workspace_id, account_id, level, object_id, since, until, impressions, reach, frequency)
      values ($1, '111', 'campaign', 'C1', '2026-10-04', '2026-10-10', 827, 700, 1.181429)`, [WS]);
    for (const tbl of ["meta_video_daily", "meta_campaigns", "meta_adsets", "meta_reach_period"]) {
      expect((await t.as<{ n: number }>(OTHER, `select count(*)::int n from ${tbl}`))[0].n).toBe(0);
      expect((await t.as<{ n: number }>(USER, `select count(*)::int n from ${tbl}`))[0].n).toBeGreaterThan(0);
    }
    expect((await t.as(OTHER, `select * from report_video_rows($1, '2026-10-01', '2026-10-31')`, [WS])).length).toBe(0);
  });

  it("membro não escreve nas tabelas novas (só service_role)", async () => {
    await expect(t.as(USER, `insert into meta_campaigns (workspace_id, account_id, campaign_id) values ($1, '111', 'HACK')`, [WS])).rejects.toThrow();
  });

  it("nível de alcance inválido é recusado", async () => {
    await expect(t.su(`insert into meta_reach_period (workspace_id, account_id, level, object_id, since, until) values ($1, '1', 'oferta', 'x', '2026-10-01', '2026-10-01')`, [WS])).rejects.toThrow();
  });

  it("gasto existente não muda: report_spend_rows segue igual", async () => {
    const rows = await t.as<{ ad_id: string; spend: string; impressions: number }>(USER, `select ad_id, spend, impressions from report_spend_rows($1, null, '2026-10-10', '2026-10-10') order by ad_id`, [WS]);
    expect(rows.map((r) => [r.ad_id, Number(r.spend), Number(r.impressions)])).toEqual([["I1", 3, 500], ["V1", 7.72, 827]]);
  });
});
