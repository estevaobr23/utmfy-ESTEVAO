// Executa o public/t.js REAL num window/document simulados e compara com o
// espelho TS usado no Diagnóstico.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decorateCheckoutUrl, pickTrackerParams } from "@/lib/core/checkout-url";
import { diagnoseUrl } from "@/lib/core/diagnostic";

const SRC = readFileSync(join(__dirname, "..", "public", "t.js"), "utf8");


function makeEnv(href: string, opts: { storage?: Map<string, string>; cookie?: string; attrs?: Record<string, string>; links?: { href: string }[]; preset?: Record<string, unknown> } = {}) {
  const storage = opts.storage ?? new Map<string, string>();
  const beacons: string[] = [];
  const cookies = new Map<string, string>();
  (opts.cookie ?? "").split("; ").filter(Boolean).forEach((c) => {
    const [k, ...v] = c.split("=");
    cookies.set(k, v.join("="));
  });
  const links = (opts.links ?? []).map((l) => {
    const el = { tagName: "A", href: new URL(l.href, href).toString(), getAttribute: (n: string) => (n === "href" ? l.href : null), parentNode: null };
    return el;
  });
  const u = new URL(href);
  const listeners: Record<string, (e: unknown) => void> = {};
  const inserted: { src?: string }[] = [];
  const document = {
    currentScript: { src: "https://app.exemplo.com/t.js", getAttribute: (n: string) => opts.attrs?.[n] ?? (n === "data-offer" ? "00000000-0000-0000-0000-000000000001" : null) },
    readyState: "complete",
    referrer: "https://l.facebook.com/",
    get cookie() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(v: string) {
      const [pair] = v.split(";");
      const [k, ...rest] = pair.split("=");
      cookies.set(k.trim(), rest.join("="));
    },
    querySelectorAll: () => links,
    addEventListener: (ev: string, fn: (e: unknown) => void) => { listeners[ev] = fn; },
    createElement: () => ({}) as { src?: string },
    getElementsByTagName: () => [{ parentNode: { insertBefore: (el: { src?: string }) => { inserted.push(el); } } }],
  };
  const window: Record<string, unknown> = {
    location: { href, search: u.search, origin: u.origin, pathname: u.pathname, hostname: u.hostname },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
    crypto: globalThis.crypto,
    navigator: { sendBeacon: (_url: string, blob: Blob) => { beacons.push(String((blob as unknown as { size: number }).size)); return true; } },
    ...(opts.preset ?? {}),
  };
  new Function("window", "document", "URL", "URLSearchParams", "Blob", SRC)(window, document, URL, URLSearchParams, Blob);
  const T = window.UtmfyTracker as { decorate: (u: string) => string; sessionId: () => string; params: () => Record<string, string> };
  const click = (href: string, attrs: Record<string, string> = {}) =>
    listeners.click?.({ target: { tagName: "A", href, parentNode: null, hasAttribute: (n: string) => n in attrs } });
  const fbq = window.fbq as (((...a: unknown[]) => void) & { queue?: unknown[][] }) | undefined;
  return { T, storage, cookies, links, beacons, click, inserted, fbq, window };
}

const AD =
  "https://pagina.com/vendas?utm_source=FB&utm_campaign=Campanha%20A%7C120200000000000001&utm_medium=Adset%20A%7C120200000000000002&utm_content=Ad%20123%7C120200000000000123&utm_term=Instagram_Reels&fbclid=IwAR0abc";

describe("tracker public/t.js", () => {
  it("captura UTMs e decora o link da Cakto com callback", () => {
    const { T } = makeEnv(AD);
    const out = new URL(T.decorate("https://pay.cakto.com.br/a8BcHrY"));
    expect(out.searchParams.get("utm_campaign")).toBe("Campanha A|120200000000000001");
    expect(out.searchParams.get("utm_content")).toBe("Ad 123|120200000000000123");
    expect(out.searchParams.get("fbclid")).toBe("IwAR0abc");
    expect(out.searchParams.get("callback")).toBe(T.sessionId());
    expect(T.sessionId()).toMatch(/^[A-Za-z0-9._~-]{8,64}$/);
  });

  it("manda a sessão como sck no checkout (a Cakto devolve no webhook); sck existente é respeitado; data-sck=false desliga", () => {
    const { T } = makeEnv(AD);
    expect(new URL(T.decorate("https://pay.cakto.com.br/a8BcHrY")).searchParams.get("sck")).toBe(T.sessionId());
    expect(new URL(T.decorate("https://pay.cakto.com.br/a8BcHrY?sck=meu-codigo")).searchParams.get("sck")).toBe("meu-codigo");
    expect(new URL(T.decorate("https://pagina.com/obrigado")).searchParams.has("sck")).toBe(false); // só no checkout
    const off = makeEnv(AD, { attrs: { "data-sck": "false" } });
    expect(new URL(off.T.decorate("https://pay.cakto.com.br/a8BcHrY")).searchParams.has("sck")).toBe(false);
  });

  it("não destrói parâmetros existentes nem duplica ao decorar de novo", () => {
    const { T } = makeEnv(AD);
    const once = T.decorate("https://pay.cakto.com.br/a8BcHrY?utm_source=site&coupon=X");
    const twice = T.decorate(once);
    const u = new URL(twice);
    expect(u.searchParams.get("utm_source")).toBe("site");
    expect(u.searchParams.get("coupon")).toBe("X");
    expect(u.searchParams.getAll("utm_campaign")).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it("persiste entre páginas do funil (sem UTM na 2ª página)", () => {
    const first = makeEnv(AD);
    const second = makeEnv("https://pagina.com/obrigado", { storage: first.storage });
    expect(second.T.sessionId()).toBe(first.T.sessionId());
    expect(new URL(second.T.decorate("https://pay.cakto.com.br/xyz")).searchParams.get("utm_content")).toBe("Ad 123|120200000000000123");
  });

  it("first-touch preservado e last-touch atualizado", () => {
    const first = makeEnv(AD);
    const second = makeEnv("https://pagina.com/?utm_source=ig&utm_content=Outro%7C120200000000000999", { storage: first.storage });
    const saved = JSON.parse(second.storage.get("_utmfy")!);
    expect(saved.ft.p.utm_source).toBe("FB");
    expect(saved.lt.p.utm_source).toBe("ig");
    expect(new URL(second.T.decorate("https://pay.cakto.com.br/x")).searchParams.get("utm_content")).toBe("Outro|120200000000000999");
  });

  it("não mexe em links de terceiros e decora links já na página", () => {
    const env = makeEnv(AD, { links: [{ href: "https://pay.cakto.com.br/abc" }, { href: "https://google.com/x" }, { href: "#topo" }] });
    expect(env.links[0].href).toContain("callback=");
    expect(env.links[1].href).toBe("https://google.com/x");
    expect(env.T.decorate("https://google.com/?a=1")).toBe("https://google.com/?a=1");
  });

  it("cria _fbc a partir do fbclid e envia beacon", () => {
    const env = makeEnv(AD);
    expect(env.cookies.get("_fbc")).toMatch(/^fb\.1\.\d+\.IwAR0abc$/);
    expect(env.beacons.length).toBe(1);
  });

  it("data-callback=false não envia callback; domínios configuráveis", () => {
    const env = makeEnv(AD, { attrs: { "data-callback": "false", "data-checkout-domains": "checkout.meusite.com" } });
    expect(env.T.decorate("https://pay.cakto.com.br/x")).toBe("https://pay.cakto.com.br/x");
    expect(env.T.decorate("https://checkout.meusite.com/p")).not.toContain("callback=");
  });

  it("paridade com o espelho TS do Diagnóstico", () => {
    for (const checkout of ["https://pay.cakto.com.br/a8BcHrY", "https://pay.cakto.com.br/a8BcHrY?utm_source=site", "https://pay.cakto.com.br/a?callback=fixo&x=%20y"]) {
      const { T } = makeEnv(AD);
      const js = T.decorate(checkout);
      const ts = decorateCheckoutUrl(checkout, pickTrackerParams(new URL(AD).search), { sessionId: T.sessionId() }).url;
      expect(js).toBe(ts);
    }
  });
});

describe("diagnóstico de URL", () => {
  it("URL completa → sem erros", () => {
    const r = diagnoseUrl(AD, { checkoutUrl: "https://pay.cakto.com.br/a8BcHrY" });
    expect(r.overall).toBe("ok");
    expect(r.parsed?.ad.id).toBe("120200000000000123");
    expect(r.checkout?.added).toContain("callback");
  });
  it("macro não resolvida vira ERRO com a mensagem clara", () => {
    const r = diagnoseUrl("https://p.com/?utm_source=FB&utm_campaign={{campaign.name}}&utm_content=Ad%7C120200000000000123");
    expect(r.overall).toBe("error");
    expect(r.checks.some((c) => c.level === "error" && c.message.includes("utm_campaign chegou como {{campaign.name}}"))).toBe(true);
  });
  it("sem UTM, sem fbclid, URL inválida", () => {
    expect(diagnoseUrl("https://p.com/").checks.map((c) => c.code)).toEqual(expect.arrayContaining(["NO_UTM", "NO_FBCLID"]));
    expect(diagnoseUrl("não é url").valid).toBe(false);
  });
  it("encoding duplo e parâmetro duplicado são ATENÇÃO", () => {
    const r = diagnoseUrl("https://p.com/?utm_source=FB&utm_source=ig&utm_campaign=A%257C120200000000000001");
    expect(r.checks.map((c) => c.code)).toEqual(expect.arrayContaining(["DUPLICATED_PARAM", "ENCODING_ISSUE"]));
  });
});

describe("pixel da Meta no t.js (data-pixel)", () => {
  const PIXEL = "1278010487791087";
  const events = (e: ReturnType<typeof makeEnv>) => (e.fbq?.queue ?? []).map((a) => Array.from(a as ArrayLike<unknown>));

  it("sem data-pixel não carrega nem toca no pixel (compatível com páginas que já têm o seu)", () => {
    const e = makeEnv(AD);
    expect(e.fbq).toBeUndefined();
    expect(e.inserted).toHaveLength(0);
  });

  it("com data-pixel carrega o fbevents, faz init e dispara PageView", () => {
    const e = makeEnv(AD, { attrs: { "data-pixel": PIXEL } });
    expect(e.inserted[0]?.src).toBe("https://connect.facebook.net/en_US/fbevents.js");
    expect(events(e)).toEqual([["init", PIXEL, { external_id: e.T.sessionId() }], ["track", "PageView"]]);
  });

  it("InitiateCheckout dispara no clique do checkout (domínio ou data-checkout), 1× por clique", () => {
    const e = makeEnv(AD, { attrs: { "data-pixel": PIXEL } });
    e.click("https://pay.cakto.com.br/abc");
    e.click("https://pay.cakto.com.br/abc"); // clique duplo imediato não dobra
    expect(events(e).filter((a) => a[1] === "InitiateCheckout")).toHaveLength(1);
    const e2 = makeEnv(AD, { attrs: { "data-pixel": PIXEL } });
    e2.click("https://outro.site/ir", { "data-checkout": "" });
    expect(events(e2).filter((a) => a[1] === "InitiateCheckout")).toHaveLength(1);
  });

  it('data-initiate-checkout="false": mantém PageView mas não dispara InitiateCheckout no clique (a página assume o evento)', () => {
    const e = makeEnv(AD, { attrs: { "data-pixel": PIXEL, "data-initiate-checkout": "false" } });
    e.click("https://pay.cakto.com.br/abc");
    e.click("https://outro.site/ir", { "data-checkout": "" });
    expect(events(e)).toEqual([["init", PIXEL, { external_id: e.T.sessionId() }], ["track", "PageView"]]);
  });

  it("link comum (nem checkout nem data-checkout) não dispara InitiateCheckout", () => {
    const e = makeEnv(AD, { attrs: { "data-pixel": PIXEL } });
    e.click("https://pagina.com/sobre");
    expect(events(e).some((a) => a[1] === "InitiateCheckout")).toBe(false);
  });

  it("se a página já tem fbq, o t.js não mexe no pixel (evita eventos em dobro)", () => {
    const calls: unknown[][] = [];
    const own = Object.assign((...a: unknown[]) => { calls.push(a); }, { queue: [] as unknown[][] });
    const e = makeEnv(AD, { attrs: { "data-pixel": PIXEL }, preset: { fbq: own } });
    e.click("https://pay.cakto.com.br/abc");
    expect(calls).toEqual([]);
    expect(e.inserted).toHaveLength(0);
  });

  it("data-pixel inválido é ignorado", () => {
    const e = makeEnv(AD, { attrs: { "data-pixel": "abc" } });
    expect(e.fbq).toBeUndefined();
  });

  it("o rastreio de UTM segue igual com o pixel ligado", () => {
    const e = makeEnv(AD, { attrs: { "data-pixel": PIXEL } });
    const out = new URL(e.T.decorate("https://pay.cakto.com.br/a8BcHrY"));
    expect(out.searchParams.get("utm_content")).toBe("Ad 123|120200000000000123");
    expect(out.searchParams.get("callback")).toBe(e.T.sessionId());
  });
});
