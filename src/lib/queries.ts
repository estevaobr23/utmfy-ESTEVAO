import "server-only";
import type { Db } from "./supabase/types";
import { dayRangeUtc, resolveRange, todayIn } from "./core/dates";
import { spendStatus } from "./core/spend-status";
import { attachPixelEvents, buildTree, pixelFunnelOf, totals, type OrderRow, type PixelEventRow, type SpendRow } from "./core/report";
import { scopeOfferSpendRows, scopeOfferSpendRowsByBindings, type OfferMetaBinding, type OfferSpendLink } from "./core/offer-spend-scope";
import { mergeBindings } from "./core/offer-pixel-scope";
import { loadPixelDerivation } from "./services/offer-auto-link";
import type { Workspace } from "./session";
import type { AdsetConfig, CampaignConfig, ReachLevel, VideoRow } from "./core/meta-advanced";
import { buildSummaryAnalytics, type SummaryAttribution, type SummaryOrder, type SummarySession } from "./core/summary";
import { timed } from "./perf";

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

export async function loadReport(sb: Db, ws: Workspace, f: Filters, options: { includeTree?: boolean } = {}) {
  return timed("report.load", { offerScoped: !!f.offer, includeTree: options.includeTree !== false }, async () => {
  const offers = f.offer ? [f.offer] : null;
  const [spend, orders, offerLinks, workspaceOfferLinks, bindingResult, excluded, pixelScope, pixelEvents] = await Promise.all([
    timed("report.spend", { offerScoped: !!f.offer }, () => sb.rpc("report_spend_rows", {
      // O escopo de oferta é aplicado abaixo por IDs persistentes. Conta sem
      // filtro só é aceita quando pertence exclusivamente a uma oferta.
      p_workspace: ws.id, p_offer_ids: null, p_from: f.from, p_to: f.to, p_currency: ws.currency,
      p_account_id: f.account, p_campaign_id: f.campaign, p_adset_id: f.adset, p_ad_id: f.ad,
    })),
    timed("report.orders", { offerScoped: !!f.offer }, () => sb.rpc("report_order_rows", {
      p_workspace: ws.id, p_offer_ids: offers, p_from: f.from, p_to: f.to, p_tz: ws.timezone, p_currency: ws.currency,
      p_source: f.source, p_campaign_id: f.campaign, p_adset_id: f.adset, p_ad_id: f.ad, p_status: f.status, p_account_id: f.account,
    })),
    f.offer
      ? sb.from("offer_ad_accounts").select("campaign_filter, meta_ad_accounts(account_id)").eq("offer_id", f.offer)
      : Promise.resolve({ data: [], error: null }),
    f.offer
      ? sb.from("offer_ad_accounts").select("offer_id, meta_ad_accounts(account_id)").eq("workspace_id", ws.id)
      : Promise.resolve({ data: [], error: null }),
    f.offer
      ? sb.from("offer_meta_bindings").select("offer_id, level, object_id, meta_ad_accounts(account_id)").eq("workspace_id", ws.id).eq("status", "confirmed")
      : Promise.resolve({ data: [], error: null }),
    timed("report.excluded", { offerScoped: !!f.offer }, () => sb.rpc("report_spend_excluded", { p_workspace: ws.id, p_from: f.from, p_to: f.to, p_currency: ws.currency })),
    f.offer ? loadPixelDerivation(sb, ws.id) : Promise.resolve(null),
    // Eventos do pixel (visualização de página / início de checkout). Opcional: sem a função, o funil usa o tracker.
    sb.rpc("report_pixel_rows", { p_workspace: ws.id, p_from: f.from, p_to: f.to, p_account_id: f.account, p_campaign_id: f.campaign, p_adset_id: f.adset, p_ad_id: f.ad }),
  ]);
  if (spend.error) throw new Error(`report_spend_rows: ${spend.error.message}`);
  if (orders.error) throw new Error(`report_order_rows: ${orders.error.message}`);
  if (offerLinks.error) throw new Error(`offer_ad_accounts: ${offerLinks.error.message}`);
  if (workspaceOfferLinks.error) throw new Error(`offer_ad_accounts ownership: ${workspaceOfferLinks.error.message}`);
  if (excluded.error) throw new Error(`report_spend_excluded: ${excluded.error.message}`);
  const rawSpendRows = attachPixelEvents((spend.data ?? []) as SpendRow[], pixelEvents.error ? null : ((pixelEvents.data ?? []) as PixelEventRow[]));
  const links = (offerLinks.data ?? []).map((row) => ({
    accountId: (row.meta_ad_accounts as unknown as { account_id: string } | null)?.account_id ?? "",
    campaignFilter: row.campaign_filter as string | null,
  })).filter((row): row is OfferSpendLink => !!row.accountId);
  const manualBindings = (bindingResult.data ?? []).map((row) => ({
    offerId: row.offer_id as string,
    accountId: (row.meta_ad_accounts as unknown as { account_id: string } | null)?.account_id ?? "",
    level: row.level as "campaign" | "adset",
    objectId: row.object_id as string,
  })).filter((row): row is OfferMetaBinding => !!row.accountId);
  // Pixel da oferta → conjuntos dela, automático. Sem pixel ligado a esta oferta, vale o que já existia.
  const pixelBindings = pixelScope?.bindings ?? [];
  const bindings = mergeBindings(manualBindings, pixelBindings);
  if (f.offer) {
    for (const accountId of new Set(pixelBindings.filter((b) => b.offerId === f.offer).map((b) => b.accountId))) {
      if (!links.some((link) => link.accountId === accountId)) links.push({ accountId, campaignFilter: null });
    }
  }
  const accountOfferIds = new Map<string, Set<string>>();
  for (const row of workspaceOfferLinks.data ?? []) {
    const accountId = (row.meta_ad_accounts as unknown as { account_id: string } | null)?.account_id ?? "";
    if (!accountId) continue;
    const offerIds = accountOfferIds.get(accountId) ?? new Set<string>();
    offerIds.add(row.offer_id as string);
    accountOfferIds.set(accountId, offerIds);
  }
  const exclusiveAccounts = links
    .map((link) => link.accountId)
    .filter((accountId) => accountOfferIds.get(accountId)?.size === 1);
  const scoped = f.offer
    ? bindingResult.error
      ? scopeOfferSpendRows(rawSpendRows, links, exclusiveAccounts)
      : scopeOfferSpendRowsByBindings(rawSpendRows, f.offer, links.map((link) => link.accountId), bindings, exclusiveAccounts)
    : { rows: rawSpendRows, pendingAccounts: [] as string[], confirmedAccounts: [] as string[] };
  const spendRows = scoped.rows;
  const orderRows = (orders.data ?? []) as OrderRow[];
  const pre = totals(spendRows, orderRows);
  const safeAccounts = new Set(scoped.confirmedAccounts);
  const excludedSpend = ((excluded.data ?? []) as { account_id: string; currency: string; spend: number }[])
    .filter((row) => !f.offer || safeAccounts.has(row.account_id));
  const [other, resolvedSpendStatus] = await Promise.all([
    timed("report.other_costs", { offerScoped: !!f.offer }, () => sb.rpc("report_other_costs", {
      p_workspace: ws.id, p_offer_ids: offers, p_from: f.from, p_to: f.to, p_gross: pre.gross_revenue, p_sales: pre.approved_count,
    })),
    timed("report.spend_status", { offerScoped: !!f.offer }, () => loadSpendStatus(sb, ws, f, excludedSpend, scoped.pendingAccounts)),
  ]);
  const summary = totals(spendRows, orderRows, Number(other.data ?? 0));
  return {
    summary,
    tree: options.includeTree === false ? [] : buildTree(spendRows, orderRows),
    spendRows,
    orderRows,
    /** Visualizações de página e ICs do pixel da Meta no escopo; null = sem coleta (funil usa o tracker). */
    pixelFunnel: pixelFunnelOf(spendRows),
    excludedSpend,
    spendStatus: resolvedSpendStatus,
    scopeStatus: {
      pendingAccounts: scoped.pendingAccounts,
      includedCampaigns: [...new Set(spendRows.map((row) => row.campaign_id))],
    },
  };
  });
}

export async function loadSummaryAnalytics(sb: Db, ws: Workspace, f: Filters, summary: ReturnType<typeof totals>, spendReliable = true, metaPixel: { pageviews: number; checkouts: number } | null = null) {
  return timed("summary.analytics", { offerScoped: !!f.offer }, async () => {
  const { start, end } = dayRangeUtc(f.from, f.to, ws.timezone);
  const fields = "id,status,gross_amount,base_amount,payment_method,product_name,offer_type,paid_at,provider_created_at";
  let paidQuery = sb.from("orders").select(fields)
    .eq("workspace_id", ws.id)
    .neq("source", "test")
    .in("status", ["paid", "refund_requested", "disputed", "refunded", "chargedback"])
    .gte("paid_at", start).lt("paid_at", end)
    .limit(5000);
  let attemptsQuery = sb.from("orders").select(fields)
    .eq("workspace_id", ws.id)
    .neq("source", "test")
    .gte("provider_created_at", start).lt("provider_created_at", end)
    .limit(5000);
  let sessionsQuery = sb.from("tracking_sessions").select("pageviews,checkout_clicks")
    .eq("workspace_id", ws.id)
    .gte("first_seen_at", start).lt("first_seen_at", end)
    .limit(5000);
  if (f.offer) {
    paidQuery = paidQuery.eq("offer_id", f.offer);
    attemptsQuery = attemptsQuery.eq("offer_id", f.offer);
    sessionsQuery = sessionsQuery.eq("offer_id", f.offer);
  }
  const [paidResult, attemptsResult, sessionsResult] = await Promise.all([paidQuery, attemptsQuery, sessionsQuery]);
  if (paidResult.error) throw new Error(`summary paid orders: ${paidResult.error.message}`);
  if (attemptsResult.error) throw new Error(`summary attempts: ${attemptsResult.error.message}`);
  if (sessionsResult.error) throw new Error(`summary sessions: ${sessionsResult.error.message}`);
  const paidOrders = (paidResult.data ?? []) as unknown as SummaryOrder[];
  const attempts = (attemptsResult.data ?? []) as unknown as SummaryOrder[];
  const ids = [...new Set([...paidOrders, ...attempts].map((order) => order.id))];
  const attributionResult = ids.length
    ? await sb.from("order_attribution").select("order_id,utm_source,attribution_status,account_id").in("order_id", ids)
    : { data: [], error: null };
  if (attributionResult.error) throw new Error(`summary attribution: ${attributionResult.error.message}`);
  const attributions = (attributionResult.data ?? []) as SummaryAttribution[];
  const attributionByOrder = new Map(attributions.map((item) => [item.order_id, item]));
  const orderMatches = (order: SummaryOrder) => {
    const attribution = attributionByOrder.get(order.id);
    if (f.account && attribution?.account_id !== f.account) return false;
    if (f.source && attribution?.utm_source?.toLocaleLowerCase("pt-BR") !== f.source.toLocaleLowerCase("pt-BR")) return false;
    return true;
  };
  const scopedPaid = paidOrders.filter(orderMatches);
  const scopedAttempts = attempts.filter(orderMatches);
  const scopedIds = new Set([...scopedPaid, ...scopedAttempts].map((order) => order.id));
  return buildSummaryAnalytics({
    paidOrders: scopedPaid,
    attempts: scopedAttempts,
    attributions: attributions.filter((item) => scopedIds.has(item.order_id)),
    sessions: (sessionsResult.data ?? []) as SummarySession[],
    clicks: spendReliable ? summary.clicks : null,
    metaPixel: spendReliable ? metaPixel : null,
    approvedCount: summary.approved_count,
  });
  });
}

async function loadSpendStatus(sb: Db, ws: Workspace, f: Filters, excluded: { account_id: string; currency: string; spend: number }[], pendingAssociations: string[]) {
  const accountsQ = f.offer
    ? sb.from("offer_ad_accounts").select("meta_ad_accounts(account_id, last_error)").eq("offer_id", f.offer)
    : sb.from("meta_ad_accounts").select("account_id, last_error").eq("workspace_id", ws.id).eq("active", true);
  const [accounts, jobs, pixelLinks] = await Promise.all([
    accountsQ,
    sb.from("sync_jobs").select("params").eq("workspace_id", ws.id).eq("kind", "meta_insights").in("status", ["success", "partial"]).order("started_at", { ascending: false }).limit(500),
    f.offer ? sb.from("offer_pixels").select("pixel_id", { count: "exact", head: true }).eq("offer_id", f.offer).eq("active", true) : Promise.resolve({ count: 0 }),
  ]);
  type Acc = { account_id: string; last_error: string | null };
  const rows = (accounts.data ?? []) as unknown[];
  const list = (f.offer ? rows.map((r) => (r as { meta_ad_accounts: Acc | null }).meta_ad_accounts).filter(Boolean) : rows) as Acc[];
  const scoped = f.account ? list.filter((a) => a.account_id === f.account) : list;
  const windows = (jobs.data ?? [])
    .map((j) => j.params as { since?: string; until?: string } | null)
    .filter((p): p is { since: string; until: string } => !!p?.since && !!p?.until);
  return spendStatus({ accounts: scoped, syncedWindows: windows, excluded, pendingAssociations, offerScope: !!f.offer, offerHasPixel: (pixelLinks.count ?? 0) > 0, from: f.from, to: f.to, today: todayIn(ws.timezone) });
}

/**
 * Orçamento/lance, vídeo e alcance deduplicado. Opcional: se as tabelas ainda
 * não existirem (migration pendente) ou a consulta falhar, volta vazio e a
 * interface mostra N/D — nunca derruba gasto/vendas.
 */
export async function loadMetaAdvanced(sb: Db, ws: Workspace, f: Filters) {
  const [campaigns, adsets, video, reach, fxRows, fxAccounts] = await Promise.all([
    sb.from("meta_campaigns").select("account_id, campaign_id, name, effective_status, daily_budget_minor, lifetime_budget_minor, bid_strategy, currency, meta_updated_time").eq("workspace_id", ws.id).limit(5000),
    sb.from("meta_adsets").select("account_id, campaign_id, adset_id, name, effective_status, daily_budget_minor, lifetime_budget_minor, bid_strategy, bid_amount_minor, bid_constraints, optimization_goal, billing_event, promoted_object, currency, meta_updated_time").eq("workspace_id", ws.id).limit(5000),
    sb.rpc("report_video_rows", { p_workspace: ws.id, p_from: f.from, p_to: f.to, p_account_id: f.account }),
    sb.from("meta_reach_period").select("level, object_id, reach, frequency").eq("workspace_id", ws.id).eq("since", f.from).eq("until", f.to).limit(10000),
    sb.from("fx_rates").select("currency, rate").order("date", { ascending: false }).limit(60),
    sb.from("meta_ad_accounts").select("currency, fx_rate").eq("workspace_id", ws.id),
  ]);
  const errors = [campaigns.error, adsets.error, video.error, reach.error].filter(Boolean).map((e) => e!.message);
  // Orçamento e lance aparecem na moeda do workspace: PTAX mais recente (a mesma do gasto); câmbio manual da conta se não houver.
  const rates: Record<string, number> = {};
  for (const row of fxAccounts.data ?? []) if (row.currency && Number(row.fx_rate) > 0) rates[row.currency as string] = Number(row.fx_rate);
  const seen = new Set<string>();
  for (const row of fxRows.data ?? []) {
    const currency = row.currency as string;
    if (seen.has(currency) || !(Number(row.rate) > 0)) continue;
    seen.add(currency);
    rates[currency] = Number(row.rate);
  }
  return {
    fx: { target: ws.currency, rates },
    campaigns: (campaigns.data ?? []) as CampaignConfig[],
    adsets: (adsets.data ?? []) as AdsetConfig[],
    video: (video.data ?? []) as VideoRow[],
    reach: (reach.data ?? []) as { level: ReachLevel; object_id: string; reach: number | null; frequency: number | string | null }[],
    errors,
  };
}

export async function listOffers(sb: Db, wsId: string) {
  const { data } = await sb.from("offers").select("id, name, slug, status, currency, checkout_url, landing_url, created_at").eq("workspace_id", wsId).order("created_at");
  return data ?? [];
}

export async function listAccounts(sb: Db, wsId: string) {
  const { data } = await sb.from("meta_ad_accounts").select("id, account_id, account_name, currency, timezone, active, last_sync_at, last_error").eq("workspace_id", wsId).order("account_name");
  return data ?? [];
}

export async function listOfferAccounts(sb: Db, offerId: string) {
  const { data, error } = await sb
    .from("offer_ad_accounts")
    .select("campaign_filter, meta_ad_accounts(id, account_id, account_name, currency, timezone, active, last_sync_at, last_error)")
    .eq("offer_id", offerId);
  if (error) throw new Error(`offer_ad_accounts: ${error.message}`);
  type Account = Awaited<ReturnType<typeof listAccounts>>[number] & { campaign_filter: string | null };
  return (data ?? [])
    .map((row) => ({ ...(row.meta_ad_accounts as unknown as Omit<Account, "campaign_filter">), campaign_filter: row.campaign_filter as string | null }))
    .filter((row): row is Account => !!row.account_id);
}

/** Opções dos filtros de campanha/conjunto/anúncio a partir do catálogo. */
export async function catalogOptions(sb: Db, wsId: string, f: Filters) {
  return timed("catalog.options", { accountScoped: !!f.account }, async () => {
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
  });
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
