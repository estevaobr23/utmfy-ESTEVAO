import { describe, expect, it } from "vitest";
import { OFFER_SECTIONS, normalizeOfferSection, offerContextFromPath, offerSectionLinks, offerSwitchHref } from "@/lib/core/offer-navigation";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("navegação por ofertas", () => {
  it("usa a URL como contexto e aceita somente ofertas conhecidas", () => {
    expect(offerContextFromPath(`/ofertas/${A}/meta`, [A, B])).toEqual({ offerId: A, section: "meta" });
    expect(offerContextFromPath(`/ofertas/${A}/meta`, [B])).toEqual({ offerId: null, section: "meta" });
    expect(offerContextFromPath("/campanhas", [A])).toEqual({ offerId: null, section: "resumo" });
  });

  it("troca a oferta preservando a seção, sem carregar filtros da URL", () => {
    expect(offerSwitchHref(B, A, "pedidos")).toBe(`/ofertas/${B}/pedidos`);
    expect(offerSwitchHref(B, null, "meta")).toBe(`/ofertas/${B}/resumo`);
  });

  it("normaliza rotas legadas e nunca propaga uma seção desconhecida", () => {
    expect(normalizeOfferSection("configurar")).toBe("integracoes");
    expect(normalizeOfferSection("saude")).toBe("tracking");
    expect(offerSwitchHref(B, A, "qualquer-coisa")).toBe(`/ofertas/${B}/resumo`);
  });

  it("gera todas as áreas obrigatórias mantendo o mesmo id da oferta", () => {
    const links = offerSectionLinks(A);
    expect(links.map(([href]) => href)).toEqual(OFFER_SECTIONS.map(([section]) => `/ofertas/${A}/${section}`));
    expect(links).toHaveLength(6);
  });
});
