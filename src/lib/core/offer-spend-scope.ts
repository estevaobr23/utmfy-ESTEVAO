import type { SpendRow } from "./report";

export type OfferSpendLink = {
  accountId: string;
  campaignFilter: string | null;
};

export type OfferMetaBinding = {
  offerId: string;
  accountId: string;
  level: "campaign" | "adset";
  objectId: string;
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

/**
 * Atribui cada linha no nível mais específico. Um conjunto confirmado vence a
 * associação da campanha e impede que o mesmo gasto entre em duas ofertas.
 */
export function scopeOfferSpendRowsByBindings(rows: SpendRow[], offerId: string, linkedAccounts: string[], bindings: OfferMetaBinding[]) {
  const adsetOwner = new Map<string, string>();
  const campaignOwner = new Map<string, string>();
  const key = (accountId: string, objectId: string) => `${accountId}:${objectId}`;
  for (const binding of bindings) {
    const target = binding.level === "adset" ? adsetOwner : campaignOwner;
    target.set(key(binding.accountId, binding.objectId), binding.offerId);
  }
  const rowsForOffer = rows.filter((row) => {
    const specific = adsetOwner.get(key(row.account_id, row.adset_id));
    if (specific) return specific === offerId;
    return campaignOwner.get(key(row.account_id, row.campaign_id)) === offerId;
  });
  const accountsWithBinding = new Set(bindings.filter((binding) => binding.offerId === offerId).map((binding) => binding.accountId));
  return {
    rows: rowsForOffer,
    pendingAccounts: linkedAccounts.filter((accountId) => !accountsWithBinding.has(accountId)),
    confirmedAccounts: [...accountsWithBinding],
  };
}
