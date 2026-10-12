import "server-only";
import type { Db } from "../supabase/types";
import { hint } from "../core/hash";
import { chunkRange, INSIGHTS_FIELDS, normalizeAccountId, normalizeInsight, type RawInsight } from "../core/meta";
import { addDays, todayIn } from "../core/dates";
import { mapPool } from "../core/concurrency";
import {
  ADSET_FIELDS, CAMPAIGN_FIELDS, REACH_LEVELS, VIDEO_INSIGHTS_FIELDS, creativeHasVideo, hasVideoData, normalizeAdset,
  normalizeCampaign, normalizeReach, normalizeVideoInsight, reachCutoff, reachWindows, rejectedField,
  type AdsetConfig, type CampaignConfig, type RawAdset, type RawCampaign, type RawReach, type RawVideoInsight, type VideoDailyRow,
} from "../core/meta-advanced";
import { env } from "../env";
import { ensureFxRates } from "./fx";
import { finishJob, logEvent, startJob } from "./logs";
import { MetaApiError, MetaClient } from "./meta-client";
import { reattributePending } from "./orders";
import { autoLinkOfferAccounts } from "./offer-auto-link";

// Sincronização READ-ONLY: contas → catálogo de anúncios → insights diários
// (nível anúncio). Estratégia: hoje + ontem a cada execução e retroativo de
// META_LOOKBACK_DAYS (padrão 3) para capturar revisões da Meta. Tudo é upsert.

type Conn = { id: string; workspace_id: string; token_source: string; status: string };

export async function getMetaToken(db: Db, conn: Conn): Promise<string | null> {
  if (conn.token_source === "env") return env.metaAccessToken || null;
  const { data, error } = await db.rpc("read_secret", { p_owner_type: "meta_connection", p_owner_id: conn.id });
  if (error) return null;
  return (data as string | null) ?? null;
}

/** Garante uma conexão "env" quando META_ACCESS_TOKEN existe. */
export async function ensureEnvConnection(db: Db, workspaceId: string) {
  const { data } = await db.from("meta_connections").select("id, workspace_id, token_source, status").eq("workspace_id", workspaceId).order("created_at");
  if (data && data.length) return data as Conn[];
  if (!env.metaAccessToken) return [];
  const { data: created } = await db
    .from("meta_connections")
    .insert({ workspace_id: workspaceId, name: "Meta (token de ambiente)", token_source: "env", token_hint: hint(env.metaAccessToken, 4), status: "pending" })
    .select("id, workspace_id, token_source, status");
  return (created ?? []) as Conn[];
}

async function markConnection(db: Db, conn: Conn, e: unknown) {
  if (e instanceof MetaApiError && (e.kind === "token_expired" || e.kind === "no_permission")) {
    await db.from("meta_connections").update({ status: e.kind, last_error: e.message.slice(0, 300) }).eq("id", conn.id);
  } else {
    await db.from("meta_connections").update({ status: "error", last_error: (e as Error).message.slice(0, 300) }).eq("id", conn.id);
  }
}

export async function discoverAccounts(db: Db, workspaceId: string, trigger: "manual" | "cron" = "manual") {
  const jobId = await startJob(db, workspaceId, "meta_accounts", trigger);
  const conns = await ensureEnvConnection(db, workspaceId);
  const stats = { connections: conns.length, accounts: 0, created: 0 };
  if (!conns.length) {
    await finishJob(db, jobId, "failed", stats, "Nenhuma conexão Meta (defina META_ACCESS_TOKEN ou conecte via OAuth)");
    return { error: "no_connection", stats };
  }
  for (const conn of conns) {
    const token = await getMetaToken(db, conn);
    if (!token) {
      await db.from("meta_connections").update({ status: "error", last_error: "Token indisponível" }).eq("id", conn.id);
      continue;
    }
    const client = new MetaClient(token);
    try {
      const me = await client.get<{ name?: string }>("me", { fields: "name" });
      const accounts = await client.getAll<{ account_id: string; name?: string; currency?: string; timezone_name?: string; account_status?: number }>(
        "me/adaccounts",
        { fields: "account_id,name,currency,timezone_name,account_status", limit: 200 },
      );
      const { data: known } = await db.from("meta_ad_accounts").select("account_id").eq("workspace_id", workspaceId);
      const knownIds = new Set((known ?? []).map((k) => k.account_id as string));
      for (const a of accounts) {
        const accountId = normalizeAccountId(a.account_id);
        const row = {
          workspace_id: workspaceId,
          connection_id: conn.id,
          account_id: accountId,
          account_name: a.name ?? null,
          currency: a.currency ?? null,
          timezone: a.timezone_name ?? null,
          account_status: a.account_status ?? null,
        };
        // Conta nova e ativa na Meta já entra monitorada; a escolha do usuário em contas existentes é preservada.
        if (knownIds.has(accountId)) {
          await db.from("meta_ad_accounts").update(row).eq("workspace_id", workspaceId).eq("account_id", accountId);
        } else {
          await db.from("meta_ad_accounts").insert({ ...row, active: a.account_status === 1 });
          stats.created++;
        }
      }
      stats.accounts += accounts.length;
      await db.from("meta_connections").update({ status: "active", last_error: null, meta_user_name: me.name ?? null }).eq("id", conn.id);
    } catch (e) {
      await markConnection(db, conn, e);
      await logEvent(db, { workspaceId, level: "error", code: "META_ACCOUNTS_FAILED", provider: "meta", message: (e as Error).message, context: { reason: e instanceof MetaApiError ? e.kind : "exception" } });
      await finishJob(db, jobId, "failed", stats, (e as Error).message);
      return { error: (e as Error).message, stats };
    }
  }
  await finishJob(db, jobId, "success", stats);
  return { stats };
}

export type AccountRow = { id: string; account_id: string; connection_id: string | null; timezone: string | null; currency: string | null };

async function syncAccount(db: Db, workspaceId: string, client: MetaClient, acc: AccountRow, since: string, until: string) {
  const stats = { ads: 0, insights: 0 };
  // 1) catálogo (campanha → conjunto → anúncio), inclusive anúncios sem gasto
  const ads = await client.getAll<{ id: string; name?: string; effective_status?: string; adset?: { id: string; name?: string }; campaign?: { id: string; name?: string } }>(
    `act_${acc.account_id}/ads`,
    { fields: "id,name,effective_status,adset{id,name},campaign{id,name}", limit: 500 },
    50,
  );
  const catalog = ads
    .filter((a) => a.adset?.id && a.campaign?.id)
    .map((a) => ({
      workspace_id: workspaceId,
      account_id: acc.account_id,
      campaign_id: a.campaign!.id,
      campaign_name: a.campaign!.name ?? null,
      adset_id: a.adset!.id,
      adset_name: a.adset!.name ?? null,
      ad_id: a.id,
      ad_name: a.name ?? null,
      effective_status: a.effective_status ?? null,
      updated_at: new Date().toISOString(),
    }));
  for (let i = 0; i < catalog.length; i += 500) {
    const { error } = await db.from("meta_ads").upsert(catalog.slice(i, i + 500), { onConflict: "workspace_id,ad_id" });
    if (error) throw new Error(`meta_ads: ${error.message}`);
  }
  stats.ads = catalog.length;

  // 2) insights diários por anúncio; períodos grandes → relatório assíncrono
  const base = { level: "ad", time_increment: 1, fields: INSIGHTS_FIELDS.join(","), limit: 500 };
  for (const win of chunkRange(since, until, 31)) {
    const days = Math.round((new Date(win.until).getTime() - new Date(win.since).getTime()) / 864e5) + 1;
    const params = { ...base, time_range: JSON.stringify({ since: win.since, until: win.until }) };
    const raw = days > 7 ? await client.insightsAsync<RawInsight>(acc.account_id, params) : await client.getAll<RawInsight>(`act_${acc.account_id}/insights`, params);
    const rows = raw
      .map(normalizeInsight)
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({ ...r, workspace_id: workspaceId, imported_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("meta_insights_daily").upsert(rows.slice(i, i + 500), { onConflict: "workspace_id,account_id,ad_id,date" });
      if (error) throw new Error(`meta_insights_daily: ${error.message}`);
    }
    // nomes que aparecem só nos insights (anúncios apagados) também entram no catálogo
    const extra = rows.map((r) => ({
      workspace_id: workspaceId, account_id: r.account_id, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
      adset_id: r.adset_id, adset_name: r.adset_name, ad_id: r.ad_id, ad_name: r.ad_name,
    }));
    const unique = [...new Map(extra.map((e) => [e.ad_id, e])).values()].filter((e) => !catalog.some((c) => c.ad_id === e.ad_id));
    if (unique.length) await db.from("meta_ads").upsert(unique, { onConflict: "workspace_id,ad_id", ignoreDuplicates: true });
    stats.insights += rows.length;
  }
  return stats;
}

type AdvancedStats = {
  campaigns: number; adsets: number; creatives: number; video_rows: number; video_saved: number;
  video_not_applicable: number; reach_rows: number; failures: { step: string; reason: string; message: string }[];
};

async function upsertChunks(db: Db, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** Insights com remoção de campo rejeitado pela Graph (código 100), até 3 tentativas. */
async function insightsWithFallback<T>(client: MetaClient, acc: AccountRow, fields: string[], params: Record<string, string | number>, days: number) {
  let current = [...fields];
  const dropped: string[] = [];
  for (let attempt = 0; ; attempt++) {
    const p = { ...params, fields: current.join(",") };
    try {
      const rows = days > 7 ? await client.insightsAsync<T>(acc.account_id, p) : await client.getAll<T>(`act_${acc.account_id}/insights`, p);
      return { rows, dropped };
    } catch (e) {
      const field = e instanceof MetaApiError && e.kind === "invalid_request" ? rejectedField(e.message, current) : null;
      if (!field || attempt >= 3) throw e;
      dropped.push(field);
      current = current.filter((f) => f !== field);
    }
  }
}

/**
 * Coletas opcionais (orçamento, lance, criativo, vídeo, alcance por período).
 * Cada etapa é isolada: falha vira aviso e NÃO afeta gasto/vendas já salvos.
 */
export async function syncAdvanced(db: Db, workspaceId: string, client: MetaClient, acc: AccountRow, since: string, until: string, tz: string): Promise<AdvancedStats> {
  const stats: AdvancedStats = { campaigns: 0, adsets: 0, creatives: 0, video_rows: 0, video_saved: 0, video_not_applicable: 0, reach_rows: 0, failures: [] };
  const now = () => new Date().toISOString();
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      const reason = e instanceof MetaApiError ? e.kind : "exception";
      stats.failures.push({ step: name, reason, message: (e as Error).message.slice(0, 200) });
      await logEvent(db, { workspaceId, level: "warn", code: "META_ADVANCED_SYNC_FAILED", provider: "meta", message: (e as Error).message, context: { account_id: acc.account_id, step: name, reason } });
    }
  };

  // As etapas são independentes (tabelas e chamadas diferentes) e isoladas por `step`: rodam juntas.
  const sCampaigns = step("campaigns", async () => {
    const raw = await client.getAll<RawCampaign>(`act_${acc.account_id}/campaigns`, { fields: CAMPAIGN_FIELDS, limit: 500 }, 50);
    const rows = raw.map((r) => normalizeCampaign(r, acc.account_id, acc.currency)).filter((r): r is CampaignConfig => !!r)
      .map((r) => ({ ...r, workspace_id: workspaceId, synced_at: now() }));
    await upsertChunks(db, "meta_campaigns", rows, "workspace_id,campaign_id");
    stats.campaigns = rows.length;
  });

  const sAdsets = step("adsets", async () => {
    const raw = await client.getAll<RawAdset>(`act_${acc.account_id}/adsets`, { fields: ADSET_FIELDS, limit: 500 }, 50);
    const rows = raw.map((r) => normalizeAdset(r, acc.account_id, acc.currency)).filter((r): r is AdsetConfig => !!r)
      .map((r) => ({ ...r, workspace_id: workspaceId, synced_at: now() }));
    await upsertChunks(db, "meta_adsets", rows, "workspace_id,adset_id");
    stats.adsets = rows.length;
  });

  const sCreatives = step("creatives", async () => {
    const raw = await client.getAll<{ id: string; campaign?: { id: string }; adset?: { id: string }; creative?: { object_type?: string; video_id?: string } }>(
      `act_${acc.account_id}/ads`, { fields: "id,campaign{id},adset{id},creative{object_type,video_id}", limit: 500 }, 50);
    const rows = raw.filter((a) => a.campaign?.id && a.adset?.id).map((a) => ({
      workspace_id: workspaceId, account_id: acc.account_id, campaign_id: a.campaign!.id, adset_id: a.adset!.id, ad_id: a.id,
      creative_type: a.creative?.object_type ?? null, has_video: creativeHasVideo(a.creative),
    }));
    await upsertChunks(db, "meta_ads", rows, "workspace_id,ad_id");
    stats.creatives = rows.length;
  });

  const sVideo = step("video", async () => {
    for (const win of chunkRange(since, until, 31)) {
      const days = Math.round((new Date(win.until).getTime() - new Date(win.since).getTime()) / 864e5) + 1;
      const { rows: raw, dropped } = await insightsWithFallback<RawVideoInsight>(client, acc, VIDEO_INSIGHTS_FIELDS, {
        level: "ad", time_increment: 1, limit: 500, time_range: JSON.stringify({ since: win.since, until: win.until }),
      }, days);
      if (dropped.length) stats.failures.push({ step: "video", reason: "field_rejected", message: dropped.join(",") });
      const rows = raw.map(normalizeVideoInsight).filter((r): r is VideoDailyRow => !!r);
      const withVideo = rows.filter(hasVideoData);
      stats.video_rows += rows.length;
      stats.video_not_applicable += rows.length - withVideo.length;
      await upsertChunks(db, "meta_video_daily", withVideo.map((r) => ({ ...r, workspace_id: workspaceId, imported_at: now() })), "workspace_id,account_id,ad_id,date");
      stats.video_saved += withVideo.length;
    }
  });

  const sReach = step("reach", async () => {
    const today = todayIn(tz);
    const { data: known } = await db.from("meta_reach_period").select("since, until").eq("workspace_id", workspaceId).eq("account_id", acc.account_id).eq("level", "account");
    const have = new Set((known ?? []).map((k) => `${k.since}|${k.until}`));
    // Período já encerrado antes da janela desta sincronização e já salvo não muda mais.
    const windows = reachWindows(tz).filter((w) => !(w.until < since && have.has(`${w.since}|${w.until}`)));
    // Período × nível são consultas independentes: até 6 em paralelo (eram ~24 em fila, ~20 s).
    const jobs = windows.flatMap((w) => REACH_LEVELS.map((level) => ({ w, level })));
    await mapPool(jobs, 6, async ({ w, level }) => {
      const idField = level === "account" ? "account_id" : `${level}_id`;
      const raw = await client.getAll<RawReach>(`act_${acc.account_id}/insights`, {
        level, fields: [...new Set(["account_id", idField, "impressions", "reach", "frequency"])].join(","),
        time_range: JSON.stringify({ since: w.since, until: w.until }), limit: 500,
      }, 20);
      const rows = raw.map((r) => normalizeReach(r, level, w.since, w.until)).filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({ ...r, workspace_id: workspaceId, fetched_at: now() }));
      await upsertChunks(db, "meta_reach_period", rows, "workspace_id,level,object_id,since,until");
      stats.reach_rows += rows.length;
    });
    await db.from("meta_reach_period").delete().eq("workspace_id", workspaceId).eq("account_id", acc.account_id).lt("until", reachCutoff(today));
  });

  await Promise.all([sCampaigns, sAdsets, sCreatives, sVideo, sReach]);

  await logEvent(db, {
    workspaceId, level: stats.failures.length ? "warn" : "info", code: "META_ADVANCED_SYNC", provider: "meta",
    message: `campanhas ${stats.campaigns} · conjuntos ${stats.adsets} · vídeo ${stats.video_saved}/${stats.video_rows} · alcance ${stats.reach_rows}`,
    context: { account_id: acc.account_id, since, until, ...stats },
  });
  return stats;
}

/** Sincroniza todas as contas monitoradas (active=true) do workspace. */
export async function syncMeta(
  db: Db,
  workspaceId: string,
  opts: { since?: string; until?: string; trigger: "manual" | "cron"; accountIds?: string[] },
) {
  const { data: ws } = await db.from("workspaces").select("timezone, currency").eq("id", workspaceId).maybeSingle();
  const today = todayIn(ws?.timezone ?? "America/Sao_Paulo");
  const since = opts.since ?? addDays(today, -env.metaLookbackDays);
  const until = opts.until ?? today;

  // Contas novas na Meta entram sozinhas (sem depender de clique em "Descobrir contas").
  // No botão "Atualizar" não repete a descoberta se ela já rodou há pouco (o cron sempre roda).
  const recent = opts.trigger === "manual"
    ? (await db.from("sync_jobs").select("id").eq("workspace_id", workspaceId).eq("kind", "meta_accounts").eq("status", "success")
        .gte("started_at", new Date(Date.now() - 30 * 60_000).toISOString()).limit(1)).data?.length
    : 0;
  const discovered = recent ? { stats: { skipped: "recent" } as Record<string, unknown> } : await discoverAccounts(db, workspaceId, opts.trigger);

  const jobId = await startJob(db, workspaceId, "meta_insights", opts.trigger, { since, until });
  const stats: Record<string, unknown> = { accounts: 0, ads: 0, insights: 0, failed: [] as string[], discovered: discovered.stats, advanced: {} };

  const conns = await ensureEnvConnection(db, workspaceId);
  let q = db.from("meta_ad_accounts").select("id, account_id, connection_id, timezone, currency").eq("workspace_id", workspaceId).eq("active", true);
  if (opts.accountIds?.length) q = q.in("account_id", opts.accountIds);
  const { data: accounts } = await q;
  if (!accounts?.length) {
    await finishJob(db, jobId, "failed", stats, "Nenhuma conta de anúncio monitorada");
    return { jobId, stats, error: "no_active_accounts" };
  }

  const clients = new Map<string, MetaClient>();
  for (const acc of accounts as AccountRow[]) {
    const conn = conns.find((c) => c.id === acc.connection_id) ?? conns[0];
    if (!conn) continue;
    let client = clients.get(conn.id);
    if (!client) {
      const token = await getMetaToken(db, conn);
      if (!token) {
        (stats.failed as string[]).push(acc.account_id);
        await logEvent(db, { workspaceId, level: "error", code: "META_SYNC_FAILED", provider: "meta", message: "token indisponível", context: { account_id: acc.account_id, reason: "no_token" } });
        continue;
      }
      client = new MetaClient(token);
      clients.set(conn.id, client);
    }
    try {
      const s = await syncAccount(db, workspaceId, client, acc, since, until);
      stats.accounts = (stats.accounts as number) + 1;
      stats.ads = (stats.ads as number) + s.ads;
      stats.insights = (stats.insights as number) + s.insights;
      const adv = await syncAdvanced(db, workspaceId, client, acc, since, until, ws?.timezone ?? "America/Sao_Paulo");
      (stats.advanced as Record<string, AdvancedStats>)[acc.account_id] = adv;
      await db.from("meta_ad_accounts").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("id", acc.id);
      await db.from("meta_connections").update({ status: "active", last_sync_at: new Date().toISOString(), last_error: null }).eq("id", conn.id);
    } catch (e) {
      (stats.failed as string[]).push(acc.account_id);
      const reason = e instanceof MetaApiError ? e.kind : "exception";
      await db.from("meta_ad_accounts").update({ last_error: `${reason}: ${(e as Error).message}`.slice(0, 300) }).eq("id", acc.id);
      if (reason === "token_expired") await markConnection(db, conn, e);
      await logEvent(db, { workspaceId, level: "error", code: "META_SYNC_FAILED", provider: "meta", message: (e as Error).message, context: { account_id: acc.account_id, reason } });
      if (reason === "token_expired") break;
    }
  }

  const wsCurrency = ws?.currency ?? "BRL";
  const foreign = [...new Set((accounts as AccountRow[]).map((a) => a.currency).filter((c): c is string => !!c && c !== wsCurrency))];
  if (wsCurrency === "BRL") {
    for (const cur of foreign) {
      try {
        // PTAX só muda 1× por dia útil: não busca de novo se a cotação foi baixada há menos de 6 h e a janela é recente.
        const { data: lastFx } = await db.from("fx_rates").select("fetched_at").eq("currency", cur).order("fetched_at", { ascending: false }).limit(1);
        const fresh = lastFx?.[0]?.fetched_at && Date.now() - new Date(lastFx[0].fetched_at as string).getTime() < 6 * 3600_000;
        if (fresh && since >= addDays(today, -7)) { stats[`fx_${cur}`] = "fresh"; continue; }
        stats[`fx_${cur}`] = (await ensureFxRates(db, cur, since, until)).fetched;
      } catch (e) {
        await logEvent(db, { workspaceId, level: "error", code: "FX_FETCH_FAILED", provider: "bcb", message: (e as Error).message, context: { currency: cur, since, until } });
      }
    }
  }

  // Oferta ↔ conta de anúncio sai do pixel: campanha nova com o pixel da oferta entra sozinha.
  stats.auto_linked = await autoLinkOfferAccounts(db, workspaceId).catch(async (e) => {
    await logEvent(db, { workspaceId, level: "warn", code: "OFFER_AUTO_LINK_FAILED", provider: "meta", message: (e as Error).message });
    return 0;
  });

  const re = await reattributePending(db, workspaceId).catch(() => ({ checked: 0, resolved: 0 }));
  stats.reattributed = re;
  const failed = (stats.failed as string[]).length;
  await finishJob(db, jobId, failed === 0 ? "success" : failed < accounts.length ? "partial" : "failed", stats);
  return { jobId, stats };
}
