import type { SpendRow } from "./report";

export type OfferSpendLink = {
  accountId: string;
  campaignFilter: string | null;
};

export type CampaignScope =
  | { mode: "pending" }
  | { mode: "ids"; campaignIds: Set<string> }
  | { mode: "legacy_name"; fragment: string };

/**
 * O campo legado campaign_filter aceita uma lista CSV de IDs persistentes.
 * Texto não numérico continua funcionando como filtro legado por nome.
 * Vazio nunca significa "conta inteira" dentro de uma oferta.
 */
export function parseCampaignScope(value: string | null | undefined): CampaignScope {
  const raw = value?.trim();
  if (!raw) return { mode: "pending" };
  const tokens = raw.split(/[\s,;]+/).map((part) => part.trim()).filter(Boolean);
  if (tokens.length && tokens.every((part) => /^\d{1,30}$/.test(part))) {
    return { mode: "ids", campaignIds: new Set(tokens) };
  }
  return { mode: "legacy_name", fragment: raw.toLocaleLowerCase("pt-BR") };
}

export function scopeOfferSpendRows(rows: SpendRow[], links: OfferSpendLink[]) {
  const byAccount = new Map(links.map((link) => [link.accountId, parseCampaignScope(link.campaignFilter)]));
  const pendingAccounts = links
    .filter((link) => parseCampaignScope(link.campaignFilter).mode === "pending")
    .map((link) => link.accountId);

  const scopedRows = rows.filter((row) => {
    const scope = byAccount.get(row.account_id);
    if (!scope || scope.mode === "pending") return false;
    if (scope.mode === "ids") return scope.campaignIds.has(row.campaign_id);
    return (row.campaign_name ?? "").toLocaleLowerCase("pt-BR").includes(scope.fragment);
  });

  return { rows: scopedRows, pendingAccounts };
}
