import { describe, expect, it } from "vitest";
import { attribute, type Catalog } from "@/lib/core/attribution";

const catalog: Catalog = {
  synced: true,
  ads: [
    { account_id: "1", campaign_id: "120200000000000001", campaign_name: "Campanha A", adset_id: "120200000000000002", adset_name: "Adset A", ad_id: "120200000000000123", ad_name: "Ad 123" },
    { account_id: "1", campaign_id: "120200000000000001", campaign_name: "Campanha A", adset_id: "120200000000000002", adset_name: "Adset A", ad_id: "120200000000000124", ad_name: "Ad 124" },
    { account_id: "1", campaign_id: "120200000000000010", campaign_name: "Campanha B", adset_id: "120200000000000011", adset_name: "Adset B", ad_id: "120200000000000012", ad_name: "Ad 123" },
  ],
};
const utm = {
  utm_source: "FB",
  utm_campaign: "Campanha A|120200000000000001",
  utm_medium: "Adset A|120200000000000002",
  utm_content: "Ad 123|120200000000000123",
  utm_term: "Instagram_Reels",
};

describe("motor de atribuição", () => {
  it("EXACT_ID pelo ad_id (estrutura vem do catálogo)", () => {
    const r = attribute({ utms: utm, catalog, offerMapped: true });
    expect(r.status).toBe("EXACT_ID");
    expect(r.method).toBe("ad_id");
    expect(r).toMatchObject({ campaign_id: "120200000000000001", adset_id: "120200000000000002", ad_id: "120200000000000123", reason: null });
  });

  it("ad_id vale mesmo com nome diferente (renomearam o anúncio)", () => {
    const r = attribute({ utms: { ...utm, utm_content: "Nome antigo|120200000000000123" }, catalog, offerMapped: true });
    expect(r.status).toBe("EXACT_ID");
    expect(r.ad_name).toBe("Ad 123");
  });

  it("conflito de IDs: vale o ad_id e registra issue", () => {
    const r = attribute({ utms: { ...utm, utm_campaign: "X|120200000000000010" }, catalog, offerMapped: true });
    expect(r.status).toBe("EXACT_ID");
    expect(r.campaign_id).toBe("120200000000000001");
    expect(r.issues.some((i) => i.code === "ID_CONFLICT")).toBe(true);
  });

  it("ad_id ainda não sincronizado → UTM_PARSED com motivo", () => {
    const r = attribute({ utms: { ...utm, utm_content: "Novo|120200000000009999" }, catalog, offerMapped: true });
    expect(r.status).toBe("UTM_PARSED");
    expect(r.reason).toBe("ad_id_not_found");
    expect(r.ad_id).toBe("120200000000009999");
  });

  it("catálogo vazio → ad_not_synced", () => {
    const r = attribute({ utms: utm, catalog: { ads: [], synced: false }, offerMapped: true });
    expect(r).toMatchObject({ status: "UTM_PARSED", reason: "ad_not_synced" });
  });

  it("sem ad_id mas com adset_id conhecido → atribui ao conjunto", () => {
    const r = attribute({ utms: { ...utm, utm_content: "Ad 123" }, catalog, offerMapped: true });
    expect(r).toMatchObject({ status: "EXACT_ID", adset_id: "120200000000000002", ad_id: null, reason: "missing_ad_id" });
  });

  it("venda sem UTM → UNTRACKED/no_utm", () => {
    expect(attribute({ utms: {}, catalog, offerMapped: true })).toMatchObject({ status: "UNTRACKED", reason: "no_utm" });
  });

  it("macro não resolvida em tudo → UNKNOWN/macro_unresolved", () => {
    const r = attribute({ utms: { utm_source: "FB", utm_campaign: "{{campaign.name}}|{{campaign.id}}", utm_medium: "{{adset.name}}|{{adset.id}}", utm_content: "{{ad.name}}|{{ad.id}}" }, catalog, offerMapped: true });
    expect(r).toMatchObject({ status: "UNKNOWN", reason: "macro_unresolved" });
  });

  it("NAME_MATCH só quando o nome é exato e único", () => {
    const ok = attribute({ utms: { utm_source: "FB", utm_campaign: "campanha a", utm_medium: "adset a", utm_content: "ad 124" }, catalog, offerMapped: true });
    expect(ok).toMatchObject({ status: "NAME_MATCH", ad_id: "120200000000000124" });
    // "Ad 123" existe em duas campanhas → ambíguo, sem atribuição falsa
    const amb = attribute({ utms: { utm_source: "FB", utm_content: "Ad 123" }, catalog, offerMapped: true });
    expect(amb).toMatchObject({ status: "UNKNOWN", reason: "ambiguous_name", ad_id: null });
  });

  it("sem fuzzy: nome parecido não casa", () => {
    const r = attribute({ utms: { utm_source: "FB", utm_campaign: "Campanha A2" }, catalog, offerMapped: true });
    expect(r).toMatchObject({ status: "UNKNOWN", reason: "name_not_found", campaign_id: null });
  });

  it("orgânico e fonte desconhecida", () => {
    expect(attribute({ utms: { utm_source: "ig_bio" }, catalog, offerMapped: true }).status).toBe("ORGANIC");
    expect(attribute({ utms: { utm_source: "parceiro-x" }, catalog, offerMapped: true })).toMatchObject({ status: "UNKNOWN", reason: "source_unknown" });
  });

  it("oferta não mapeada é sinalizada mesmo com ID exato", () => {
    const r = attribute({ utms: utm, catalog, offerMapped: false });
    expect(r).toMatchObject({ status: "EXACT_ID", reason: "offer_not_mapped" });
  });

  it("UTMs perdidas no checkout: usa as do tracker via callback", () => {
    const r = attribute({ utms: {}, session: { session_id: "sabc12345", referrer_host: "facebook.com", utms: utm }, catalog, offerMapped: true });
    expect(r).toMatchObject({ status: "EXACT_ID", method: "ad_id+tracker_session", usedParams: "session" });
  });

  it("sessão sem UTM e sem referrer → DIRECT", () => {
    expect(attribute({ utms: {}, session: { session_id: "sabc12345", referrer_host: null, utms: {} }, catalog, offerMapped: true }).status).toBe("DIRECT");
  });
});
