import { localDateHour } from "./dates";
import { paymentMethod } from "./payment-methods";
import { classifySource } from "./utm";

export type DataState = "available" | "no_activity" | "not_synced" | "integration_missing" | "partial" | "error" | "not_applicable";

export type MetricDatum<T> = {
  state: DataState;
  value: T | null;
  note?: string;
};

export type FunnelStage = {
  key: "clicks" | "pageviews" | "checkouts" | "initiated" | "approved";
  label: string;
  value: number | null;
  state: DataState;
  fromStart: number | null;
  fromPrevious: number | null;
};

export type ConversionFunnel = {
  stages: FunnelStage[];
  state: DataState;
  note: string | null;
};

/** `kind` só existe na lista de produtos: principal, order bump, upsell etc. */
export type DistributionItem = { key: string; label: string; count: number; share: number; amount: number; kind?: string };
export type ApprovalItem = { key: string; label: string; attempts: number; approved: number; rate: number | null; state: DataState };
/** Um ponto por hora do dia (0–23) no fuso do workspace. Investimento/lucro são null quando o gasto por hora não está disponível. */
export type HourlyPoint = {
  hour: number;
  /** Vendas aprovadas (todos os pedidos pagos, inclusive bump e upsell). */
  sales: number;
  grossRevenue: number;
  netRevenue: number;
  investment: number | null;
  profitGross: number | null;
  profitNet: number | null;
};

/** Gasto por hora já na moeda do workspace e no escopo da oferta; `from` = primeiro dia com gasto por hora sincronizado. */
export type HourlyInput = { spendByHour: number[] | null; from: string | null; note?: string | null };

export type SummaryAnalytics = {
  pendingCount: number;
  pendingAmount: number;
  salesByPayment: MetricDatum<DistributionItem[]>;
  /** Todos os pedidos aprovados (principal + order bump + upsell), uma linha por produto. */
  salesByProduct: MetricDatum<DistributionItem[]>;
  /** Só os pedidos principais (as "vendas" do CPA). */
  salesByMainProduct: MetricDatum<DistributionItem[]>;
  approvalRate: MetricDatum<ApprovalItem[]>;
  salesBySource: MetricDatum<DistributionItem[]>;
  salesByCampaign: MetricDatum<DistributionItem[]>;
  funnel: ConversionFunnel;
  hourlyProfit: MetricDatum<HourlyPoint[]>;
  hourlyFinancial: MetricDatum<HourlyPoint[]>;
};

export type SummaryOrder = {
  id: string;
  currency?: string | null;
  status: string;
  gross_amount: number | string | null;
  base_amount: number | string | null;
  net_amount?: number | string | null;
  fees?: number | string | null;
  product_external_id?: string | null;
  payment_method: string | null;
  product_name: string | null;
  offer_type: string | null;
  paid_at: string | null;
  provider_created_at: string | null;
};

export type SummaryAttribution = {
  order_id: string;
  utm_source: string | null;
  attribution_status: string | null;
  account_id?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  ad_id?: string | null;
};
export type SummarySession = { pageviews: number | null; checkout_clicks: number | null; utm_source?: string | null; fbclid?: string | null; fbc?: string | null };

/** Sessão que veio de anúncio da Meta: utm_source da Meta ou clique com fbclid/fbc. Acesso direto e orgânico ficam de fora. */
export function isMetaSession(session: SummarySession): boolean {
  return classifySource(session.utm_source ?? null) === "meta" || !!session.fbclid || !!session.fbc;
}

const APPROVED = new Set(["paid", "refund_requested", "disputed", "refunded", "chargedback"]);
const mainOrder = (order: SummaryOrder) => !order.offer_type || order.offer_type === "main";
const number = (value: number | string | null) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Nome próprio de cada meio (catálogo em payment-methods.ts); nunca "Outros". */
function paymentLabel(value: string | null) {
  const info = paymentMethod(value);
  return [info.key, info.label] as const;
}

type DistributionEntry = readonly [key: string, label: string, amount: number, kind?: string];

function distribution(entries: readonly DistributionEntry[]): DistributionItem[] {
  const counts = new Map<string, { label: string; count: number; amount: number; kinds: Map<string, number> }>();
  for (const [key, label, amount, kind] of entries) {
    const current = counts.get(key) ?? { label, count: 0, amount: 0, kinds: new Map<string, number>() };
    current.count++;
    current.amount += amount;
    if (kind) current.kinds.set(kind, (current.kinds.get(kind) ?? 0) + 1);
    counts.set(key, current);
  }
  const total = entries.length;
  return [...counts.entries()]
    .map(([key, item]) => {
      const kind = item.kinds.has("main") ? "main" : [...item.kinds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return { key, label: item.label, count: item.count, share: total ? item.count / total : 0, amount: Math.round(item.amount * 100) / 100, ...(kind ? { kind } : {}) };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

const META_SOURCE_HINTS = ["facebook", "instagram", "meta", "fb", "ig"];
const ATTRIBUTED = new Set(["EXACT_ID", "UTM_PARSED", "NAME_MATCH"]);

/**
 * A Hotmart não repassa utm_*: a venda chega atribuída pelo `sck` (sessão do tracker) com campanha e anúncio,
 * mas sem utm_source. Anúncio/campanha atribuídos pelo motor de atribuição só existem para a Meta, então valem como evidência.
 */
function sourceLabel(attribution: SummaryAttribution | undefined) {
  const status = attribution?.attribution_status ?? "UNKNOWN";
  const source = attribution?.utm_source?.trim().toLocaleLowerCase("pt-BR");
  if (status === "ORGANIC") return ["organic", "Orgânico"] as const;
  if (status === "DIRECT") return ["direct", "Direto"] as const;
  if (source && META_SOURCE_HINTS.some((item) => source.includes(item))) return ["meta", "Meta Ads"] as const;
  if (source) return [source, attribution?.utm_source?.trim() ?? source] as const;
  if (ATTRIBUTED.has(status) && (attribution?.ad_id || attribution?.campaign_id || attribution?.campaign_name)) return ["meta", "Meta Ads"] as const;
  return ["unidentified", "Sem identificação"] as const;
}

function campaignLabel(attribution: SummaryAttribution | undefined) {
  const name = attribution?.campaign_name?.trim();
  const id = attribution?.campaign_id?.trim();
  if (name) return [`c:${name.toLocaleLowerCase("pt-BR")}`, name] as const;
  if (id) return [`id:${id}`, `Campanha ${id}`] as const;
  return ["none", "Sem campanha identificada"] as const;
}

const orderKind = (order: SummaryOrder) => (order.offer_type || "main").toLowerCase();

/** Um item por produto, com o mesmo nome para o mesmo ID (a Cakto às vezes grava dois nomes) e sem separar por plataforma. */
function productEntries(orders: SummaryOrder[]): DistributionEntry[] {
  const nameById = new Map<string, string>();
  return orders.map((order) => {
    const name = order.product_name?.trim() || "Produto não identificado";
    const id = order.product_external_id?.trim();
    let canonical = name;
    if (id) {
      canonical = nameById.get(id) ?? name;
      nameById.set(id, canonical);
    }
    return [canonical.toLocaleLowerCase("pt-BR"), canonical, number(order.gross_amount ?? order.base_amount), orderKind(order)] as const;
  });
}

const REFUNDED = new Set(["refunded", "chargedback"]);

/** Série por hora do dia (fuso do workspace). Receita bruta/líquida vem dos pedidos; gasto vem do gasto por hora da Meta. */
export function buildHourlySeries(orders: SummaryOrder[], hourly: HourlyInput, timezone: string): HourlyPoint[] {
  const points: HourlyPoint[] = Array.from({ length: 24 }, (_, hour) => ({
    hour, sales: 0, grossRevenue: 0, netRevenue: 0, investment: null, profitGross: null, profitNet: null,
  }));
  for (const order of orders) {
    if (!order.paid_at) continue;
    const { date, hour } = localDateHour(new Date(order.paid_at), timezone);
    if (hourly.from && date < hourly.from) continue;
    const gross = number(order.gross_amount ?? order.base_amount);
    const fees = order.fees != null ? number(order.fees) : order.net_amount != null ? Math.max(0, gross - number(order.net_amount)) : 0;
    const net = gross - (REFUNDED.has(order.status) ? gross : 0) - fees;
    const point = points[hour];
    point.sales++;
    point.grossRevenue += gross;
    point.netRevenue += net;
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  for (const point of points) {
    point.grossRevenue = round(point.grossRevenue);
    point.netRevenue = round(point.netRevenue);
    if (hourly.spendByHour) {
      point.investment = round(hourly.spendByHour[point.hour] ?? 0);
      point.profitGross = round(point.grossRevenue - point.investment);
      point.profitNet = round(point.netRevenue - point.investment);
    }
  }
  return points;
}

function funnelStage(key: FunnelStage["key"], label: string, value: number | null, first: number | null, previous: number | null): FunnelStage {
  const state: DataState = value == null ? "integration_missing" : value === 0 ? "no_activity" : "available";
  return {
    key,
    label,
    value,
    state,
    fromStart: value != null && first != null && first > 0 ? value / first : null,
    fromPrevious: value != null && previous != null && previous > 0 ? value / previous : null,
  };
}

export function buildSummaryAnalytics(input: {
  paidOrders: SummaryOrder[];
  attempts: SummaryOrder[];
  attributions: SummaryAttribution[];
  sessions: SummarySession[];
  clicks: number | null;
  /** Eventos do pixel da Meta (mesma fonte da UTMify); null = não coletados → cai no tracker. */
  metaPixel?: { pageviews: number; checkouts: number } | null;
  approvedCount: number;
  /** Gasto por hora do escopo; ausente = não carregado (séries por hora ficam indisponíveis). */
  hourly?: HourlyInput | null;
  timezone?: string;
}): SummaryAnalytics {
  const paidMain = input.paidOrders.filter(mainOrder);
  const attributionByOrder = new Map(input.attributions.map((item) => [item.order_id, item]));
  const pending = input.attempts.filter((order) => order.status === "pending" && mainOrder(order));
  const pendingAmount = pending.reduce((sum, order) => sum + number(order.gross_amount ?? order.base_amount), 0);
  const payment = distribution(paidMain.map((order) => [...paymentLabel(order.payment_method), number(order.gross_amount ?? order.base_amount)]));
  const products = distribution(productEntries(input.paidOrders));
  const mainProducts = distribution(productEntries(paidMain));
  const sources = distribution(paidMain.map((order) => [...sourceLabel(attributionByOrder.get(order.id)), number(order.gross_amount ?? order.base_amount)] as const));
  const campaigns = distribution(paidMain.map((order) => [...campaignLabel(attributionByOrder.get(order.id)), number(order.gross_amount ?? order.base_amount)] as const));

  const byPayment = new Map<string, { label: string; attempts: number; approved: number }>();
  for (const order of input.attempts.filter(mainOrder)) {
    const [key, label] = paymentLabel(order.payment_method);
    const current = byPayment.get(key) ?? { label, attempts: 0, approved: 0 };
    current.attempts++;
    if (APPROVED.has(order.status) || !!order.paid_at) current.approved++;
    byPayment.set(key, current);
  }
  const approval = [...byPayment.entries()].map(([key, item]) => {
    const hasOutcomeVariation = item.approved < item.attempts;
    return {
      key,
      label: item.label,
      attempts: item.attempts,
      approved: item.approved,
      rate: item.attempts && hasOutcomeVariation ? item.approved / item.attempts : null,
      state: (item.attempts ? (hasOutcomeVariation ? "available" : "partial") : "no_activity") as DataState,
    };
  }).sort((a, b) => b.attempts - a.attempts);

  // Visitas e ICs: pixel da Meta quando coletado; senão as sessões do tracker próprio.
  const hasMetaPixel = !!input.metaPixel;
  const hasSessions = input.sessions.length > 0;
  const hasTracking = hasMetaPixel || hasSessions;
  const pageviews = hasMetaPixel ? input.metaPixel!.pageviews : hasSessions ? input.sessions.reduce((sum, session) => sum + Number(session.pageviews ?? 0), 0) : null;
  const checkouts = hasMetaPixel ? input.metaPixel!.checkouts : hasSessions ? input.sessions.reduce((sum, session) => sum + Number(session.checkout_clicks ?? 0), 0) : null;
  const values = [input.clicks, pageviews, checkouts, input.attempts.filter(mainOrder).length, input.approvedCount];
  const labels: [FunnelStage["key"], string][] = [["clicks", "Cliques"], ["pageviews", "Vis. página"], ["checkouts", "ICs"], ["initiated", "Vendas iniciadas"], ["approved", "Vendas aprovadas"]];
  const stages = labels.map(([key, label], index) => funnelStage(key, label, values[index], values[0], index ? values[index - 1] : null));
  const funnel: ConversionFunnel = {
    stages,
    state: hasTracking ? "available" : "partial",
    note: !hasTracking
      ? "Visitas de página e inícios de checkout dependem do tracker. Nenhuma sessão foi registrada no período."
      : !hasMetaPixel && pageviews != null && input.clicks != null && pageviews > input.clicks
        ? "Visitas e ICs vêm do rastreador da página (só tráfego de anúncio da Meta). Os cliques ainda não chegaram da Meta: ela só conta clique de anúncio entregue, e cliques de teste ou de prévia ficam de fora."
        : null,
  };

  const noHourlySpend = "A Meta está sincronizada por dia. O gasto diário não é distribuído artificialmente por hora.";
  let hourlyDatum: MetricDatum<HourlyPoint[]> = { state: "not_synced", value: null, note: noHourlySpend };
  if (input.hourly) {
    const points = buildHourlySeries(input.paidOrders, input.hourly, input.timezone ?? "America/Sao_Paulo");
    const active = points.some((point) => point.sales > 0 || (point.investment ?? 0) > 0);
    hourlyDatum = {
      state: !active ? "no_activity" : input.hourly.spendByHour ? "available" : "partial",
      value: points,
      note: input.hourly.note ?? (input.hourly.spendByHour ? undefined : "Gasto por hora ainda não sincronizado para este período: mostrando só o faturamento por hora."),
    };
  }
  return {
    pendingCount: pending.length,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
    salesByPayment: { state: payment.length ? "available" : "no_activity", value: payment },
    salesByProduct: { state: products.length ? "available" : "no_activity", value: products },
    salesByMainProduct: { state: mainProducts.length ? "available" : "no_activity", value: mainProducts },
    approvalRate: { state: approval.length ? (approval.some((item) => item.state === "available") ? "available" : "partial") : "no_activity", value: approval, note: approval.some((item) => item.state === "partial") ? "N/D quando somente pedidos aprovados foram importados para o meio de pagamento." : undefined },
    salesBySource: { state: sources.length ? (sources.some((item) => item.key === "unidentified") ? "partial" : "available") : "no_activity", value: sources, note: sources.some((item) => item.key === "unidentified") ? "Vendas sem evidência de origem permanecem separadas." : undefined },
    salesByCampaign: { state: campaigns.length ? (campaigns.some((item) => item.key === "none") ? "partial" : "available") : "no_activity", value: campaigns },
    funnel,
    hourlyProfit: hourlyDatum,
    hourlyFinancial: hourlyDatum,
  };
}
