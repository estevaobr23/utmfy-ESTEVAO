import { describe, expect, it } from "vitest";
import { MetaApiError, type MetaClient } from "@/lib/services/meta-client";
import { syncAdvanced, type AccountRow } from "@/lib/services/meta-sync";
import type { Db } from "@/lib/supabase/types";

// Banco falso: guarda upserts por chave (prova idempotência) e registra logs.
function fakeDb() {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const logs: Record<string, unknown>[] = [];
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const keyCols: Record<string, string[]> = {};
  const builder = (table: string) => {
    const chain = {
      upsert(rows: Record<string, unknown>[], opts: { onConflict: string }) {
        keyCols[table] = opts.onConflict.split(",");
        const t = tables.get(table) ?? new Map();
        tables.set(table, t);
        for (const r of rows) {
          const k = keyCols[table].map((c) => String(r[c])).join("|");
          t.set(k, { ...(t.get(k) ?? {}), ...r });
        }
        return Promise.resolve({ error: null });
      },
      insert(row: Record<string, unknown>) {
        if (table === "integration_logs") logs.push(row);
        return Promise.resolve({ error: null });
      },
      update(patch: Record<string, unknown>) { updates.push({ table, patch }); return chain; },
      select() { return chain; },
      delete() { return chain; },
      not() { return chain; },
      eq() { return chain; },
      lt() { return chain; },
      then(resolve: (v: { data: unknown[]; error: null }) => void) { resolve({ data: [], error: null }); },
    };
    return chain;
  };
  return { db: { from: builder } as unknown as Db, tables, logs, updates };
}

const ACC: AccountRow = { id: "u1", account_id: "111", connection_id: null, timezone: "America/New_York", currency: "USD" };

const video = (ad: string, date: string, extra: Record<string, unknown> = {}) => ({
  account_id: "111", campaign_id: "C1", adset_id: "S1", ad_id: ad, date_start: date, impressions: "100",
  actions: [{ action_type: "video_view", value: "30" }],
  video_play_actions: [{ action_type: "video_view", value: "95" }],
  video_thruplay_watched_actions: [{ action_type: "video_view", value: "10" }],
  ...extra,
});

function fakeClient(opts: { failStep?: string; rejectField?: string; emptyCampaigns?: boolean } = {}) {
  const calls: { path: string; params: Record<string, unknown> }[] = [];
  const client = {
    async getAll(path: string, params: Record<string, unknown>) {
      calls.push({ path, params });
      if (opts.failStep && path.endsWith(opts.failStep)) throw new MetaApiError("no_permission", 200, "sem permissão", 403);
      if (path.endsWith("/campaigns") && opts.emptyCampaigns) return [];
      if (path.endsWith("/campaigns")) return [{ id: "C1", name: "CBO", daily_budget: "401", bid_strategy: "LOWEST_COST_WITHOUT_CAP" }];
      if (path.endsWith("/adsets")) return [{ id: "S1", campaign_id: "C1", bid_strategy: "LOWEST_COST_WITHOUT_CAP" }];
      if (path.endsWith("/ads")) return [
        { id: "V1", campaign: { id: "C1" }, adset: { id: "S1" }, creative: { object_type: "VIDEO", video_id: "9" } },
        { id: "I1", campaign: { id: "C1" }, adset: { id: "S1" }, creative: { object_type: "SHARE" } },
      ];
      if (path.endsWith("/insights") && params.time_increment) {
        const fields = String(params.fields);
        if (opts.rejectField && fields.includes(opts.rejectField)) throw new MetaApiError("invalid_request", 100, `(#100) ${opts.rejectField} is not valid`, 400);
        return [video("V1", "2026-10-10"), video("V1", "2026-10-11"), { account_id: "111", campaign_id: "C1", adset_id: "S1", ad_id: "I1", date_start: "2026-10-11", impressions: "500" }];
      }
      if (path.endsWith("/insights")) {
        const level = String(params.level);
        const id = level === "account" ? { account_id: "111" } : { account_id: "111", [`${level}_id`]: level === "campaign" ? "C1" : level === "adset" ? "S1" : "V1" };
        return [{ ...id, impressions: "827", reach: "700", frequency: "1.181429" }];
      }
      return [];
    },
    async insightsAsync() { return []; },
  };
  return { client: client as unknown as MetaClient, calls };
}

describe("syncAdvanced (mocks)", () => {
  it("coleta campanhas, conjuntos, vídeo e alcance (criativos vêm junto do catálogo, em syncAccount)", async () => {
    const { db, tables } = fakeDb();
    const { client, calls } = fakeClient();
    const s = await syncAdvanced(db, "ws", client, ACC, "2026-10-10", "2026-10-11", "America/Sao_Paulo");
    expect(s).toMatchObject({ campaigns: 1, adsets: 1, creatives: 0, video_rows: 3, video_saved: 2, video_not_applicable: 1, failures: [] });
    expect(tables.get("meta_campaigns")!.get("ws|C1")).toMatchObject({ daily_budget_minor: 401, currency: "USD" });
    // Economia de cota da Meta: syncAdvanced não consulta /ads (o catálogo já traz o criativo).
    expect(calls.some((c) => c.path.endsWith("/ads"))).toBe(false);
    expect(tables.get("meta_video_daily")!.get("ws|111|V1|2026-10-11")).toMatchObject({ plays_3s: 30, video_plays: 95, thruplays: 10 });
    expect(s.reach_rows).toBeGreaterThan(0);
  });

  it("é idempotente: sincronizar o mesmo período de novo não duplica", async () => {
    const { db, tables } = fakeDb();
    const { client } = fakeClient();
    await syncAdvanced(db, "ws", client, ACC, "2026-10-10", "2026-10-11", "America/Sao_Paulo");
    const counts = [...tables.entries()].map(([t, m]) => [t, m.size]);
    await syncAdvanced(db, "ws", client, ACC, "2026-10-10", "2026-10-11", "America/Sao_Paulo");
    expect([...tables.entries()].map(([t, m]) => [t, m.size])).toEqual(counts);
  });

  it("falha numa etapa opcional não derruba as outras e vira aviso", async () => {
    const { db, tables, logs } = fakeDb();
    const { client } = fakeClient({ failStep: "/adsets" });
    const s = await syncAdvanced(db, "ws", client, ACC, "2026-10-10", "2026-10-11", "America/Sao_Paulo");
    expect(s.failures).toEqual([expect.objectContaining({ step: "adsets", reason: "no_permission" })]);
    expect(s.campaigns).toBe(1);
    expect(tables.get("meta_video_daily")!.size).toBe(2);
    expect(logs.some((l) => l.code === "META_ADVANCED_SYNC_FAILED" && l.level === "warn")).toBe(true);
  });

  it("campo de vídeo rejeitado é removido e a coleta segue", async () => {
    const { db, tables } = fakeDb();
    const { client, calls } = fakeClient({ rejectField: "video_continuous_2_sec_watched_actions" });
    const s = await syncAdvanced(db, "ws", client, ACC, "2026-10-10", "2026-10-11", "America/Sao_Paulo");
    expect(s.failures).toEqual([{ step: "video", reason: "field_rejected", message: "video_continuous_2_sec_watched_actions" }]);
    expect(tables.get("meta_video_daily")!.size).toBe(2);
    expect(calls.filter((c) => c.params.time_increment).length).toBe(2);
  });

  it("marca como arquivado o que a Meta deixou de listar (e não mexe em nada se a lista vier vazia)", async () => {
    const full = fakeDb();
    await syncAdvanced(full.db, "ws", fakeClient().client, ACC, "2026-10-10", "2026-10-11", "America/Sao_Paulo");
    const archived = full.updates.filter((u) => u.patch.effective_status === "ARCHIVED").map((u) => u.table).sort();
    expect(archived).toEqual(["meta_adsets", "meta_campaigns"]);

    const empty = fakeDb();
    await syncAdvanced(empty.db, "ws", fakeClient({ emptyCampaigns: true }).client, ACC, "2026-10-10", "2026-10-11", "America/Sao_Paulo");
    expect(empty.updates.some((u) => u.table === "meta_campaigns")).toBe(false);
  });

  it("só faz chamadas de leitura (GET) — nunca escreve na Meta", async () => {
    const { db } = fakeDb();
    const { client, calls } = fakeClient();
    await syncAdvanced(db, "ws", client, ACC, "2026-10-10", "2026-10-11", "America/Sao_Paulo");
    for (const c of calls) expect(c.path).toMatch(/^act_111\/(campaigns|adsets|ads|insights)$/);
  });
});
