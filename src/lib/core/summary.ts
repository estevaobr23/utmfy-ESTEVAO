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

export type DistributionItem = { key: string; label: string; count: number; share: number; amount: number };
export type ApprovalItem = { key: string; label: string; attempts: number; approved: number; rate: number | null; state: DataState };
export type HourlyPoint = { hour: number; revenue: number | null; investment: number | null; profit: number | null };

export type SummaryAnalytics = {
  pendingCount: number;
  pendingAmount: number;
  salesByPayment: MetricDatum<DistributionItem[]>;
  salesByProduct: MetricDatum<DistributionItem[]>;
  approvalRate: MetricDatum<ApprovalItem[]>;
  salesBySource: MetricDatum<DistributionItem[]>;
  funnel: ConversionFunnel;
  hourlyProfit: MetricDatum<HourlyPoint[]>;
  hourlyFinancial: MetricDatum<HourlyPoint[]>;
};

export type SummaryOrder = {
  id: string;
  status: string;
  gross_amount: number | string | null;
  base_amount: number | string | null;
  payment_method: string | null;
  product_name: string | null;
  offer_type: string | null;
  paid_at: string | null;
  provider_created_at: string | null;
};

export type SummaryAttribution = { order_id: string; utm_source: string | null; attribution_status: string | null; account_id?: string | null };
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

function paymentLabel(value: string | null) {
  const key = (value ?? "other").toLocaleLowerCase("pt-BR");
  if (key === "pix" || key === "pix_auto") return ["pix", "Pix"] as const;
  if (["credit_card", "card", "cartao", "cartão"].includes(key)) return ["card", "Cartão"] as const;
  if (["boleto", "bank_slip"].includes(key)) return ["boleto", "Boleto"] as const;
  return ["other", "Outros"] as const;
}

function distribution(entries: readonly (readonly [string, string, number])[]) {
  const counts = new Map<string, { label: string; count: number; amount: number }>();
  for (const [key, label, amount] of entries) {
    const current = counts.get(key) ?? { label, count: 0, amount: 0 };
    current.count++;
    current.amount += amount;
    counts.set(key, current);
  }
  const total = entries.length;
  return [...counts.entries()]
    .map(([key, item]) => ({ key, label: item.label, count: item.count, share: total ? item.count / total : 0, amount: Math.round(item.amount * 100) / 100 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

function sourceLabel(attribution: SummaryAttribution | undefined) {
  const status = attribution?.attribution_status ?? "UNKNOWN";
  const source = attribution?.utm_source?.trim().toLocaleLowerCase("pt-BR");
  if (status === "ORGANIC") return ["organic", "Orgânico"] as const;
  if (status === "DIRECT") return ["direct", "Direto"] as const;
  if (source && ["facebook", "instagram", "meta", "fb", "ig"].some((item) => source.includes(item))) return ["meta", "Meta Ads"] as const;
  if (source) return [source, attribution?.utm_source?.trim() ?? source] as const;
  return ["unidentified", "Sem identificação"] as const;
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
}): SummaryAnalytics {
  const paidMain = input.paidOrders.filter(mainOrder);
  const attributionByOrder = new Map(input.attributions.map((item) => [item.order_id, item]));
  const pending = input.attempts.filter((order) => order.status === "pending" && mainOrder(order));
  const pendingAmount = pending.reduce((sum, order) => sum + number(order.gross_amount ?? order.base_amount), 0);
  const payment = distribution(paidMain.map((order) => [...paymentLabel(order.payment_method), number(order.gross_amount ?? order.base_amount)]));
  const products = distribution(paidMain.map((order) => [order.product_name ?? "Produto não identificado", order.product_name ?? "Produto não identificado", number(order.gross_amount ?? order.base_amount)]));
  const sources = distribution(paidMain.map((order) => [...sourceLabel(attributionByOrder.get(order.id)), number(order.gross_amount ?? order.base_amount)]));

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
  return {
    pendingCount: pending.length,
    pendingAmount: Math.round(pendingAmount * 100) / 100,
    salesByPayment: { state: payment.length ? "available" : "no_activity", value: payment },
    salesByProduct: { state: products.length ? "available" : "no_activity", value: products },
    approvalRate: { state: approval.length ? (approval.some((item) => item.state === "available") ? "available" : "partial") : "no_activity", value: approval, note: approval.some((item) => item.state === "partial") ? "N/D quando somente pedidos aprovados foram importados para o meio de pagamento." : undefined },
    salesBySource: { state: sources.length ? (sources.some((item) => item.key === "unidentified") ? "partial" : "available") : "no_activity", value: sources, note: sources.some((item) => item.key === "unidentified") ? "Vendas sem evidência de origem permanecem separadas." : undefined },
    funnel,
    hourlyProfit: { state: "not_synced", value: null, note: noHourlySpend },
    hourlyFinancial: { state: "not_synced", value: null, note: noHourlySpend },
  };
}
