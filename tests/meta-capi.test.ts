import { describe, expect, it } from "vitest";
import { buildPurchaseEvent, normalizePlace, purchaseEventId, splitName } from "@/lib/core/capi";
import { sha256Hex } from "@/lib/core/hash";
import { chunkRange, classifyMetaError, normalizeInsight } from "@/lib/core/meta";
import { buildMetaUrlParameters, lintTemplate } from "@/lib/core/utm-template";

describe("Meta insights", () => {
  it("normaliza linha de insight (strings → números, outbound_clicks, compras Meta separadas)", () => {
    const r = normalizeInsight({
      account_id: "act_123", account_currency: "BRL", campaign_id: "1", campaign_name: "C", adset_id: "2", adset_name: "S", ad_id: "3", ad_name: "A",
      impressions: "1000", reach: "800", clicks: "30", inline_link_clicks: "25", outbound_clicks: [{ action_type: "outbound_click", value: "20" }],
      spend: "10.004", actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "2" }], action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "65.8" }],
      date_start: "2026-09-30", date_stop: "2026-09-30",
    });
    expect(r).toMatchObject({ account_id: "123", impressions: 1000, reach: 800, outbound_clicks: 20, spend: 10, meta_purchases: 2, meta_purchase_value: 65.8, date: "2026-09-30" });
  });
  it("linha sem ad_id é descartada", () => {
    expect(normalizeInsight({ campaign_id: "1", date_start: "2026-09-30" })).toBeNull();
  });
  it("classifica erros da Graph API", () => {
    expect(classifyMetaError(400, { error: { code: 190, message: "Error validating access token" } }).kind).toBe("token_expired");
    expect(classifyMetaError(403, { error: { code: 200, message: "Permissions error" } }).kind).toBe("no_permission");
    expect(classifyMetaError(400, { error: { code: 17, message: "User request limit reached" } }).kind).toBe("rate_limited");
    expect(classifyMetaError(400, { error: { code: 80004, message: "too many calls" } }).kind).toBe("rate_limited");
    expect(classifyMetaError(500, {}).kind).toBe("transient");
  });
  it("quebra períodos grandes em blocos", () => {
    expect(chunkRange("2026-01-01", "2026-03-05", 31)).toEqual([
      { since: "2026-01-01", until: "2026-01-31" },
      { since: "2026-02-01", until: "2026-03-03" },
      { since: "2026-03-04", until: "2026-03-05" },
    ]);
  });
});

describe("template de UTMs", () => {
  it("gera o padrão NOME|ID com macros oficiais", () => {
    expect(buildMetaUrlParameters({ source: "FB" })).toBe(
      "utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}",
    );
  });
  it("avisa campos ausentes e macros inventadas", () => {
    const l = lintTemplate("utm_source=FB&utm_campaign={{campaign.name}}&utm_content={{ad.nome}}");
    expect(l.filter((x) => x.level === "error").map((x) => x.message)).toEqual(expect.arrayContaining([expect.stringContaining("{{ad.id}}"), expect.stringContaining("{{ad.nome}}")]));
    expect(lintTemplate(buildMetaUrlParameters({ source: "FB" }))[0].level).toBe("ok");
  });
});

describe("CAPI (preparado)", () => {
  const base = {
    provider: "cakto", external_order_id: "XYZ", gross_amount: 32.9, currency: "BRL", paid_at: "2026-09-30T13:00:00Z",
    customer_email_sha256: "a".repeat(64), customer_phone_sha256: "b".repeat(64), fbc: "fb.1.1.abc", fbp: "fb.1.1.123",
    client_user_agent: "Mozilla/5.0", event_source_url: "https://pagina.com/vendas", product_external_id: "P1",
  };
  const now = Math.floor(new Date("2026-09-30T14:00:00Z").getTime() / 1000);
  it("event_id determinístico", () => {
    expect(purchaseEventId("cakto", "XYZ")).toBe("cakto:XYZ:Purchase");
  });
  it("monta Purchase com hashes e sem PII em claro", () => {
    const r = buildPurchaseEvent(base, now);
    if (!("event" in r)) throw new Error("esperava evento");
    expect(r.event).toMatchObject({ event_name: "Purchase", event_id: "cakto:XYZ:Purchase", action_source: "website", custom_data: { value: 32.9, currency: "BRL" } });
    expect(r.event.user_data).toMatchObject({ em: ["a".repeat(64)], ph: ["b".repeat(64)], fbc: "fb.1.1.abc", client_user_agent: "Mozilla/5.0" });
  });
  it("regras da Meta: > 7 dias ignora; website sem sessão do tracker (sem user agent/página) é ignorado", () => {
    expect(buildPurchaseEvent({ ...base, paid_at: "2026-09-01T00:00:00Z" }, now)).toEqual({ skip: "event_too_old" });
    expect(buildPurchaseEvent({ ...base, client_user_agent: null }, now)).toEqual({ skip: "no_tracker_session" });
    expect(buildPurchaseEvent({ ...base, event_source_url: null }, now)).toEqual({ skip: "no_tracker_session" });
  });
  it("sem nenhum identificador real (só client_user_agent) é ignorado, não é mandado 'vazio' pra Meta", () => {
    const semIdentificador = { ...base, customer_email_sha256: null, customer_phone_sha256: null, fbc: null, fbp: null };
    expect(buildPurchaseEvent(semIdentificador, now)).toEqual({ skip: "no_identifying_user_data" });
  });
  it("enriquecimento: nome, cidade/estado/país, IP e external_id entram com hash só onde a Meta pede", () => {
    const r = buildPurchaseEvent(
      { ...base, customer_fn_sha256: "c".repeat(64), customer_ln_sha256: "d".repeat(64), client_ip: "2804:14d:1::1", geo_country: "BR", geo_region: "SP", geo_city: "São Paulo", external_id: "sabc123xyz" },
      now,
    );
    if (!("event" in r)) throw new Error("esperava evento");
    const u = r.event.user_data;
    expect(u.fn).toEqual(["c".repeat(64)]);
    expect(u.ln).toEqual(["d".repeat(64)]);
    expect(u.client_ip_address).toBe("2804:14d:1::1"); // IP nunca com hash
    expect(u.ct).toEqual([sha256Hex("saopaulo")]);
    expect(u.st).toEqual([sha256Hex("sp")]);
    expect(u.country).toEqual([sha256Hex("br")]);
    expect(u.external_id).toEqual([sha256Hex("sabc123xyz")]);
    expect(JSON.stringify(r.event)).not.toContain("São Paulo");
  });
  it("sem os campos novos o evento sai como antes (retrocompatível)", () => {
    const r = buildPurchaseEvent(base, now);
    if (!("event" in r)) throw new Error("esperava evento");
    expect(Object.keys(r.event.user_data).sort()).toEqual(["client_user_agent", "em", "fbc", "fbp", "ph"]);
  });
  it("normaliza nome e lugar como a Meta pede", () => {
    expect(splitName("  Maria  da Silva ")).toEqual({ first: "maria", last: "silva" });
    expect(splitName("João")).toEqual({ first: "joao", last: null });
    expect(splitName(null)).toEqual({ first: null, last: null });
    expect(normalizePlace("São José dos Campos")).toBe("saojosedoscampos");
    expect(normalizePlace(null)).toBeNull();
  });
});
