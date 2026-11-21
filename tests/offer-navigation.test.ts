import { describe, expect, it } from "vitest";
import { ADMIN_PATHS, CONSOLIDATED_HREF, OFFER_SECTIONS, isAdminPath, normalizeOfferSection, offerContextFromPath, offerSectionLinks, offerSwitchHref, resolveSelectedOffer, rootRedirectTarget, safeNextPath, wantsConsolidated } from "@/lib/core/offer-navigation";

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

  describe("abrir a UTMFY volta para a última oferta (bug 21/11: voltava para 'Todas as ofertas')", () => {
    const valid = (id: string) => id === A;
    it("raiz sem parâmetros + cookie de oferta válida → resumo da oferta", () => {
      expect(rootRedirectTarget({}, A, valid)).toBe(`/ofertas/${A}/resumo`);
    });
    it("leva só o período da URL junto", () => {
      expect(rootRedirectTarget({ preset: "month", campaign: "123" }, A, valid)).toBe(`/ofertas/${A}/resumo?preset=month`);
      expect(rootRedirectTarget({ from: "2026-11-01", to: "2026-11-20" }, A, valid)).toBe(`/ofertas/${A}/resumo?from=2026-11-01&to=2026-11-20`);
    });
    it("'Todas as ofertas' escolhido de propósito fica no consolidado", () => {
      expect(CONSOLIDATED_HREF).toBe("/?todas=1");
      expect(wantsConsolidated({ todas: "1" })).toBe(true);
      expect(wantsConsolidated({ todas: "0" })).toBe(false);
      expect(wantsConsolidated({})).toBe(false);
      expect(rootRedirectTarget({ todas: "1" }, A, valid)).toBeNull();
    });
    it("oferta apagada/arquivada/de outro workspace (validação do servidor falha) → consolidado, sem laço", () => {
      expect(rootRedirectTarget({}, B, valid)).toBeNull();
    });
    it("sem cookie ou cookie com lixo → consolidado", () => {
      expect(rootRedirectTarget({}, null, valid)).toBeNull();
      expect(rootRedirectTarget({}, "../../etc", () => true)).toBeNull();
    });
    it("aviso de uma ação (?ok= / ?error=) não é engolido pelo redirect", () => {
      expect(rootRedirectTarget({ ok: "Dados DEMO criados" }, A, valid)).toBeNull();
      expect(rootRedirectTarget({ error: "x" }, A, valid)).toBeNull();
    });
    it("telas consolidadas continuam sem oferta selecionada (a lembrança fica no cookie)", () => {
      expect(resolveSelectedOffer("/", null, A, [A])).toBeNull();
    });
  });

  describe("destino depois do login", () => {
    it("aceita só caminho interno", () => {
      expect(safeNextPath(`/ofertas/${A}/meta?preset=7d`)).toBe(`/ofertas/${A}/meta?preset=7d`);
      expect(safeNextPath("/campanhas")).toBe("/campanhas");
    });
    it("recusa externo, protocolo, barra invertida e /login", () => {
      for (const bad of ["https://mal.com", "//mal.com", "/\\mal.com", "javascript:alert(1)", "/login", "/login?next=/x", "", null, undefined]) {
        expect(safeNextPath(bad as string | null | undefined)).toBe("/");
      }
    });
  });
});
