import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attribute, type Catalog, type CatalogAd, type SessionTouch } from "../core/attribution";
import type { NormalizedOrder } from "../core/cakto/normalize";
import { purchaseEventId } from "../core/capi";
import { parseUtms, type UtmInput } from "../core/utm";
import { logEvent } from "./logs";

// Caminho ÚNICO de gravação de pedido: webhook, sync da API, reconciliação e
// demo passam por aqui → mesma normalização, mesma máquina de estados, mesma
// atribuição.

export type IngestResult = {
  orderId: string;
  inserted: boolean;
  applied: boolean;
  previousStatus: string | null;
  status: string;
  reason: string | null;
  offerId: string | null;
  attribution: string;
};

type Source = "webhook" | "api_sync" | "reconcile" | "demo" | "test";

/** Oferta interna a partir do produto/oferta Cakto (oferta Cakto específica > produto inteiro). */
export async function resolveOffer(db: SupabaseClient, workspaceId: string, productId: string | null, offerId: string | null) {
  if (!productId && !offerId) return null;
  const { data } = await db
    .from("offer_cakto_items")
    .select("offer_id, cakto_product_id, cakto_offer_id")
    .eq("workspace_id", workspaceId)
    .or(
      [productId ? `cakto_product_id.eq.${encodeFilter(productId)}` : null, offerId ? `cakto_offer_id.eq.${encodeFilter(offerId)}` : null]
        .filter(Boolean)
        .join(","),
    );
  const rows = data ?? [];
  const exact = rows.find((r) => r.cakto_offer_id && r.cakto_offer_id === offerId && (!productId || r.cakto_product_id === productId));
  const byOffer = rows.find((r) => r.cakto_offer_id && r.cakto_offer_id === offerId);
  const byProduct = rows.find((r) => !r.cakto_offer_id && r.cakto_product_id === productId);
  return (exact ?? byOffer ?? byProduct)?.offer_id ?? null;
}

// Valores vão num filtro PostgREST: só permitimos o charset dos ids da Cakto.
function encodeFilter(v: string) {
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : `"${v.replace(/"/g, "")}"`;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Carrega do catálogo só o que pode casar com as UTMs (por id: workspace; por nome: contas da oferta). */
export async function loadCatalogFor(db: SupabaseClient, workspaceId: string, offerId: string | null, utms: UtmInput): Promise<Catalog> {
  const parsed = parseUtms(utms);
  const cols = "account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name";
  const ads: CatalogAd[] = [];
  const push = (rows: CatalogAd[] | null) => {
    for (const r of rows ?? []) if (!ads.some((a) => a.ad_id === r.ad_id)) ads.push(r);
  };

  const ids: [string, string | null][] = [["ad_id", parsed.ad.id], ["adset_id", parsed.adset.id], ["campaign_id", parsed.campaign.id]];
  for (const [col, val] of ids) {
    if (!val) continue;
    const { data } = await db.from("meta_ads").select(cols).eq("workspace_id", workspaceId).eq(col, val).limit(500);
    push(data as CatalogAd[] | null);
  }

  const hasNames = parsed.campaign.name || parsed.adset.name || parsed.ad.name;
  if (hasNames && !parsed.ad.id) {
    let accounts: string[] | null = null;
    if (offerId) {
      const { data } = await db.from("offer_ad_accounts").select("meta_ad_accounts(account_id)").eq("offer_id", offerId);
      accounts = (data ?? []).map((r) => (r.meta_ad_accounts as unknown as { account_id: string } | null)?.account_id).filter(Boolean) as string[];
    }
    let q = db.from("meta_ads").select(cols).eq("workspace_id", workspaceId);
    if (accounts && accounts.length) q = q.in("account_id", accounts);
    if (parsed.campaign.name) q = q.ilike("campaign_name", escapeLike(parsed.campaign.name));
    if (parsed.adset.name) q = q.ilike("adset_name", escapeLike(parsed.adset.name));
    if (parsed.ad.name) q = q.ilike("ad_name", escapeLike(parsed.ad.name));
    const { data } = await q.limit(200);
    push(data as CatalogAd[] | null);
  }

  const { count } = await db.from("meta_ads").select("ad_id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  return { ads, synced: (count ?? 0) > 0 };
}

async function loadSession(db: SupabaseClient, workspaceId: string, callback: string | null): Promise<SessionTouch> {
  if (!callback || !/^[A-Za-z0-9._~-]{8,64}$/.test(callback)) return null;
  const { data } = await db
    .from("tracking_sessions")
    .select("session_id, referrer_host, utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid")
    .eq("workspace_id", workspaceId)
    .eq("session_id", callback)
    .maybeSingle();
  if (!data) return null;
  return {
    session_id: data.session_id,
    referrer_host: data.referrer_host,
    utms: {
      utm_source: data.utm_source,
      utm_medium: data.utm_medium,
      utm_campaign: data.utm_campaign,
      utm_term: data.utm_term,
      utm_content: data.utm_content,
      fbclid: data.fbclid,
    },
  };
}

/** (Re)calcula e grava a atribuição de um pedido. */
export async function attributeOrder(
  db: SupabaseClient,
  args: { workspaceId: string; orderId: string; offerId: string | null; utms: UtmInput & { fbc?: string | null; fbp?: string | null }; callback: string | null; externalOrderId: string },
) {
  const session = await loadSession(db, args.workspaceId, args.callback);
  const u = args.utms;
  const orderHasUtm = [u.utm_source, u.utm_medium, u.utm_campaign, u.utm_content, u.utm_term].some((v) => typeof v === "string" && v.trim() !== "");
  const catalog = await loadCatalogFor(db, args.workspaceId, args.offerId, session && !orderHasUtm ? session.utms : args.utms);
  const r = attribute({ utms: args.utms, session, catalog, offerMapped: !!args.offerId });
  const row = {
    order_id: args.orderId,
    workspace_id: args.workspaceId,
    utm_source: args.utms.utm_source ?? null,
    utm_medium: args.utms.utm_medium ?? null,
    utm_campaign: args.utms.utm_campaign ?? null,
    utm_term: args.utms.utm_term ?? null,
    utm_content: args.utms.utm_content ?? null,
    sck: args.utms.sck ?? null,
    fbc: args.utms.fbc ?? null,
    fbp: args.utms.fbp ?? null,
    session_id: session?.session_id ?? null,
    account_id: r.account_id,
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    adset_id: r.adset_id,
    adset_name: r.adset_name,
    ad_id: r.ad_id,
    ad_name: r.ad_name,
    placement: r.placement,
    attribution_status: r.status,
    attribution_method: r.method,
    untracked_reason: r.reason,
    issues: r.issues,
    raw_parameters: { order: args.utms, session: session?.utms ?? null, used: r.usedParams },
    attributed_at: new Date().toISOString(),
  };
  const { error } = await db.from("order_attribution").upsert(row, { onConflict: "order_id" });
  if (error) throw new Error(`order_attribution: ${error.message}`);
  if (r.status === "UNTRACKED" || r.status === "UNKNOWN" || r.reason) {
    await logEvent(db, {
      workspaceId: args.workspaceId,
      level: r.status === "UNTRACKED" || r.status === "UNKNOWN" ? "warn" : "info",
      code: r.status === "UNTRACKED" || r.status === "UNKNOWN" ? "ATTRIBUTION_FAILED" : "ATTRIBUTION_PARTIAL",
      provider: "cakto",
      message: r.reason ?? r.status,
      context: { order_id: args.externalOrderId, status: r.status, reason: r.reason, ad_id: r.ad_id },
    });
  }
  return r;
}

/** Cria dispatches CAPI (um por pixel ativo da oferta). Idempotente pela unique (order, pixel, evento). */
export async function enqueuePurchaseDispatches(db: SupabaseClient, workspaceId: string, orderId: string, offerId: string | null, externalOrderId: string) {
  if (!offerId) return 0;
  const { data: links } = await db
    .from("offer_pixels")
    .select("pixel_id, pixels!inner(active)")
    .eq("offer_id", offerId)
    .eq("active", true)
    .eq("pixels.active", true);
  const rows = (links ?? []).map((l) => ({
    workspace_id: workspaceId,
    order_id: orderId,
    pixel_id: l.pixel_id,
    event_name: "Purchase",
    event_id: purchaseEventId("cakto", externalOrderId),
  }));
  if (!rows.length) return 0;
  await db.from("conversion_dispatches").upsert(rows, { onConflict: "order_id,pixel_id,event_name", ignoreDuplicates: true });
  return rows.length;
}

export async function ingestOrder(
  db: SupabaseClient,
  workspaceId: string,
  o: NormalizedOrder,
  source: Source,
): Promise<IngestResult> {
  const offerId = await resolveOffer(db, workspaceId, o.product_external_id, o.offer_external_id);
  if (!offerId) {
    await logEvent(db, {
      workspaceId,
      level: "warn",
      code: "OFFER_NOT_MAPPED",
      provider: "cakto",
      message: "Produto/oferta Cakto sem oferta interna",
      context: { order_id: o.external_order_id, product_id: o.product_external_id, offer_id: o.offer_external_id, product_name: o.product_name },
    });
  }

  const { attribution, checkout_url: _c, product_short_id: _s, ...orderCols } = o;
  void _c;
  void _s;
  const { data, error } = await db.rpc("upsert_order", {
    p: { ...orderCols, workspace_id: workspaceId, offer_id: offerId, source },
  });
  if (error) throw new Error(`upsert_order: ${error.message}`);
  const r = data as { order_id: string; inserted: boolean; applied: boolean; previous_status: string | null; status: string; reason: string | null };

  // Atribuição: se esta fonte não trouxe UTMs (ex.: API sem fbc) mantém as já gravadas.
  const { data: existing } = await db.from("order_attribution").select("utm_source, utm_medium, utm_campaign, utm_term, utm_content, sck, fbc, fbp").eq("order_id", r.order_id).maybeSingle();
  const incoming = attribution;
  const hasIncoming = [incoming.utm_source, incoming.utm_medium, incoming.utm_campaign, incoming.utm_content, incoming.utm_term].some(Boolean);
  const utms = hasIncoming || !existing ? { ...incoming, fbc: incoming.fbc ?? existing?.fbc ?? null, fbp: incoming.fbp ?? existing?.fbp ?? null } : { ...existing, fbc: existing.fbc ?? incoming.fbc, fbp: existing.fbp ?? incoming.fbp };

  let attrStatus = "UNKNOWN";
  try {
    const a = await attributeOrder(db, { workspaceId, orderId: r.order_id, offerId, utms, callback: o.callback, externalOrderId: o.external_order_id });
    attrStatus = a.status;
  } catch (e) {
    await logEvent(db, { workspaceId, level: "error", code: "ATTRIBUTION_FAILED", provider: "cakto", message: (e as Error).message, context: { order_id: o.external_order_id, reason: "exception" } });
  }

  if (r.status === "paid" && (r.inserted || r.previous_status !== "paid")) {
    await enqueuePurchaseDispatches(db, workspaceId, r.order_id, offerId, o.external_order_id);
  }

  if (!r.applied && r.reason && r.reason !== "same_status") {
    await logEvent(db, {
      workspaceId,
      level: "info",
      code: "ORDER_TRANSITION_IGNORED",
      provider: "cakto",
      message: r.reason,
      context: { order_id: o.external_order_id, current: r.status, incoming: o.status, source },
    });
  }

  return {
    orderId: r.order_id,
    inserted: r.inserted,
    applied: r.applied,
    previousStatus: r.previous_status,
    status: r.status,
    reason: r.reason,
    offerId,
    attribution: attrStatus,
  };
}

/** Reatribui pedidos pendentes de catálogo (chamado após sincronizar a Meta). */
export async function reattributePending(db: SupabaseClient, workspaceId: string, sinceDays = 60) {
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
  const { data } = await db
    .from("order_attribution")
    .select("order_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, sck, fbc, fbp, orders!inner(offer_id, callback, external_order_id, created_at)")
    .eq("workspace_id", workspaceId)
    .in("attribution_status", ["UTM_PARSED", "UNKNOWN", "NAME_MATCH", "EXACT_ID"])
    .in("untracked_reason", ["ad_not_synced", "ad_id_not_found", "name_not_found", "missing_ad_id"])
    .gte("orders.created_at", since)
    .limit(1000);
  let changed = 0;
  for (const row of data ?? []) {
    const o = row.orders as unknown as { offer_id: string | null; callback: string | null; external_order_id: string };
    const r = await attributeOrder(db, {
      workspaceId,
      orderId: row.order_id,
      offerId: o.offer_id,
      utms: row,
      callback: o.callback,
      externalOrderId: o.external_order_id,
    });
    if (r.status === "EXACT_ID" && !r.reason) changed++;
  }
  return { checked: data?.length ?? 0, resolved: changed };
}
