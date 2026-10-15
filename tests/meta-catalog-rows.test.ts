import { describe, expect, it } from "vitest";
import { catalogOnlyRows, type CatalogEntry } from "@/lib/core/meta-catalog-rows";

const ad = (over: Partial<CatalogEntry>): CatalogEntry => ({
  account_id: "1", campaign_id: "c1", campaign_name: "Camp 1", adset_id: "s1", adset_name: "Conj 1", ad_id: "a1", ad_name: "Anúncio 1", effective_status: "ACTIVE", ...over,
});

describe("catalogOnlyRows", () => {
  it("lista campanha ativa que ainda não tem gasto", () => {
    expect(catalogOnlyRows("campanhas", [ad({})], new Set())).toEqual([{ id: "c1", name: "Camp 1", accountId: "1", campaignId: "c1", adsetId: null, status: "ACTIVE" }]);
  });
  it("não repete o que já tem linha (gasto ou venda no período)", () => {
    expect(catalogOnlyRows("campanhas", [ad({})], new Set(["c1"]))).toEqual([]);
  });
  it("ignora pausadas e arquivadas", () => {
    const rows = catalogOnlyRows("campanhas", [ad({ effective_status: "CAMPAIGN_PAUSED" }), ad({ campaign_id: "c2", effective_status: "ARCHIVED" })], new Set());
    expect(rows).toEqual([]);
  });
  it("campanha vale se ao menos um anúncio está no ar", () => {
    const rows = catalogOnlyRows("campanhas", [ad({ effective_status: "ADSET_PAUSED" }), ad({ ad_id: "a2", effective_status: "IN_PROCESS" })], new Set());
    expect(rows.map((r) => r.id)).toEqual(["c1"]);
  });
  it("respeita a oferta (conjuntos do pixel), a conta e os filtros de campanha/conjunto", () => {
    const catalog = [ad({}), ad({ campaign_id: "c2", campaign_name: "Camp 2", adset_id: "s2", ad_id: "a2", account_id: "2" })];
    expect(catalogOnlyRows("campanhas", catalog, new Set(), { adsetIds: new Set(["s1"]) }).map((r) => r.id)).toEqual(["c1"]);
    expect(catalogOnlyRows("campanhas", catalog, new Set(), { account: "2" }).map((r) => r.id)).toEqual(["c2"]);
    expect(catalogOnlyRows("conjuntos", catalog, new Set(), { campaign: "c2" }).map((r) => r.id)).toEqual(["s2"]);
    expect(catalogOnlyRows("anuncios", catalog, new Set(), { adset: "s1" }).map((r) => r.id)).toEqual(["a1"]);
  });
  it("filtra pelo nome digitado", () => {
    const catalog = [ad({}), ad({ campaign_id: "c2", campaign_name: "Outra", adset_id: "s2", ad_id: "a2" })];
    expect(catalogOnlyRows("campanhas", catalog, new Set(), { name: "outra" }).map((r) => r.id)).toEqual(["c2"]);
  });
});
