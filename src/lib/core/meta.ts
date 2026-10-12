// Meta Marketing API (READ-ONLY) — normalização pura.
// Versão da Graph API: configurável (META_GRAPH_VERSION). Última verificada: v26.0 (2026-07-29).

export const DEFAULT_GRAPH_VERSION = "v26.0";

export const INSIGHTS_FIELDS = [
  "account_id", "account_name", "account_currency",
  "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
  "impressions", "reach", "clicks", "inline_link_clicks", "outbound_clicks", "spend",
  "actions", "action_values", "date_start", "date_stop",
];

export type MetaAction = { action_type?: string; value?: string | number };

export type RawInsight = {
  account_id?: string;
  account_name?: string;
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  impressions?: string | number;
  reach?: string | number;
  clicks?: string | number;
  inline_link_clicks?: string | number;
  outbound_clicks?: MetaAction[];
  spend?: string | number;
  actions?: MetaAction[];
  action_values?: MetaAction[];
  date_start?: string;
  date_stop?: string;
};

export type InsightRow = {
  date: string;
  account_id: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  impressions: number;
  reach: number | null;
  clicks: number;
  link_clicks: number | null;
  outbound_clicks: number | null;
  spend: number;
  currency: string | null;
  meta_purchases: number | null;
  meta_purchase_value: number | null;
  /** Eventos do pixel que a Meta devolve em `actions` (0 quando a Meta não listou a ação no dia). */
  landing_page_views: number;
  initiate_checkouts: number;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Tipos de ação de compra (Pixel/offsite). Métrica separada — nunca vira receita.
const PURCHASE_TYPES = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"];

// Início de checkout: pega o primeiro tipo presente (os tipos se sobrepõem; somá-los contaria duas vezes).
const INITIATE_CHECKOUT_TYPES = ["initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout", "omni_initiated_checkout"];

function pickAction(list: MetaAction[] | undefined, types: string[]): number | null {
  if (!Array.isArray(list)) return null;
  for (const t of types) {
    const a = list.find((x) => x.action_type === t);
    if (a) return num(a.value);
  }
  return null;
}

export function normalizeAccountId(id: string): string {
  return String(id).replace(/^act_/, "").trim();
}

export function normalizeInsight(r: RawInsight): InsightRow | null {
  if (!r.ad_id || !r.adset_id || !r.campaign_id || !r.date_start || !r.account_id) return null;
  return {
    date: r.date_start,
    account_id: normalizeAccountId(r.account_id),
    campaign_id: String(r.campaign_id),
    campaign_name: r.campaign_name ?? null,
    adset_id: String(r.adset_id),
    adset_name: r.adset_name ?? null,
    ad_id: String(r.ad_id),
    ad_name: r.ad_name ?? null,
    impressions: num(r.impressions) ?? 0,
    reach: num(r.reach),
    clicks: num(r.clicks) ?? 0,
    link_clicks: num(r.inline_link_clicks),
    outbound_clicks: pickAction(r.outbound_clicks, ["outbound_click"]),
    spend: Math.round((num(r.spend) ?? 0) * 100) / 100,
    currency: r.account_currency ?? null,
    meta_purchases: pickAction(r.actions, PURCHASE_TYPES),
    meta_purchase_value: pickAction(r.action_values, PURCHASE_TYPES),
    landing_page_views: pickAction(r.actions, ["landing_page_view"]) ?? 0,
    initiate_checkouts: pickAction(r.actions, INITIATE_CHECKOUT_TYPES) ?? 0,
  };
}

export type MetaErrorKind = "token_expired" | "no_permission" | "rate_limited" | "invalid_request" | "transient" | "unknown";

/** Classifica erros da Graph API (https://developers.facebook.com/docs/graph-api/guides/error-handling). */
export function classifyMetaError(status: number, body: unknown): { kind: MetaErrorKind; code: number | null; message: string } {
  const err = (body as { error?: { code?: number; error_subcode?: number; message?: string; type?: string } })?.error;
  const code = err?.code ?? null;
  const sub = err?.error_subcode ?? null;
  const message = (err?.message ?? `HTTP ${status}`).slice(0, 300);
  if (code === 190 || sub === 463 || sub === 467) return { kind: "token_expired", code, message };
  if (code === 10 || code === 200 || code === 273 || code === 272 || (code != null && code >= 200 && code < 300) || status === 403) {
    return { kind: "no_permission", code, message };
  }
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80000 || code === 80004 || (code != null && code >= 80000 && code <= 80014) || status === 429) {
    return { kind: "rate_limited", code, message };
  }
  if (code === 1 || code === 2 || status >= 500) return { kind: "transient", code, message };
  if (code === 100) return { kind: "invalid_request", code, message };
  return { kind: "unknown", code, message };
}

/** Janelas de sincronização: hoje, ontem e um retroativo curto (dados revisados). */
export function syncWindows(todayISO: string, lookbackDays: number): { since: string; until: string } {
  const until = todayISO;
  const d = new Date(`${todayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - lookbackDays);
  return { since: d.toISOString().slice(0, 10), until };
}

/** Quebra um período em blocos (evita respostas gigantes/timeout). */
export function chunkRange(since: string, until: string, days: number): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  let cur = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (cur <= end) {
    const stop = new Date(cur);
    stop.setUTCDate(stop.getUTCDate() + days - 1);
    const s = cur.toISOString().slice(0, 10);
    const u = (stop > end ? end : stop).toISOString().slice(0, 10);
    out.push({ since: s, until: u });
    cur = new Date(stop);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
