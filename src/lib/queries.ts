import "server-only";
import type { Db } from "./supabase/types";
import { resolveRange, todayIn } from "./core/dates";
import { spendStatus } from "./core/spend-status";
import { buildTree, totals, type OrderRow, type SpendRow } from "./core/report";
import type { Workspace } from "./session";

// Consultas da interface. Toda métrica passa por core/metrics.ts (via report.ts).

export type Filters = {
  from: string;
  to: string;
  preset: string;
  offer: string | null;
  account: string | null;
  source: string | null;
  campaign: string | null;
  adset: string | null;
  ad: string | null;
  status: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[0-9]{1,30}$/;
const STATUSES = ["pending", "refused", "canceled", "paid", "refund_requested", "disputed", "refunded", "chargedback"];

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseFilters(sp: SP, tz: string, fixedOffer?: string): Filters {
  const range = resolveRange({ preset: one(sp.preset), from: one(sp.from), to: one(sp.to) }, tz);
  const offer = fixedOffer ?? one(sp.offer);
  const src = one(sp.source).trim();
  return {
    ...range,
    offer: UUID.test(offer) ? offer : null,
    account: ID.test(one(sp.account)) ? one(sp.account) : null,
    source: src && src.length <= 60 ? src : null,
    campaign: ID.test(one(sp.campaign)) ? one(sp.campaign) : null,
    adset: ID.test(one(sp.adset)) ? one(sp.adset) : null,
    ad: ID.test(one(sp.ad)) ? one(sp.ad) : null,
    status: STATUSES.includes(one(sp.status)) ? one(sp.status) : null,
  };
}

export async function loadReport(sb: Db, ws: Workspace, f: Filters) {
  const offers = f.offer ? [f.offer] : null;
  const [spend, orders] = await Promise.all([
    sb.rpc("report_spend_rows", {
      p_workspace: ws.id, p_offer_ids: offers, p_from: f.from, p_to: f.to, p_currency: ws.currency,
      p_account_id: f.account, p_campaign_id: f.campaign, p_adset_id: f.adset, p_ad_id: f.ad,
    }),
    sb.rpc("report_order_rows", {
      p_workspace: ws.id, p_offer_ids: offers, p_from: f.from, p_to: f.to, p_tz: ws.timezone, p_currency: ws.currency,
      p_source: f.source, p_campaign_id: f.campaign, p_adset_id: f.adset, p_ad_id: f.ad, p_status: f.status, p_account_id: f.account,
    }),
  ]);
  if (spend.error) throw new Error(`report_spend_rows: ${spend.error.message}`);
  if (orders.error) throw new Error(`report_order_rows: ${orders.error.message}`);
  const spendRows = (spend.data ?? []) as SpendRow[];
  const orderRows = (orders.data ?? []) as OrderRow[];
  const pre = totals(spendRows, orderRows);
  const { data: other } = await sb.rpc("report_other_costs", {
    p_workspace: ws.id, p_offer_ids: offers, p_from: f.from, p_to: f.to, p_gross: pre.gross_revenue, p_sales: pre.approved_count,
  });
  const summary = totals(spendRows, orderRows, Number(other ?? 0));
  const { data: excluded } = await sb.rpc("report_spend_excluded", { p_workspace: ws.id, p_from: f.from, p_to: f.to, p_currency: ws.currency });
  const excludedSpend = (excluded ?? []) as { account_id: string; currency: string; spend: number }[];
  return {
    summary,
    tree: buildTree(spendRows, orderRows),
    spendRows,
    orderRows,
    excludedSpend,
    spendStatus: await loadSpendStatus(sb, ws, f, excludedSpend),
  };
}

async function loadSpendStatus(sb: Db, ws: Workspace, f: Filters, excluded: { account_id: string; currency: string; spend: number }[]) {
  const accountsQ = f.offer
    ? sb.from("offer_ad_accounts").select("meta_ad_accounts(account_id, last_error)").eq("offer_id", f.offer)
    : sb.from("meta_ad_accounts").select("account_id, last_error").eq("workspace_id", ws.id).eq("active", true);
  const [accounts, jobs] = await Promise.all([
    accountsQ,
    sb.from("sync_jobs").select("params").eq("workspace_id", ws.id).eq("kind", "meta_insights").in("status", ["success", "partial"]).order("started_at", { ascending: false }).limit(500),
  ]);
  type Acc = { account_id: string; last_error: string | null };
  const rows = (accounts.data ?? []) as unknown[];
  const list = (f.offer ? rows.map((r) => (r as { meta_ad_accounts: Acc | null }).meta_ad_accounts).filter(Boolean) : rows) as Acc[];
  const scoped = f.account ? list.filter((a) => a.account_id === f.account) : list;
  const windows = (jobs.data ?? [])
    .map((j) => j.params as { since?: string; until?: string } | null)
    .filter((p): p is { since: string; until: string } => !!p?.since && !!p?.until);
  return spendStatus({ accounts: scoped, syncedWindows: windows, excluded, from: f.from, to: f.to, today: todayIn(ws.timezone) });
}

export async function listOffers(sb: Db, wsId: string) {
  const { data } = await sb.from("offers").select("id, name, slug, status, currency, checkout_url, landing_url, created_at").eq("workspace_id", wsId).order("created_at");
  return data ?? [];
}

export async function listAccounts(sb: Db, wsId: string) {
  const { data } = await sb.from("meta_ad_accounts").select("id, account_id, account_name, currency, timezone, active, last_sync_at, last_error").eq("workspace_id", wsId).order("account_name");
  return data ?? [];
}

/** Opções dos filtros de campanha/conjunto/anúncio a partir do catálogo. */
export async function catalogOptions(sb: Db, wsId: string, f: Filters) {
  let q = sb.from("meta_ads").select("campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name").eq("workspace_id", wsId).limit(2000);
  if (f.account) q = q.eq("account_id", f.account);
  const { data } = await q;
  const rows = data ?? [];
  const uniq = (key: "campaign" | "adset" | "ad", filter?: (r: (typeof rows)[number]) => boolean) =>
    [...new Map(rows.filter(filter ?? (() => true)).map((r) => [r[`${key}_id`], r[`${key}_name`] ?? r[`${key}_id`]])).entries()].map(([id, name]) => ({ id, name }));
  return {
    campaigns: uniq("campaign"),
    adsets: uniq("adset", (r) => !f.campaign || r.campaign_id === f.campaign),
    ads: uniq("ad", (r) => (!f.campaign || r.campaign_id === f.campaign) && (!f.adset || r.adset_id === f.adset)),
  };
}

export function filtersToQuery(f: Partial<Filters>, extra: Record<string, string | null | undefined> = {}) {
  const q = new URLSearchParams();
  const put = (k: string, v: string | null | undefined) => v && q.set(k, v);
  if (f.preset === "custom") {
    put("from", f.from);
    put("to", f.to);
  } else put("preset", f.preset);
  put("offer", f.offer);
  put("account", f.account);
  put("source", f.source);
  put("campaign", f.campaign);
  put("adset", f.adset);
  put("ad", f.ad);
  put("status", f.status);
  for (const [k, v] of Object.entries(extra)) put(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
