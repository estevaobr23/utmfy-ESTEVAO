// Monta a árvore Campanha → Conjunto → Anúncio cruzando gasto (Meta) e
// pedidos atribuídos (Cakto). Receita NUNCA vem da Meta.
import { addSums, derive, emptySums, type BaseSums, type Derived } from "./metrics";

export type SpendRow = {
  account_id: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  currency: string | null;
  impressions: number | string | null;
  clicks: number | string | null;
  outbound_clicks: number | string | null;
  spend: number | string | null;
  meta_purchases: number | string | null;
};

export type OrderRow = {
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  attribution_status: string;
  approved_count: number | string;
  approved_items: number | string;
  gross_revenue: number | string;
  fees: number | string;
  refunded_count: number | string;
  refunded_amount: number | string;
  chargeback_count: number | string;
  chargeback_amount: number | string;
  refund_requested_count: number | string;
  pix_generated: number | string;
  pix_paid: number | string;
};

export type ReportNode = {
  level: "campaign" | "adset" | "ad";
  id: string;
  name: string;
  metrics: Derived;
  children: ReportNode[];
};

const N = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const UNTRACKED = new Set(["UNTRACKED", "UNKNOWN"]);

export function spendToSums(r: SpendRow): Partial<BaseSums> {
  return {
    spend: N(r.spend),
    impressions: N(r.impressions),
    clicks: N(r.clicks),
    outbound_clicks: N(r.outbound_clicks),
    meta_purchases: N(r.meta_purchases),
  };
}

export function orderToSums(r: OrderRow): Partial<BaseSums> {
  const untracked = UNTRACKED.has(r.attribution_status);
  return {
    gross_revenue: N(r.gross_revenue),
    fees: N(r.fees),
    refunded_count: N(r.refunded_count),
    refunded_amount: N(r.refunded_amount),
    chargeback_count: N(r.chargeback_count),
    chargeback_amount: N(r.chargeback_amount),
    refund_requested_count: N(r.refund_requested_count),
    approved_count: N(r.approved_count),
    approved_items: N(r.approved_items),
    pix_generated: N(r.pix_generated),
    pix_paid: N(r.pix_paid),
    untracked_count: untracked ? N(r.approved_count) : 0,
    untracked_revenue: untracked ? N(r.gross_revenue) : 0,
  };
}

/** Totais do período (todas as vendas, rastreadas ou não + todo o gasto). */
export function totals(spend: SpendRow[], orders: OrderRow[], otherCosts = 0): Derived {
  let s = emptySums();
  for (const r of spend) s = addSums(s, spendToSums(r));
  for (const r of orders) s = addSums(s, orderToSums(r));
  s.other_costs = otherCosts;
  return derive(s);
}

type Acc = { name: string | null; sums: BaseSums; children: Map<string, Acc> };

const NO_ID = "__sem_id__";

function node(map: Map<string, Acc>, id: string, name: string | null): Acc {
  let n = map.get(id);
  if (!n) {
    n = { name, sums: emptySums(), children: new Map() };
    map.set(id, n);
  }
  if (!n.name && name) n.name = name;
  return n;
}

/**
 * Árvore hierárquica. Pedidos atribuídos só à campanha (sem conjunto/anúncio)
 * aparecem num filho "(sem conjunto identificado)". Pedidos sem campanha não
 * entram na árvore (ficam em Não rastreadas / totais).
 */
export function buildTree(spend: SpendRow[], orders: OrderRow[]): ReportNode[] {
  const campaigns = new Map<string, Acc>();
  const add = (
    c: string, cn: string | null, a: string, an: string | null, d: string, dn: string | null, sums: Partial<BaseSums>,
  ) => {
    const cNode = node(campaigns, c, cn);
    const aNode = node(cNode.children, a, an);
    const dNode = node(aNode.children, d, dn);
    cNode.sums = addSums(cNode.sums, sums);
    aNode.sums = addSums(aNode.sums, sums);
    dNode.sums = addSums(dNode.sums, sums);
  };
  for (const r of spend) add(r.campaign_id, r.campaign_name, r.adset_id, r.adset_name, r.ad_id, r.ad_name, spendToSums(r));
  for (const r of orders) {
    if (!r.campaign_id && !r.adset_id && !r.ad_id) continue;
    add(r.campaign_id ?? NO_ID, r.campaign_name, r.adset_id ?? NO_ID, r.adset_name, r.ad_id ?? NO_ID, r.ad_name, orderToSums(r));
  }
  const toNodes = (m: Map<string, Acc>, level: ReportNode["level"]): ReportNode[] => {
    const next = level === "campaign" ? "adset" : "ad";
    return [...m.entries()]
      .map(([id, acc]) => ({
        level,
        id,
        name:
          acc.name ??
          (id === NO_ID
            ? level === "campaign" ? "(campanha não identificada)" : level === "adset" ? "(sem conjunto identificado)" : "(sem anúncio identificado)"
            : id),
        metrics: derive(acc.sums),
        children: level === "ad" ? [] : toNodes(acc.children, next as ReportNode["level"]),
      }))
      .sort((x, y) => y.metrics.spend - x.metrics.spend || y.metrics.gross_revenue - x.metrics.gross_revenue);
  };
  return toNodes(campaigns, "campaign");
}
