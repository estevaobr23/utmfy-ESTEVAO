// Campanhas/conjuntos/anúncios ATIVOS do catálogo da Meta que ainda não têm linha na tabela porque
// ainda não gastaram nem venderam no período (ex.: campanha agendada para 01:00). Entram zerados,
// para o usuário ver na hora que o painel enxerga a campanha. Função pura.
import type { Level } from "./meta-levels";

export type CatalogEntry = {
  account_id: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  effective_status: string | null;
};

export type CatalogOnlyRow = { id: string; name: string; accountId: string; campaignId: string; adsetId: string | null; status: string };

/** Status em que o objeto está (ou vai estar) no ar. Pausado, arquivado e reprovado só aparecem se tiverem gasto. */
const LIVE = new Set(["ACTIVE", "PENDING_REVIEW", "IN_PROCESS", "WITH_ISSUES", "PENDING_BILLING_INFO"]);

export function catalogOnlyRows(
  level: Exclude<Level, "contas">,
  catalog: CatalogEntry[],
  existingIds: Set<string>,
  opts: { account?: string | null; campaign?: string | null; adset?: string | null; adsetIds?: Set<string> | null; name?: string | null } = {},
): CatalogOnlyRow[] {
  const q = opts.name?.trim().toLowerCase();
  const groups = new Map<string, { name: string | null; accountId: string; campaignId: string; adsetId: string | null; live: boolean }>();
  for (const ad of catalog) {
    if (opts.account && ad.account_id !== opts.account) continue;
    if (opts.campaign && ad.campaign_id !== opts.campaign) continue;
    if (opts.adset && ad.adset_id !== opts.adset) continue;
    if (opts.adsetIds && !opts.adsetIds.has(ad.adset_id)) continue;
    const [id, name] = level === "campanhas" ? [ad.campaign_id, ad.campaign_name] : level === "conjuntos" ? [ad.adset_id, ad.adset_name] : [ad.ad_id, ad.ad_name];
    if (!id || existingIds.has(id)) continue;
    const g = groups.get(id) ?? { name, accountId: ad.account_id, campaignId: ad.campaign_id, adsetId: level === "campanhas" ? null : ad.adset_id, live: false };
    if (!g.name && name) g.name = name;
    if (ad.effective_status && LIVE.has(ad.effective_status)) g.live = true;
    groups.set(id, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.live)
    .map(([id, g]) => ({ id, name: g.name ?? id, accountId: g.accountId, campaignId: g.campaignId, adsetId: g.adsetId, status: "ACTIVE" }))
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}
