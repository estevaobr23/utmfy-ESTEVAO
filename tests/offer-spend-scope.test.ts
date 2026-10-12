import { describe, expect, it } from "vitest";
import { parseCampaignScope, scopeOfferSpendRows } from "@/lib/core/offer-spend-scope";
import type { SpendRow } from "@/lib/core/report";

const row = (account: string, campaign: string, name: string): SpendRow => ({
  account_id: account,
  campaign_id: campaign,
  campaign_name: name,
  adset_id: `${campaign}-set`,
  adset_name: "Conjunto",
  ad_id: `${campaign}-ad`,
  ad_name: "Anúncio",
  currency: "BRL",
  impressions: 10,
  clicks: 1,
  outbound_clicks: 1,
  spend: 5,
  meta_purchases: null,
});

describe("isolamento de gasto por oferta", () => {
  it("filtro vazio fica pendente e nunca libera a conta inteira", () => {
    expect(parseCampaignScope(null)).toEqual({ mode: "pending" });
    const scoped = scopeOfferSpendRows([row("1", "10", "Calistenia")], [{ accountId: "1", campaignFilter: null }]);
    expect(scoped.rows).toEqual([]);
    expect(scoped.pendingAccounts).toEqual(["1"]);
  });

  it("aceita lista persistente de IDs sem misturar outra campanha da conta", () => {
    const rows = [row("1", "10", "Calistenia"), row("1", "20", "Casas")];
    const scoped = scopeOfferSpendRows(rows, [{ accountId: "1", campaignFilter: "10, 30" }]);
    expect(scoped.rows.map((item) => item.campaign_id)).toEqual(["10"]);
  });

  it("mantém filtro legado por nome somente por compatibilidade", () => {
    const rows = [row("1", "10", "Calistenia Vendas"), row("1", "20", "Casas")];
    expect(scopeOfferSpendRows(rows, [{ accountId: "1", campaignFilter: "calistenia" }]).rows).toHaveLength(1);
  });
});
