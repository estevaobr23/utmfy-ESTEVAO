// ÚNICA fonte das fórmulas financeiras e de mídia. Nenhuma página/componente
// calcula ROAS, CPA etc. por conta própria: todos chamam derive().
//
// Somas base (vêm do banco — report_order_rows / report_spend_rows):
//   spend            Σ gasto Meta no período (fuso da conta)
//   gross_revenue    Σ valor cobrado dos pedidos APROVADOS no período (por paid_at),
//                    incluindo os que depois viraram reembolso/chargeback
//   fees             Σ taxas Cakto desses pedidos
//   refunded_amount  Σ valor dos aprovados no período que hoje estão refunded
//   chargeback_amount Σ valor dos aprovados no período que hoje estão chargedback
//   approved_count   nº de pedidos PRINCIPAIS aprovados (offer_type=main) → vendas
//   approved_items   nº total de pedidos aprovados (inclui order bump/upsell)
//   pix_generated    nº de pedidos Pix criados no período
//   pix_paid         nº desses Pix que foram pagos
//
// Fórmulas:
//   net_revenue   = gross_revenue − refunded_amount − chargeback_amount − fees
//   profit        = net_revenue − spend − other_costs
//   roas          = net_revenue / spend                  (padrão UTMify; null se spend = 0)
//   gross_roas    = gross_revenue / spend
//   cpa           = spend / approved_count                (null se 0 vendas)
//   ticket        = gross_revenue / approved_count
//   pix_conversion= pix_paid / pix_generated
//   ctr           = clicks / impressions
//   cpc           = spend / clicks
//   refund_rate   = refunded_count / approved_items

export type BaseSums = {
  spend: number;
  impressions: number;
  clicks: number;
  outbound_clicks: number;
  meta_purchases: number;
  gross_revenue: number;
  fees: number;
  refunded_count: number;
  refunded_amount: number;
  chargeback_count: number;
  chargeback_amount: number;
  refund_requested_count: number;
  approved_count: number;
  approved_items: number;
  pix_generated: number;
  pix_paid: number;
  untracked_count: number;
  untracked_revenue: number;
  other_costs: number;
};

export type Derived = BaseSums & {
  net_revenue: number;
  profit: number;
  roas: number | null;
  gross_roas: number | null;
  cpa: number | null;
  ticket: number | null;
  pix_conversion: number | null;
  ctr: number | null;
  cpc: number | null;
  refund_rate: number | null;
};

export const emptySums = (): BaseSums => ({
  spend: 0,
  impressions: 0,
  clicks: 0,
  outbound_clicks: 0,
  meta_purchases: 0,
  gross_revenue: 0,
  fees: 0,
  refunded_count: 0,
  refunded_amount: 0,
  chargeback_count: 0,
  chargeback_amount: 0,
  refund_requested_count: 0,
  approved_count: 0,
  approved_items: 0,
  pix_generated: 0,
  pix_paid: 0,
  untracked_count: 0,
  untracked_revenue: 0,
  other_costs: 0,
});

export function addSums(a: BaseSums, b: Partial<BaseSums>): BaseSums {
  const out = { ...a };
  for (const k of Object.keys(out) as (keyof BaseSums)[]) {
    const v = Number(b[k] ?? 0);
    out[k] = round2(out[k] + (Number.isFinite(v) ? v : 0));
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export function derive(s: BaseSums): Derived {
  const net_revenue = round2(s.gross_revenue - s.refunded_amount - s.chargeback_amount - s.fees);
  return {
    ...s,
    net_revenue,
    profit: round2(net_revenue - s.spend - s.other_costs),
    roas: ratio(net_revenue, s.spend),
    gross_roas: ratio(s.gross_revenue, s.spend),
    cpa: ratio(s.spend, s.approved_count),
    ticket: ratio(s.gross_revenue, s.approved_count),
    pix_conversion: ratio(s.pix_paid, s.pix_generated),
    ctr: ratio(s.clicks, s.impressions),
    cpc: ratio(s.spend, s.clicks),
    refund_rate: ratio(s.refunded_count, s.approved_items),
  };
}

export const METRIC_DEFINITIONS: { key: string; label: string; formula: string }[] = [
  { key: "spend", label: "Gasto", formula: "Σ spend da Meta Insights no período (nível anúncio)" },
  { key: "gross_revenue", label: "Receita Bruta", formula: "Σ valor cobrado dos pedidos Cakto aprovados no período (paid_at)" },
  { key: "net_revenue", label: "Receita Líquida", formula: "Receita Bruta − Reembolsos − Chargebacks − Taxas Cakto" },
  { key: "profit", label: "Lucro estimado", formula: "Receita Líquida − Gasto − Outros custos configurados" },
  { key: "roas", label: "ROAS", formula: "Receita Líquida ÷ Gasto (mesmo critério da UTMify)" },
  { key: "cpa", label: "CPA", formula: "Gasto ÷ Vendas aprovadas (pedidos principais)" },
  { key: "approved_count", label: "Vendas aprovadas", formula: "nº de pedidos principais aprovados no período (sem bump/upsell)" },
  { key: "pix_generated", label: "Pix gerados", formula: "nº de pedidos Pix criados no período" },
  { key: "pix_conversion", label: "Conversão Pix", formula: "Pix pagos ÷ Pix gerados (mesma coorte)" },
  { key: "ticket", label: "Ticket médio", formula: "Receita Bruta ÷ Vendas aprovadas" },
  { key: "refunded_amount", label: "Reembolsos", formula: "Σ valor dos aprovados no período hoje reembolsados" },
  { key: "chargeback_amount", label: "Chargebacks", formula: "Σ valor dos aprovados no período hoje em chargeback" },
  { key: "untracked_count", label: "Não rastreadas", formula: "Vendas aprovadas com atribuição UNTRACKED/UNKNOWN" },
];
