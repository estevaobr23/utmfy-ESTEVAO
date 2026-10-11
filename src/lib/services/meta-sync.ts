import "server-only";
import type { Db } from "../supabase/types";
import { hint } from "../core/hash";
import { chunkRange, INSIGHTS_FIELDS, normalizeAccountId, normalizeInsight, type RawInsight } from "../core/meta";
import { addDays, todayIn } from "../core/dates";
import { env } from "../env";
import { finishJob, logEvent, startJob } from "./logs";
import { MetaApiError, MetaClient } from "./meta-client";
import { reattributePending } from "./orders";

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
  const stats = { connections: conns.length, accounts: 0 };
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
      for (const a of accounts) {
        await db.from("meta_ad_accounts").upsert(
          {
            workspace_id: workspaceId,
            connection_id: conn.id,
            account_id: normalizeAccountId(a.account_id),
            account_name: a.name ?? null,
            currency: a.currency ?? null,
            timezone: a.timezone_name ?? null,
            account_status: a.account_status ?? null,
          },
          { onConflict: "workspace_id,account_id" },
        );
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

type AccountRow = { id: string; account_id: string; connection_id: string | null; timezone: string | null };

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

/** Sincroniza todas as contas monitoradas (active=true) do workspace. */
export async function syncMeta(
  db: Db,
  workspaceId: string,
  opts: { since?: string; until?: string; trigger: "manual" | "cron"; accountIds?: string[] },
) {
  const { data: ws } = await db.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle();
  const today = todayIn(ws?.timezone ?? "America/Sao_Paulo");
  const since = opts.since ?? addDays(today, -env.metaLookbackDays);
  const until = opts.until ?? today;
  const jobId = await startJob(db, workspaceId, "meta_insights", opts.trigger, { since, until });
  const stats: Record<string, unknown> = { accounts: 0, ads: 0, insights: 0, failed: [] as string[] };

  const conns = await ensureEnvConnection(db, workspaceId);
  let q = db.from("meta_ad_accounts").select("id, account_id, connection_id, timezone").eq("workspace_id", workspaceId).eq("active", true);
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

  const re = await reattributePending(db, workspaceId).catch(() => ({ checked: 0, resolved: 0 }));
  stats.reattributed = re;
  const failed = (stats.failed as string[]).length;
  await finishJob(db, jobId, failed === 0 ? "success" : failed < accounts.length ? "partial" : "failed", stats);
  return { jobId, stats };
}
