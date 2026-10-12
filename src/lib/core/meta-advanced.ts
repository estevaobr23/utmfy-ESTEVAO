// Métricas avançadas da Meta (orçamento, lance, vídeo, alcance). Funções puras.
//
// Definições (validadas na Graph API v26.0 em 2026-10-11):
//   Hook rate        = reproduções de 3s (actions[video_view]) ÷ impressões
//   Play rate        = video_play_actions ÷ impressões (inclui início por autoplay)
//   Retenção do body = ThruPlays ÷ reproduções de 3s
//                      (dos que passaram do hook, quantos viram 15s ou o vídeo inteiro)
//   Retenção 25/50/75/100% = video_pXX_watched_actions ÷ video_play_actions
//   Tempo médio      = Σ(tempo médio diário × plays) ÷ Σ plays (a Meta arredonda o diário em segundos)
// Só entram anúncios de vídeo: criativo de imagem devolve contagens espúrias (1–6 plays).
// "Reprodução contínua de 2s" é coletada, mas a Meta devolveu vazio em todos os anúncios testados.
import { addDays, resolveRange } from "./dates";
import type { MetaAction } from "./meta";

// Moedas sem casas decimais na Meta (offset 1). Demais: valores em centavos (offset 100).
const ZERO_DECIMAL = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);

export function minorToMajor(value: unknown, currency: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return ZERO_DECIMAL.has((currency ?? "").toUpperCase()) ? n : n / 100;
}

const int = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

// ---------------------------------------------------------------------------
// Campanhas e conjuntos
// ---------------------------------------------------------------------------

export const CAMPAIGN_FIELDS = "id,name,effective_status,daily_budget,lifetime_budget,bid_strategy,updated_time";
export const ADSET_FIELDS = "id,name,campaign_id,effective_status,daily_budget,lifetime_budget,bid_strategy,bid_amount,bid_constraints,optimization_goal,billing_event,promoted_object,updated_time";

export type RawCampaign = { id?: string; name?: string; effective_status?: string; daily_budget?: string | number; lifetime_budget?: string | number; bid_strategy?: string; updated_time?: string };
export type RawAdset = RawCampaign & { campaign_id?: string; bid_amount?: string | number; bid_constraints?: unknown; optimization_goal?: string; billing_event?: string; promoted_object?: unknown };

export type CampaignConfig = {
  account_id: string; campaign_id: string; name: string | null; effective_status: string | null;
  daily_budget_minor: number | null; lifetime_budget_minor: number | null; bid_strategy: string | null;
  currency: string | null; meta_updated_time: string | null;
};
export type AdsetConfig = {
  account_id: string; campaign_id: string; adset_id: string; name: string | null; effective_status: string | null;
  daily_budget_minor: number | null; lifetime_budget_minor: number | null; bid_strategy: string | null;
  bid_amount_minor: number | null; bid_constraints: unknown; optimization_goal: string | null; billing_event: string | null;
  promoted_object: unknown; currency: string | null; meta_updated_time: string | null;
};

const positive = (v: unknown) => {
  const n = int(v);
  return n != null && n > 0 ? n : null;
};

export function normalizeCampaign(r: RawCampaign, accountId: string, currency: string | null): CampaignConfig | null {
  if (!r.id) return null;
  return {
    account_id: accountId, campaign_id: String(r.id), name: r.name ?? null, effective_status: r.effective_status ?? null,
    daily_budget_minor: positive(r.daily_budget), lifetime_budget_minor: positive(r.lifetime_budget),
    bid_strategy: r.bid_strategy ?? null, currency, meta_updated_time: r.updated_time ?? null,
  };
}

export function normalizeAdset(r: RawAdset, accountId: string, currency: string | null): AdsetConfig | null {
  if (!r.id || !r.campaign_id) return null;
  return {
    account_id: accountId, campaign_id: String(r.campaign_id), adset_id: String(r.id), name: r.name ?? null,
    effective_status: r.effective_status ?? null, daily_budget_minor: positive(r.daily_budget),
    lifetime_budget_minor: positive(r.lifetime_budget), bid_strategy: r.bid_strategy ?? null,
    bid_amount_minor: positive(r.bid_amount), bid_constraints: r.bid_constraints ?? null,
    optimization_goal: r.optimization_goal ?? null, billing_event: r.billing_event ?? null,
    promoted_object: r.promoted_object ?? null, currency, meta_updated_time: r.updated_time ?? null,
  };
}

// ---------------------------------------------------------------------------
// Orçamento e Bid Cap por nível
// ---------------------------------------------------------------------------

export type BudgetInfo = {
  /** CBO = orçamento na campanha; ABO = orçamento no conjunto. */
  mode: "CBO" | "ABO";
  amount: number | null;
  period: "daily" | "lifetime" | null;
  currency: string | null;
  /** Texto quando o orçamento mora em outro nível (igual ao Gerenciador). */
  note: string | null;
};

export type BidInfo = { amount: number | null; currency: string | null; note: string | null; strategy: string | null };

type BudgetSource = { daily_budget_minor: number | null; lifetime_budget_minor: number | null; currency: string | null };

function budgetOf(s: BudgetSource): Pick<BudgetInfo, "amount" | "period"> | null {
  if (s.daily_budget_minor) return { amount: minorToMajor(s.daily_budget_minor, s.currency), period: "daily" };
  if (s.lifetime_budget_minor) return { amount: minorToMajor(s.lifetime_budget_minor, s.currency), period: "lifetime" };
  return null;
}

export function campaignBudget(c: CampaignConfig | undefined): BudgetInfo | null {
  if (!c) return null;
  const own = budgetOf(c);
  if (own) return { mode: "CBO", ...own, currency: c.currency, note: null };
  return { mode: "ABO", amount: null, period: null, currency: c.currency, note: "Orç. do conjunto" };
}

export function adsetBudget(a: AdsetConfig | undefined, c: CampaignConfig | undefined): BudgetInfo | null {
  if (!a) return null;
  const own = budgetOf(a);
  if (own) return { mode: "ABO", ...own, currency: a.currency, note: null };
  if (c && budgetOf(c)) return { mode: "CBO", amount: null, period: null, currency: c.currency, note: "Orç. da campanha" };
  return null;
}

/** Só LOWEST_COST_WITH_BID_CAP define limite de lance. Cost cap e ROAS mínimo NÃO são bid cap. */
export const BID_CAP_STRATEGY = "LOWEST_COST_WITH_BID_CAP";

export function adsetBidCap(a: AdsetConfig | undefined, c?: CampaignConfig): BidInfo | null {
  if (!a) return null;
  const strategy = a.bid_strategy ?? c?.bid_strategy ?? null;
  if (strategy !== BID_CAP_STRATEGY) return { amount: null, currency: a.currency, note: null, strategy };
  const amount = minorToMajor(a.bid_amount_minor, a.currency);
  return { amount, currency: a.currency, note: amount == null ? "Sem valor" : null, strategy };
}

export function campaignBidCap(c: CampaignConfig | undefined, adsets: AdsetConfig[]): BidInfo | null {
  if (!c) return null;
  const caps = adsets.map((a) => adsetBidCap(a, c)).filter((b): b is BidInfo => !!b && b.amount != null);
  const distinct = [...new Set(caps.map((b) => b.amount))];
  if (distinct.length === 1) return { amount: distinct[0], currency: caps[0].currency, note: null, strategy: BID_CAP_STRATEGY };
  if (distinct.length > 1) return { amount: null, currency: caps[0].currency, note: "Vários", strategy: BID_CAP_STRATEGY };
  return { amount: null, currency: c.currency, note: null, strategy: c.bid_strategy };
}

export function formatBudgetPeriod(b: BudgetInfo): string {
  return b.period === "daily" ? "/dia" : b.period === "lifetime" ? " total" : "";
}

// ---------------------------------------------------------------------------
// Vídeo
// ---------------------------------------------------------------------------

export const VIDEO_FIELDS = [
  "video_play_actions", "video_continuous_2_sec_watched_actions", "video_6_sec_watched_actions",
  "video_15_sec_watched_actions", "video_thruplay_watched_actions", "video_p25_watched_actions",
  "video_p50_watched_actions", "video_p75_watched_actions", "video_p95_watched_actions",
  "video_p100_watched_actions", "video_avg_time_watched_actions",
] as const;
export const VIDEO_INSIGHTS_FIELDS = ["account_id", "campaign_id", "adset_id", "ad_id", "impressions", "actions", ...VIDEO_FIELDS];

export type RawVideoInsight = Partial<Record<(typeof VIDEO_FIELDS)[number], MetaAction[]>> & {
  account_id?: string; campaign_id?: string; adset_id?: string; ad_id?: string; date_start?: string;
  impressions?: string | number; actions?: MetaAction[];
};

export type VideoDailyRow = {
  date: string; account_id: string; campaign_id: string; adset_id: string; ad_id: string; impressions: number;
  video_plays: number | null; plays_2s_continuous: number | null; plays_3s: number | null; plays_6s: number | null;
  plays_15s: number | null; thruplays: number | null; p25: number | null; p50: number | null; p75: number | null;
  p95: number | null; p100: number | null; avg_watch_seconds: number | null;
};

/** Soma todas as entradas (a Meta pode quebrar por action_type; vídeo vem como "video_view"). */
function sumActions(list: MetaAction[] | undefined, type?: string): number | null {
  if (!Array.isArray(list) || !list.length) return null;
  const items = type ? list.filter((a) => a.action_type === type) : list;
  if (!items.length) return null;
  let total = 0;
  for (const a of items) {
    const n = Number(a.value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

export function normalizeVideoInsight(r: RawVideoInsight): VideoDailyRow | null {
  if (!r.ad_id || !r.adset_id || !r.campaign_id || !r.account_id || !r.date_start) return null;
  const avg = sumActions(r.video_avg_time_watched_actions);
  return {
    date: r.date_start,
    account_id: String(r.account_id).replace(/^act_/, ""),
    campaign_id: String(r.campaign_id),
    adset_id: String(r.adset_id),
    ad_id: String(r.ad_id),
    impressions: int(r.impressions) ?? 0,
    video_plays: sumActions(r.video_play_actions),
    plays_2s_continuous: sumActions(r.video_continuous_2_sec_watched_actions),
    plays_3s: sumActions(r.actions, "video_view"),
    plays_6s: sumActions(r.video_6_sec_watched_actions),
    plays_15s: sumActions(r.video_15_sec_watched_actions),
    thruplays: sumActions(r.video_thruplay_watched_actions),
    p25: sumActions(r.video_p25_watched_actions),
    p50: sumActions(r.video_p50_watched_actions),
    p75: sumActions(r.video_p75_watched_actions),
    p95: sumActions(r.video_p95_watched_actions),
    p100: sumActions(r.video_p100_watched_actions),
    avg_watch_seconds: avg == null ? null : Math.round(avg * 100) / 100,
  };
}

export function hasVideoData(r: VideoDailyRow): boolean {
  return [r.video_plays, r.plays_3s, r.thruplays, r.p25, r.avg_watch_seconds].some((v) => v != null);
}

/** Criativo do catálogo manda; sem catálogo (anúncio apagado/carrossel), ThruPlay > 0 indica vídeo real. */
export function isVideoAd(hasVideo: boolean | null | undefined, thruplays: number | null | undefined): boolean {
  if (hasVideo === true) return true;
  return (thruplays ?? 0) > 0;
}

export function creativeHasVideo(creative: { object_type?: string; video_id?: string } | undefined): boolean | null {
  if (!creative) return null;
  return creative.object_type === "VIDEO" || !!creative.video_id;
}

export type VideoSums = {
  impressions: number; plays: number; plays_3s: number; plays_2s: number; plays_6s: number; plays_15s: number;
  thruplays: number; p25: number; p50: number; p75: number; p95: number; p100: number; watch_seconds: number;
  /** nº de anúncios de vídeo que contribuíram (0 → N/D). */
  ads: number;
};

export type VideoRow = {
  account_id: string; campaign_id: string; adset_id: string; ad_id: string; has_video: boolean | null;
  impressions: number | string | null; video_plays: number | string | null; plays_2s_continuous: number | string | null;
  plays_3s: number | string | null; plays_6s: number | string | null; plays_15s: number | string | null;
  thruplays: number | string | null; p25: number | string | null; p50: number | string | null; p75: number | string | null;
  p95: number | string | null; p100: number | string | null; watch_seconds: number | string | null;
};

export const emptyVideo = (): VideoSums => ({
  impressions: 0, plays: 0, plays_3s: 0, plays_2s: 0, plays_6s: 0, plays_15s: 0, thruplays: 0,
  p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, watch_seconds: 0, ads: 0,
});

const N = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function videoRowToSums(r: VideoRow): VideoSums | null {
  if (!isVideoAd(r.has_video, r.thruplays == null ? null : N(r.thruplays))) return null;
  return {
    impressions: N(r.impressions), plays: N(r.video_plays), plays_3s: N(r.plays_3s), plays_2s: N(r.plays_2s_continuous),
    plays_6s: N(r.plays_6s), plays_15s: N(r.plays_15s), thruplays: N(r.thruplays), p25: N(r.p25), p50: N(r.p50),
    p75: N(r.p75), p95: N(r.p95), p100: N(r.p100), watch_seconds: N(r.watch_seconds), ads: 1,
  };
}

export function addVideo(a: VideoSums, b: VideoSums | null | undefined): VideoSums {
  if (!b) return a;
  const out = { ...a };
  for (const k of Object.keys(out) as (keyof VideoSums)[]) out[k] = a[k] + b[k];
  return out;
}

export type VideoDerived = {
  hook_rate: number | null; play_rate: number | null; body_retention: number | null;
  retention_25: number | null; retention_50: number | null; retention_75: number | null; retention_100: number | null;
  avg_watch_seconds: number | null; thruplays: number | null; plays_3s: number | null; video_plays: number | null;
};

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export function deriveVideo(s: VideoSums | null | undefined): VideoDerived {
  if (!s || s.ads === 0 || s.impressions === 0) {
    return { hook_rate: null, play_rate: null, body_retention: null, retention_25: null, retention_50: null, retention_75: null, retention_100: null, avg_watch_seconds: null, thruplays: null, plays_3s: null, video_plays: null };
  }
  return {
    hook_rate: ratio(s.plays_3s, s.impressions),
    play_rate: ratio(s.plays, s.impressions),
    body_retention: ratio(s.thruplays, s.plays_3s),
    retention_25: ratio(s.p25, s.plays),
    retention_50: ratio(s.p50, s.plays),
    retention_75: ratio(s.p75, s.plays),
    retention_100: ratio(s.p100, s.plays),
    avg_watch_seconds: ratio(s.watch_seconds, s.plays),
    thruplays: s.thruplays,
    plays_3s: s.plays_3s,
    video_plays: s.plays,
  };
}

/** Somas de vídeo por nível, só dos anúncios no escopo (oferta/conta). */
export function indexVideo(rows: VideoRow[], adsInScope: Set<string> | null) {
  const by = { account: new Map<string, VideoSums>(), campaign: new Map<string, VideoSums>(), adset: new Map<string, VideoSums>(), ad: new Map<string, VideoSums>() };
  const put = (m: Map<string, VideoSums>, id: string, s: VideoSums) => m.set(id, addVideo(m.get(id) ?? emptyVideo(), s));
  for (const r of rows) {
    if (adsInScope && !adsInScope.has(r.ad_id)) continue;
    const s = videoRowToSums(r);
    if (!s) continue;
    put(by.account, r.account_id, s);
    put(by.campaign, r.campaign_id, s);
    put(by.adset, r.adset_id, s);
    put(by.ad, r.ad_id, s);
  }
  return by;
}

// ---------------------------------------------------------------------------
// Alcance / frequência deduplicados por período
// ---------------------------------------------------------------------------

export type ReachLevel = "account" | "campaign" | "adset" | "ad";
export const REACH_LEVELS: ReachLevel[] = ["account", "campaign", "adset", "ad"];
export const REACH_PRESETS = ["today", "yesterday", "7d", "14d", "30d", "month", "last_month"] as const;

/** Períodos predefinidos da interface; só neles a frequência é exata (alcance consultado na Meta). */
export function reachWindows(tz: string, now = new Date()): { since: string; until: string }[] {
  const seen = new Map<string, { since: string; until: string }>();
  for (const preset of REACH_PRESETS) {
    const r = resolveRange({ preset }, tz, now);
    seen.set(`${r.from}|${r.to}`, { since: r.from, until: r.to });
  }
  return [...seen.values()];
}

export type RawReach = { account_id?: string; campaign_id?: string; adset_id?: string; ad_id?: string; impressions?: string | number; reach?: string | number; frequency?: string | number };

export function normalizeReach(r: RawReach, level: ReachLevel, since: string, until: string) {
  const id = level === "account" ? r.account_id : level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id : r.ad_id;
  if (!id || !r.account_id) return null;
  const reach = int(r.reach);
  const impressions = int(r.impressions) ?? 0;
  const freq = r.frequency != null && r.frequency !== "" ? Number(r.frequency) : reach ? impressions / reach : null;
  return {
    account_id: String(r.account_id).replace(/^act_/, ""), level, object_id: String(id).replace(/^act_/, ""),
    since, until, impressions, reach, frequency: freq != null && Number.isFinite(freq) ? Math.round(freq * 1e6) / 1e6 : null,
  };
}

export const reachKey = (level: ReachLevel, id: string) => `${level}:${id}`;

/** Remove linhas antigas: períodos que terminaram há mais de `keepDays`. */
export const reachCutoff = (today: string, keepDays = 70) => addDays(today, -keepDays);

export type AdvancedData = {
  campaigns: CampaignConfig[];
  adsets: AdsetConfig[];
  video: VideoRow[];
  reach: { level: ReachLevel; object_id: string; reach: number | string | null; frequency: number | string | null }[];
};

export type RowExtras = { budget: BudgetInfo | null; bidCap: BidInfo | null; reach: number | null; frequency: number | null; video: VideoSums | null };

/**
 * Índice por nível para a tabela Meta. `offerScoped`: dentro de uma oferta a conta
 * pode ter campanhas de outras ofertas, então alcance da CONTA não vale (N/D).
 */
export type AdvancedScope = { account: Set<string>; campaign: Set<string>; adset: Set<string>; ad: Set<string> };

/** Objetos com gasto no escopo atual (oferta/conta/período). Fora dele, vídeo e alcance viram N/D. */
export function scopeFromSpend(rows: { account_id: string; campaign_id: string; adset_id: string; ad_id: string }[]): AdvancedScope {
  return {
    account: new Set(rows.map((r) => r.account_id)),
    campaign: new Set(rows.map((r) => r.campaign_id)),
    adset: new Set(rows.map((r) => r.adset_id)),
    ad: new Set(rows.map((r) => r.ad_id)),
  };
}

export function buildAdvancedIndex(data: AdvancedData, scope: AdvancedScope | null, opts: { offerScoped: boolean }) {
  const adsInScope = scope?.ad ?? null;
  const campaigns = new Map(data.campaigns.map((c) => [c.campaign_id, c]));
  const adsets = new Map(data.adsets.map((a) => [a.adset_id, a]));
  const adsetsOf = new Map<string, AdsetConfig[]>();
  for (const a of data.adsets) adsetsOf.set(a.campaign_id, [...(adsetsOf.get(a.campaign_id) ?? []), a]);
  const reach = new Map(data.reach.map((r) => [reachKey(r.level, r.object_id), r]));
  const video = indexVideo(data.video, adsInScope);

  const reachOf = (level: ReachLevel, id: string) => {
    if (level === "account" && opts.offerScoped) return { reach: null, frequency: null };
    if (scope && !scope[level].has(id)) return { reach: null, frequency: null };
    const r = reach.get(reachKey(level, id));
    const n = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    return { reach: n(r?.reach), frequency: n(r?.frequency) };
  };

  const extras = (level: ReachLevel, id: string): RowExtras => {
    let budget: BudgetInfo | null = null;
    let bidCap: BidInfo | null = null;
    if (level === "campaign") {
      const c = campaigns.get(id);
      budget = campaignBudget(c);
      bidCap = campaignBidCap(c, adsetsOf.get(id) ?? []);
    } else if (level === "adset") {
      const a = adsets.get(id);
      const c = a ? campaigns.get(a.campaign_id) : undefined;
      budget = adsetBudget(a, c);
      bidCap = adsetBidCap(a, c);
    }
    return { budget, bidCap, ...reachOf(level, id), video: video[level].get(id) ?? null };
  };

  /** Alcance do conjunto da tabela: o do nó pai filtrado, ou da conta única fora de oferta. */
  const totalReach = (ctx: { campaign: string | null; adset: string | null; accountIds: string[] }) => {
    if (ctx.adset) return reachOf("adset", ctx.adset);
    if (ctx.campaign) return reachOf("campaign", ctx.campaign);
    if (ctx.accountIds.length === 1) return reachOf("account", ctx.accountIds[0]);
    return { reach: null, frequency: null };
  };

  return { extras, totalReach };
}

/** Campo rejeitado pela Graph (código 100) → removido para a próxima tentativa. */
export function rejectedField(message: string, fields: readonly string[]): string | null {
  return fields.find((f) => new RegExp(`\\b${f}\\b`).test(message)) ?? null;
}
