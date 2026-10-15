import { addSums, derive, emptySums, type Derived } from "./metrics";
import { addVideo, deriveVideo, emptyVideo, type BidInfo, type BudgetInfo, type VideoSums } from "./meta-advanced";

export type MetaMetricAvailability = "available" | "partial" | "unavailable";
export type MetaMetricFormat = "text" | "status" | "datetime" | "currency" | "integer" | "ratio" | "percent" | "budget" | "bid" | "seconds";
export type MetaColumnId =
  | "select" | "status" | "name" | "last_sync" | "budget" | "bid_cap"
  | "sales" | "cpa" | "spend" | "profit" | "revenue" | "roas" | "margin" | "roi"
  | "clicks" | "page_views" | "cpc" | "cpv" | "checkouts" | "cpi" | "ctr" | "cpm"
  | "impressions" | "reach" | "frequency"
  | "hook_rate" | "play_rate" | "body_retention" | "retention_25" | "retention_50" | "retention_75" | "retention_100"
  | "thruplays" | "plays_3s" | "video_plays" | "avg_watch";

export type MetaMetricDefinition = {
  id: MetaColumnId;
  label: string;
  shortLabel?: string;
  source: string;
  formula?: string;
  format: MetaMetricFormat;
  availability: MetaMetricAvailability;
  aggregation: "identity" | "sum" | "recalculate" | "unavailable";
  sortable: boolean;
  sticky?: boolean;
};

const VIDEO_SRC = "Métricas de vídeo Meta (só anúncios de vídeo)";

export const META_METRICS: MetaMetricDefinition[] = [
  { id: "select", label: "Selecionar", source: "Interface", format: "text", availability: "available", aggregation: "identity", sortable: false, sticky: true },
  { id: "status", label: "Status", source: "Catálogo Meta (status efetivo dos anúncios filhos)", format: "status", availability: "partial", aggregation: "identity", sortable: true, sticky: true },
  { id: "name", label: "Nome", source: "Catálogo Meta", format: "text", availability: "available", aggregation: "identity", sortable: true, sticky: true },
  { id: "last_sync", label: "Últ. atualização", source: "Sincronização da conta Meta", format: "datetime", availability: "available", aggregation: "identity", sortable: true },
  { id: "budget", label: "Orçamento", source: "Meta Marketing API (configuração atual, moeda da conta)", formula: "CBO: orçamento da campanha · ABO: orçamento do conjunto. Não é gasto.", format: "budget", availability: "available", aggregation: "identity", sortable: true },
  { id: "bid_cap", label: "Bid cap", source: "Meta Marketing API (moeda da conta)", formula: "Só quando a estratégia é LOWEST_COST_WITH_BID_CAP (cost cap e ROAS mínimo não contam)", format: "bid", availability: "available", aggregation: "identity", sortable: true },
  { id: "sales", label: "Vendas", source: "Cakto", format: "integer", availability: "available", aggregation: "sum", sortable: true },
  { id: "cpa", label: "CPA", source: "Cakto + Meta", formula: "Gasto ÷ vendas aprovadas", format: "currency", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "spend", label: "Gastos", source: "Meta Insights", format: "currency", availability: "available", aggregation: "sum", sortable: true },
  { id: "profit", label: "Lucro", source: "Cakto + Meta", formula: "Faturamento líquido − gasto − outros custos", format: "currency", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "revenue", label: "Faturamento", source: "Cakto", format: "currency", availability: "available", aggregation: "sum", sortable: true },
  { id: "roas", label: "ROAS", source: "Cakto + Meta", formula: "Faturamento líquido ÷ gasto", format: "ratio", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "margin", label: "Margem", source: "Cakto + Meta", formula: "Lucro ÷ faturamento líquido", format: "percent", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "roi", label: "ROI", source: "Cakto + Meta", formula: "Lucro ÷ investimento total", format: "ratio", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "clicks", label: "Cliques", source: "Meta Insights (cliques no link)", format: "integer", availability: "available", aggregation: "sum", sortable: true },
  { id: "page_views", label: "Vis. de pág.", source: "Pixel da Meta (landing_page_view)", format: "integer", availability: "available", aggregation: "sum", sortable: true },
  { id: "cpc", label: "CPC", source: "Meta Insights", formula: "Gasto ÷ cliques", format: "currency", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "cpv", label: "CPV", source: "Pixel da Meta + gasto", formula: "Gasto ÷ visualizações da página", format: "currency", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "checkouts", label: "IC", source: "Pixel da Meta (initiate_checkout)", format: "integer", availability: "available", aggregation: "sum", sortable: true },
  { id: "cpi", label: "CPI", source: "Pixel da Meta + gasto", formula: "Gasto ÷ inícios de checkout", format: "currency", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "ctr", label: "CTR", source: "Meta Insights", formula: "Cliques ÷ impressões", format: "percent", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "cpm", label: "CPM", source: "Meta Insights", formula: "Gasto × 1.000 ÷ impressões", format: "currency", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "impressions", label: "Impressões", source: "Meta Insights", format: "integer", availability: "available", aggregation: "sum", sortable: true },
  { id: "reach", label: "Alcance", source: "Meta Insights (deduplicado no período e nível)", formula: "Só períodos predefinidos; alcance não é somável", format: "integer", availability: "partial", aggregation: "unavailable", sortable: true },
  { id: "frequency", label: "Frequência", source: "Meta Insights (deduplicada no período e nível)", formula: "Impressões ÷ alcance único do período; só períodos predefinidos", format: "ratio", availability: "partial", aggregation: "unavailable", sortable: true },
  { id: "hook_rate", label: "Hook rate", source: VIDEO_SRC, formula: "Reproduções de 3s ÷ impressões", format: "percent", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "play_rate", label: "Play rate", source: VIDEO_SRC, formula: "Reproduções iniciadas (video_play_actions, inclui autoplay) ÷ impressões", format: "percent", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "body_retention", label: "Retenção do body", source: VIDEO_SRC, formula: "ThruPlays (15s ou fim) ÷ reproduções de 3s", format: "percent", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "retention_25", label: "Retenção 25%", source: VIDEO_SRC, formula: "Reproduções até 25% ÷ reproduções iniciadas", format: "percent", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "retention_50", label: "Retenção 50%", source: VIDEO_SRC, formula: "Reproduções até 50% ÷ reproduções iniciadas", format: "percent", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "retention_75", label: "Retenção 75%", source: VIDEO_SRC, formula: "Reproduções até 75% ÷ reproduções iniciadas", format: "percent", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "retention_100", label: "Retenção 100%", source: VIDEO_SRC, formula: "Reproduções até 100% ÷ reproduções iniciadas", format: "percent", availability: "available", aggregation: "recalculate", sortable: true },
  { id: "thruplays", label: "ThruPlays", source: VIDEO_SRC, formula: "Reproduções de 15s ou até o fim (vídeos < 15s)", format: "integer", availability: "available", aggregation: "sum", sortable: true },
  { id: "plays_3s", label: "Reproduções 3s", source: VIDEO_SRC, formula: "actions[video_view]", format: "integer", availability: "available", aggregation: "sum", sortable: true },
  { id: "video_plays", label: "Reproduções", source: VIDEO_SRC, formula: "video_play_actions", format: "integer", availability: "available", aggregation: "sum", sortable: true },
  { id: "avg_watch", label: "Tempo médio", source: VIDEO_SRC, formula: "Σ(tempo médio diário × reproduções) ÷ Σ reproduções (aprox.: a Meta arredonda o diário)", format: "seconds", availability: "available", aggregation: "recalculate", sortable: true },
];

export const META_COLUMN_PRESETS: Record<"essential" | "complete" | "creative", MetaColumnId[]> = {
  essential: ["select", "status", "name", "budget", "sales", "cpa", "spend", "profit", "revenue", "roas"],
  complete: META_METRICS.map((metric) => metric.id),
  creative: ["select", "status", "name", "spend", "ctr", "cpc", "cpm", "impressions", "frequency", "hook_rate", "play_rate", "body_retention", "retention_25", "retention_50", "retention_75", "retention_100", "thruplays", "avg_watch"],
};

export type MetaTableRow = {
  id: string;
  level: "account" | "campaign" | "adset" | "ad";
  name: string;
  accountId: string | null;
  campaignId: string | null;
  adsetId: string | null;
  status: string | null;
  lastSync: string | null;
  budget: BudgetInfo | null;
  /** Última mudança de orçamento feita pela ferramenta (de → para, na moeda do painel). */
  budgetChange?: BudgetChange | null;
  bidCap: BidInfo | null;
  /** Alcance/frequência deduplicados do período no nível da linha; null = sem dado exato. */
  reach: number | null;
  frequency: number | null;
  video: VideoSums | null;
  metrics: Derived;
  drillUrl: string | null;
  managerUrl: string | null;
  children: MetaTableRow[];
};

export type BudgetChange = { at: string; before: number; after: number; currency: string };

/** Última mudança de orçamento por objeto Meta, a partir dos logs META_BUDGET_UPDATED (mais recentes primeiro). */
export function latestBudgetChanges(logs: { created_at: string; context: Record<string, unknown> | null }[]): Map<string, BudgetChange> {
  const out = new Map<string, BudgetChange>();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  for (const log of [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const c = log.context ?? {};
    const id = typeof c.object_id === "string" ? c.object_id : null;
    if (!id || out.has(id)) continue;
    const rate = num(c.rate) ?? 1;
    const before = num(c.before_target) ?? (num(c.before_minor) != null ? num(c.before_minor)! / 100 * rate : null);
    const after = num(c.after_target) ?? num(c.requested);
    if (before == null || after == null) continue;
    out.set(id, { at: log.created_at, before, after, currency: typeof c.workspace_currency === "string" ? c.workspace_currency : "BRL" });
  }
  return out;
}

export function metaMetricValue(row: MetaTableRow, column: MetaColumnId): string | number | null {
  const m = row.metrics;
  const v = deriveVideo(row.video);
  switch (column) {
    case "status": return row.status;
    case "name": return row.name;
    case "last_sync": return row.lastSync;
    case "budget": return row.budget?.amount ?? null;
    case "bid_cap": return row.bidCap?.amount ?? null;
    case "sales": return m.approved_count;
    case "cpa": return m.cpa;
    case "spend": return m.spend;
    case "profit": return m.profit;
    case "revenue": return m.net_revenue;
    case "roas": return m.roas;
    case "margin": return m.margin;
    case "roi": return m.roi;
    case "clicks": return m.clicks;
    // Eventos do pixel: sem nenhuma linha coletada é N/D (não zero).
    case "page_views": return m.pixel_rows > 0 ? m.landing_page_views : null;
    case "checkouts": return m.pixel_rows > 0 ? m.initiate_checkouts : null;
    case "cpv": return m.pixel_rows > 0 ? m.cpv : null;
    case "cpi": return m.pixel_rows > 0 ? m.cpi : null;
    case "cpc": return m.cpc;
    case "ctr": return m.ctr;
    case "cpm": return m.cpm;
    case "impressions": return m.impressions;
    case "reach": return row.reach;
    case "frequency": return row.frequency;
    case "hook_rate": return v.hook_rate;
    case "play_rate": return v.play_rate;
    case "body_retention": return v.body_retention;
    case "retention_25": return v.retention_25;
    case "retention_50": return v.retention_50;
    case "retention_75": return v.retention_75;
    case "retention_100": return v.retention_100;
    case "thruplays": return v.thruplays;
    case "plays_3s": return v.plays_3s;
    case "video_plays": return v.video_plays;
    case "avg_watch": return v.avg_watch_seconds;
    default: return null;
  }
}

export function totalMetaRows(rows: MetaTableRow[]): Derived {
  const sums = rows.reduce((total, row) => addSums(total, row.metrics), emptySums());
  return derive(sums);
}

/** Vídeo agrega numeradores e denominadores (nunca média de percentuais). */
export function totalVideoRows(rows: MetaTableRow[]): VideoSums | null {
  const total = rows.reduce((acc, row) => addVideo(acc, row.video), emptyVideo());
  return total.ads ? total : null;
}
