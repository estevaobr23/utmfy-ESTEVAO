import { describe, expect, it } from "vitest";
import { ADMIN_PATHS, OFFER_SECTIONS, isAdminPath, normalizeOfferSection, offerContextFromPath, offerSectionLinks, offerSwitchHref, resolveSelectedOffer } from "@/lib/core/offer-navigation";

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

  describe("oferta selecionada ao navegar pela Administração (bug: voltava para 'Todas as ofertas')", () => {
    const known = [A, B];
    it("a URL da oferta sempre manda", () => {
      expect(resolveSelectedOffer(`/ofertas/${A}/meta`, A, B, known)).toBe(A);
    });
    it("em TODA tela de Administração a oferta lembrada continua selecionada", () => {
      for (const path of ADMIN_PATHS) {
        expect(isAdminPath(path)).toBe(true);
        expect(resolveSelectedOffer(path, null, A, known)).toBe(A);
      }
      expect(resolveSelectedOffer("/pixels/qualquer", null, A, known)).toBe(A);
    });
    it("telas consolidadas não têm oferta (é assim que 'Todas as ofertas' funciona)", () => {
      for (const path of ["/", "/campanhas", "/pedidos", "/ofertas", "/nao-rastreadas"]) {
        expect(isAdminPath(path)).toBe(false);
        expect(resolveSelectedOffer(path, null, A, known)).toBeNull();
      }
    });
    it("sem oferta lembrada, ou lembrada e já inexistente, não inventa oferta", () => {
      expect(resolveSelectedOffer("/pixels", null, null, known)).toBeNull();
      expect(resolveSelectedOffer("/pixels", null, "99999999-9999-4999-8999-999999999999", known)).toBeNull();
    });
    it("não confunde prefixo parecido com tela de Administração", () => {
      expect(isAdminPath("/metadata")).toBe(false);
      expect(isAdminPath("/pixelsx")).toBe(false);
    });
  });
});
