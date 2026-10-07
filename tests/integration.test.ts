// Integração ponta a ponta contra o Supabase LOCAL (supabase start):
// webhook assinado → pedido → atribuição → gasto → relatório → dispatches CAPI.
// Pulado automaticamente se o Supabase local não estiver no ar.
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { caktoOrder, caktoWebhook } from "@/lib/core/cakto/fixtures";
import { buildTree, totals, type OrderRow, type SpendRow } from "@/lib/core/report";
import { handleCaktoWebhook } from "@/lib/services/cakto-webhook";

function loadEnv() {
  const f = join(__dirname, "..", ".env.local");
  if (!existsSync(f)) return {} as Record<string, string>;
  return Object.fromEntries(
    readFileSync(f, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}
const ENV = loadEnv();
const URL_ = ENV.NEXT_PUBLIC_SUPABASE_URL;
const available = !!URL_ && URL_.includes("127.0.0.1") && (await fetch(`${URL_}/rest/v1/`, { headers: { apikey: ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY } }).then(() => true, () => false));

const SECRET = "integration-secret";
const run = Date.now().toString(36);
const P_A = `prod-a-${run}`;
const P_B = `prod-b-${run}`;
const AD = "120299900000000123";
const ADSET = "120299900000000002";
const CAMP = "120299900000000001";
const UTM = { utm_source: "FB", utm_campaign: `Campanha A|${CAMP}`, utm_medium: `Adset A|${ADSET}`, utm_content: `Ad 123|${AD}`, utm_term: "Instagram_Reels" };

let db: SupabaseClient;
let WS = "";
let SLUG = "";
let OFFER_A = "";
let OFFER_B = "";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const nowTs = () => Math.floor(Date.now() / 1000);
async function send(event: string, data: unknown, opts: { ts?: number; secret?: string; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(caktoWebhook(event, data as Record<string, unknown>, SECRET));
  const ts = opts.ts ?? nowTs();
  const sig = `v1=${createHmac("sha256", opts.secret ?? SECRET).update(`${ts}.`).update(raw).digest("hex")}`;
  return handleCaktoWebhook(db, { rawBody: raw, timestamp: String(ts), signature: sig }, { secrets: [SECRET], allowBodySecret: false, workspaceSlug: SLUG });
}
const order = async (id: string) => (await db.from("orders").select("*, order_attribution(*)").eq("workspace_id", WS).eq("external_order_id", id).maybeSingle()).data;

describe.skipIf(!available)("integração (Supabase local)", () => {
  beforeAll(async () => {
    db = createClient(URL_, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    SLUG = `it-${run}`;
    WS = (await db.from("workspaces").insert({ name: "Integração", slug: SLUG }).select("id").single()).data!.id;
    await db.from("cakto_connections").insert({ workspace_id: WS });
    const offers = (await db.from("offers").insert([{ workspace_id: WS, name: "A", slug: "a" }, { workspace_id: WS, name: "B", slug: "b" }]).select("id, slug")).data!;
    OFFER_A = offers.find((o) => o.slug === "a")!.id;
    OFFER_B = offers.find((o) => o.slug === "b")!.id;
    await db.from("offer_cakto_items").insert([{ workspace_id: WS, offer_id: OFFER_A, cakto_product_id: P_A }, { workspace_id: WS, offer_id: OFFER_B, cakto_product_id: P_B }]);
    const acc = (await db.from("meta_ad_accounts").insert({ workspace_id: WS, account_id: "999000111", active: true, currency: "BRL" }).select("id").single()).data!;
    await db.from("offer_ad_accounts").insert({ workspace_id: WS, offer_id: OFFER_A, ad_account_id: acc.id });
    await db.from("meta_ads").insert({ workspace_id: WS, account_id: "999000111", campaign_id: CAMP, campaign_name: "Campanha A", adset_id: ADSET, adset_name: "Adset A", ad_id: AD, ad_name: "Ad 123" });
    const ins = { workspace_id: WS, date: today, account_id: "999000111", campaign_id: CAMP, campaign_name: "Campanha A", adset_id: ADSET, adset_name: "Adset A", ad_id: AD, ad_name: "Ad 123", spend: 10, impressions: 2000, clicks: 40, currency: "BRL" };
    await db.from("meta_insights_daily").upsert(ins, { onConflict: "workspace_id,account_id,ad_id,date" });
    await db.from("meta_insights_daily").upsert(ins, { onConflict: "workspace_id,account_id,ad_id,date" }); // importação duplicada
    const px = (await db.from("pixels").insert([1, 2, 3].map((i) => ({ workspace_id: WS, external_pixel_id: `77700000${i}`, name: `Pixel ${i}` }))).select("id")).data!;
    await db.from("offer_pixels").insert(px.map((p) => ({ workspace_id: WS, offer_id: OFFER_A, pixel_id: p.id })));
  });

  afterAll(async () => {
    if (WS) await db.from("workspaces").delete().eq("id", WS);
  });

  const base = (id: string, over: Record<string, unknown> = {}) =>
    caktoOrder({ id, refId: id.slice(0, 7), product: { id: P_A, name: "Produto A", type: "unique" }, offer: { id: "ofA", name: "A", price: 32.9, currency: "BRL" }, ...UTM, createdAt: new Date().toISOString(), ...over });

  it("Pix gerado entra como pendente (não é venda)", async () => {
    const r = await send("pix_gerado", base("XYZ", { status: "waiting_payment", paidAt: null }));
    expect(r.httpStatus).toBe(200);
    expect((await order("XYZ"))!.status).toBe("pending");
  });

  it("replay/duplicado do mesmo corpo é ignorado", async () => {
    const raw = JSON.stringify(caktoWebhook("pix_gerado", base("DUP", { status: "waiting_payment", paidAt: null }), SECRET));
    expect((await send("", null, { raw })).body).toMatchObject({ ok: true });
    expect((await send("", null, { raw })).body).toMatchObject({ duplicate: true });
    const { count } = await db.from("webhook_events").select("id", { count: "exact", head: true }).eq("workspace_id", WS).eq("external_order_id", "DUP");
    expect(count).toBe(1);
  });

  it("assinatura inválida e timestamp velho são recusados (401) sem gravar evento", async () => {
    expect((await send("purchase_approved", base("BAD"), { secret: "errado" })).httpStatus).toBe(401);
    expect((await send("purchase_approved", base("OLD"), { ts: nowTs() - 3600 })).httpStatus).toBe(401);
    expect(await order("BAD")).toBeNull();
    expect(await order("OLD")).toBeNull();
  });

  it("aprovado: mesmo pedido vira paid, atribuído ao Ad 123 e gera 1 dispatch por pixel", async () => {
    await send("purchase_approved", base("XYZ", { paidAt: new Date().toISOString() }));
    const o = await order("XYZ");
    const a = o!.order_attribution;
    expect(o!.status).toBe("paid");
    expect(a).toMatchObject({ attribution_status: "EXACT_ID", ad_id: AD, adset_id: ADSET, campaign_id: CAMP });
    const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("workspace_id", WS).eq("external_order_id", "XYZ");
    expect(count).toBe(1);
    const { data: disp } = await db.from("conversion_dispatches").select("event_id, status").eq("order_id", o!.id);
    expect(disp).toHaveLength(3);
    expect(new Set(disp!.map((d) => d.event_id))).toEqual(new Set(["cakto:XYZ:Purchase"]));
    // reenvio do aprovado não cria dispatch novo
    await send("purchase_approved", base("XYZ", { paidAt: new Date().toISOString(), fees: 2.63 }));
    const again = await db.from("conversion_dispatches").select("id").eq("order_id", o!.id);
    expect(again.data).toHaveLength(3);
  });

  it("dashboard do Ad 123: gasto 10, 1 venda, receita 32,90, CPA 10, ROAS 3,29", async () => {
    const [spend, orders] = await Promise.all([
      db.rpc("report_spend_rows", { p_workspace: WS, p_offer_ids: [OFFER_A], p_from: today, p_to: today, p_currency: "BRL" }),
      db.rpc("report_order_rows", { p_workspace: WS, p_offer_ids: [OFFER_A], p_from: today, p_to: today, p_tz: "America/Sao_Paulo", p_currency: "BRL", p_ad_id: AD }),
    ]);
    const tree = buildTree(spend.data as SpendRow[], orders.data as OrderRow[]);
    const ad = tree[0].children[0].children[0];
    expect(ad.id).toBe(AD);
    expect(ad.metrics).toMatchObject({ spend: 10, approved_count: 1, gross_revenue: 32.9, cpa: 10 });
    expect(ad.metrics.roas).toBeCloseTo(3.29, 2);
    const t = totals(spend.data as SpendRow[], orders.data as OrderRow[]);
    expect(t.pix_generated).toBe(2); // XYZ (pago) + DUP (pendente), ambos Pix do Ad 123
    expect(t.pix_paid).toBe(1);
    expect(t.pix_conversion).toBe(0.5);
  });

  it("data como array: principal + order bump na mesma entrega", async () => {
    const r = await send("purchase_approved", [base("MAIN1", { paidAt: new Date().toISOString() }), base("BUMP1", { offer_type: "orderbump", parent_order: "MAIN1", amount: 9.9, paidAt: new Date().toISOString() })]);
    expect(r.body).toMatchObject({ processed: 2 });
    expect((await order("BUMP1"))).toMatchObject({ offer_type: "orderbump", parent_order: "MAIN1", status: "paid" });
  });

  it("reembolso aplicado; paid atrasado não desfaz", async () => {
    await send("purchase_approved", base("REF1", { paidAt: new Date().toISOString() }));
    await send("refund", base("REF1", { status: "refunded", refundedAt: new Date().toISOString() }));
    expect((await order("REF1"))!.status).toBe("refunded");
    await send("purchase_approved", base("REF1", { paidAt: new Date().toISOString(), fees: 1 }));
    expect((await order("REF1"))!.status).toBe("refunded");
  });

  it("chargeback", async () => {
    await send("purchase_approved", base("CB1", { paidAt: new Date().toISOString() }));
    await send("chargeback", base("CB1", { status: "chargedback", chargedbackAt: new Date().toISOString() }));
    expect((await order("CB1"))!.status).toBe("chargedback");
  });

  it("venda sem UTM → UNTRACKED/no_utm; produto não mapeado → offer_not_mapped", async () => {
    await send("purchase_approved", base("NOUTM", { utm_source: null, utm_campaign: null, utm_medium: null, utm_content: null, utm_term: null, paidAt: new Date().toISOString() }));
    expect((await order("NOUTM"))!.order_attribution).toMatchObject({ attribution_status: "UNTRACKED", untracked_reason: "no_utm" });
    await send("purchase_approved", base("UNMAP", { product: { id: "desconhecido", name: "X" }, paidAt: new Date().toISOString() }));
    const u = await order("UNMAP");
    expect(u!.offer_id).toBeNull();
    expect(u!.order_attribution.untracked_reason).toBe("offer_not_mapped");
  });

  it("UTMs perdidas no checkout são recuperadas pela sessão do tracker (callback)", async () => {
    const sid = `s${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await db.rpc("track_session", { p: { workspace_id: WS, offer_id: OFFER_A, session_id: sid, event: "pageview", first_touch: UTM, last_touch: UTM, referrer_host: "l.facebook.com" } });
    await send("purchase_approved", base("CBK1", { utm_source: null, utm_campaign: null, utm_medium: null, utm_content: null, utm_term: null, callback: sid, paidAt: new Date().toISOString() }));
    expect((await order("CBK1"))!.order_attribution).toMatchObject({ attribution_status: "EXACT_ID", ad_id: AD, session_id: sid, attribution_method: "ad_id+tracker_session" });
  });

  it("isolamento: oferta B não enxerga receita nem gasto da A", async () => {
    await send("purchase_approved", base("B1", { product: { id: P_B, name: "B" }, amount: 50, paidAt: new Date().toISOString() }));
    const b = await db.rpc("report_order_rows", { p_workspace: WS, p_offer_ids: [OFFER_B], p_from: today, p_to: today, p_tz: "America/Sao_Paulo" });
    const bs = await db.rpc("report_spend_rows", { p_workspace: WS, p_offer_ids: [OFFER_B], p_from: today, p_to: today });
    expect(totals(bs.data as SpendRow[], b.data as OrderRow[])).toMatchObject({ gross_revenue: 50, spend: 0, approved_count: 1 });
  });

  it("RLS real: usuário de outro workspace não vê os pedidos", async () => {
    const email = `rls-${run}@example.com`;
    const password = `Pw-${randomUUID()}`;
    const { data: u } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    const other = (await db.from("workspaces").insert({ name: "Outro", slug: `other-${run}` }).select("id").single()).data!.id;
    await db.from("workspace_members").insert({ workspace_id: other, user_id: u.user!.id });
    const anon = createClient(URL_, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await anon.auth.signInWithPassword({ email, password });
    const { data } = await anon.from("orders").select("id").eq("workspace_id", WS);
    expect(data).toEqual([]);
    const { data: rep } = await anon.rpc("report_order_rows", { p_workspace: WS, p_offer_ids: null, p_from: today, p_to: today, p_tz: "America/Sao_Paulo" });
    expect(rep).toEqual([]);
    const ins = await anon.from("orders").insert({ workspace_id: other, external_order_id: "HACK", status: "paid" });
    expect(ins.error).not.toBeNull();
    const rpc = await anon.rpc("upsert_order", { p: { workspace_id: other, external_order_id: "HACK2", status: "paid" } });
    expect(rpc.error).not.toBeNull();
    await db.from("workspaces").delete().eq("id", other);
    await db.auth.admin.deleteUser(u.user!.id);
  });
});
