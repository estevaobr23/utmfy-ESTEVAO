// Agrega gasto (Meta) e vendas (Cakto) por nível: conta, campanha, conjunto ou
// anúncio. Mesmas somas e fórmulas do resto do app (metrics.ts). Função pura.
import { addSums, derive, emptySums, type BaseSums, type Derived } from "./metrics";
import { orderToSums, spendToSums, type OrderRow, type SpendRow } from "./report";

export type Level = "contas" | "campanhas" | "conjuntos" | "anuncios";
export const LEVELS: [Level, string][] = [["contas", "Contas"], ["campanhas", "Campanhas"], ["conjuntos", "Conjuntos"], ["anuncios", "Anúncios"]];

export type LevelRow = { id: string; name: string; campaignId: string | null; adsetId: string | null; accountId: string | null; metrics: Derived };

const NO_ID = "__sem_id__";
const MISSING: Record<Level, string> = {
  contas: "(conta não identificada)",
  campanhas: "(campanha não identificada)",
  conjuntos: "(conjunto não identificado)",
  anuncios: "(anúncio não identificado)",
};

type Acc = { name: string | null; campaignId: string | null; adsetId: string | null; accountId: string | null; sums: BaseSums };

export function aggregateLevel(
  level: Level,
  spend: SpendRow[],
  orders: OrderRow[],
  opts: { campaign?: string | null; adset?: string | null; name?: string | null } = {},
): { rows: LevelRow[]; total: Derived } {
  const accountOf = new Map(spend.map((s) => [s.campaign_id, s.account_id]));
  const inScope = (c: string | null, a: string | null) => (!opts.campaign || c === opts.campaign) && (!opts.adset || a === opts.adset);
  const map = new Map<string, Acc>();
  const add = (r: { account_id?: string | null; campaign_id: string | null; campaign_name: string | null; adset_id: string | null; adset_name: string | null; ad_id: string | null; ad_name: string | null }, sums: Partial<BaseSums>) => {
    const account = r.account_id ?? (r.campaign_id ? accountOf.get(r.campaign_id) ?? null : null);
    const [id, name] =
      level === "contas" ? [account, null]
      : level === "campanhas" ? [r.campaign_id, r.campaign_name]
      : level === "conjuntos" ? [r.adset_id, r.adset_name]
      : [r.ad_id, r.ad_name];
    const key = id ?? NO_ID;
    let n = map.get(key);
    if (!n) map.set(key, (n = { name: null, campaignId: r.campaign_id, adsetId: r.adset_id, accountId: account, sums: emptySums() }));
    if (!n.name && name) n.name = name;
    n.sums = addSums(n.sums, sums);
  };
  for (const s of spend) if (inScope(s.campaign_id, s.adset_id)) add(s, spendToSums(s));
  // Venda sem campanha identificada não entra em nenhuma linha (fica em "sem anúncio" nos totais da oferta).
  for (const o of orders) if (o.campaign_id && inScope(o.campaign_id, o.adset_id)) add(o, orderToSums(o));

  const q = opts.name?.trim().toLowerCase();
  const rows = [...map.entries()]
    .map(([id, a]) => ({
      id,
      name: a.name ?? (id === NO_ID ? MISSING[level] : id),
      campaignId: a.campaignId,
      adsetId: a.adsetId,
      accountId: a.accountId,
      sums: a.sums,
    }))
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((x, y) => y.sums.spend - x.sums.spend || y.sums.gross_revenue - x.sums.gross_revenue);
  const total = derive(rows.reduce((t, r) => addSums(t, r.sums), emptySums()));
  return { rows: rows.map(({ sums, ...r }) => ({ ...r, metrics: derive(sums) })), total };
}
