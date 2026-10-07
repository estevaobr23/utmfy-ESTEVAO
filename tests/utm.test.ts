import { describe, expect, it } from "vitest";
import { classifySource, parsePart, parseUtms, safeDecode } from "@/lib/core/utm";

describe("parsePart", () => {
  it("NOME|ID (padrão)", () => {
    expect(parsePart("Campanha A|120200000000000001")).toMatchObject({ name: "Campanha A", id: "120200000000000001", unresolvedMacro: false });
  });
  it("ID|NOME (invertido)", () => {
    expect(parsePart("120200000000000001|Campanha A")).toMatchObject({ name: "Campanha A", id: "120200000000000001" });
  });
  it("só ID", () => {
    expect(parsePart("120200000000000123")).toMatchObject({ name: null, id: "120200000000000123" });
  });
  it("só nome", () => {
    expect(parsePart("Topo de funil - Frio")).toMatchObject({ name: "Topo de funil - Frio", id: null });
  });
  it("nome com | no meio preserva o nome", () => {
    expect(parsePart("[CESTA] | Frio | LAL|120200000000000001")).toMatchObject({ name: "[CESTA] | Frio | LAL", id: "120200000000000001" });
  });
  it("sufixo ' - ID' com 12+ dígitos", () => {
    expect(parsePart("Criativo 3 - 120200000000000123")).toMatchObject({ name: "Criativo 3", id: "120200000000000123" });
  });
  it("número curto no nome NÃO vira id (evita falso positivo)", () => {
    expect(parsePart("Promo 2026")).toMatchObject({ name: "Promo 2026", id: null });
    expect(parsePart("Ad - 123")).toMatchObject({ id: null });
  });
  it("URL-encoded (%7C) e '+'", () => {
    expect(parsePart("Campanha+A%7C120200000000000001")).toMatchObject({ name: "Campanha A", id: "120200000000000001" });
  });
  it("duplamente codificado é decodificado e sinalizado", () => {
    const p = parsePart("Campanha%2520A%257C120200000000000001");
    expect(p).toMatchObject({ name: "Campanha A", id: "120200000000000001", encodingIssue: true });
  });
  it("macro não resolvida", () => {
    expect(parsePart("{{campaign.name}}|{{campaign.id}}")).toMatchObject({ unresolvedMacro: true, id: null, name: null });
    expect(parsePart("%7B%7Bad.id%7D%7D")).toMatchObject({ unresolvedMacro: true });
    expect(parsePart("{campaign.id}")).toMatchObject({ unresolvedMacro: true });
  });
  it("nome resolvido + id com macro não inventa id", () => {
    expect(parsePart("Campanha A|{{campaign.id}}")).toMatchObject({ id: null });
  });
  it("vazio / null / 'null'", () => {
    expect(parsePart(null).raw).toBeNull();
    expect(parsePart("  ").raw).toBeNull();
    expect(parsePart("null").raw).toBeNull();
  });
});

describe("parseUtms", () => {
  const full = {
    utm_source: "FB",
    utm_campaign: "Campanha A|120200000000000001",
    utm_medium: "Adset A|120200000000000002",
    utm_content: "Ad 123|120200000000000123",
    utm_term: "Instagram_Reels",
  };
  it("extrai campaign/adset/ad/placement", () => {
    const r = parseUtms(full);
    expect(r.campaign).toMatchObject({ name: "Campanha A", id: "120200000000000001" });
    expect(r.adset).toMatchObject({ name: "Adset A", id: "120200000000000002" });
    expect(r.ad).toMatchObject({ name: "Ad 123", id: "120200000000000123" });
    expect(r.placement).toBe("Instagram_Reels");
    expect(r.sourceKind).toBe("meta");
    expect(r.issues).toEqual([]);
  });
  it("venda sem UTM", () => {
    const r = parseUtms({});
    expect(r.hasAnyUtm).toBe(false);
    expect(r.issues.map((i) => i.code)).toEqual(["NO_UTM"]);
  });
  it("macro não resolvida é reportada com a mensagem exata", () => {
    const r = parseUtms({ ...full, utm_campaign: "{{campaign.name}}" });
    const m = r.issues.find((i) => i.code === "MACRO_UNRESOLVED");
    expect(m?.message).toBe("utm_campaign chegou como {{campaign.name}} (macro não resolvida pela Meta).");
  });
  it("ad_id ausente é sinalizado", () => {
    const r = parseUtms({ ...full, utm_content: "Ad 123" });
    expect(r.issues.map((i) => i.code)).toContain("MISSING_AD_ID");
  });
  it("utm_id preenche campaign_id quando faltar", () => {
    expect(parseUtms({ utm_source: "fb", utm_campaign: "Camp", utm_id: "120200000000000001" }).campaign.id).toBe("120200000000000001");
  });
});

describe("classifySource / safeDecode", () => {
  it("classifica origens", () => {
    expect(classifySource("FB")).toBe("meta");
    expect(classifySource("instagram")).toBe("meta");
    expect(classifySource("ig_bio")).toBe("organic");
    expect(classifySource("whatsapp")).toBe("organic");
    expect(classifySource("google")).toBe("other");
    expect(classifySource(null)).toBe("none");
  });
  it("não quebra com % inválido", () => {
    expect(safeDecode("100%").value).toBe("100%");
    expect(safeDecode("%E0%A4%A").encodingIssue).toBe(true);
  });
});
