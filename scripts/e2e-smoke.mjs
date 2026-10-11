// Smoke E2E no app rodando (npm run build && npm start): login, cria 2 ofertas
// pela UI, mapeia produtos Cakto, associa conta Meta (catálogo/gasto simulados —
// sem token real), pixels, tracker numa landing simulada, webhooks assinados e
// visita TODAS as telas coletando erros de console. Screenshots em --out.
// Uso: node scripts/e2e-smoke.mjs [--base http://localhost:3200] [--out ./.e2e]
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { arg, loadEnv } from "./_env.mjs";

const env = loadEnv();
const BASE = arg("base", "http://localhost:3200");
const OUT = arg("out", ".e2e");
mkdirSync(OUT, { recursive: true });
const creds = Object.fromEntries(readFileSync("admin-credentials.local.txt", "utf8").trim().split("\n").map((l) => l.split("=")));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: "utmfy" },
});
const SECRET = env.CAKTO_WEBHOOK_SECRETS.split(",")[0];
const run = Date.now().toString(36);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` → ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "pt-BR" });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${page.url()} :: ${m.text()}`));
page.on("pageerror", (e) => consoleErrors.push(`${page.url()} :: ${e.message}`));

// ---- login
await page.goto(`${BASE}/`);
check("rota protegida redireciona para /login", page.url().includes("/login"));
await page.fill('input[name="email"]', creds.email);
await page.fill('input[name="password"]', creds.password);
await page.click("button:has-text('Entrar')");
await page.waitForURL(`${BASE}/`);
check("login", page.url() === `${BASE}/`);

// ---- ofertas pela UI
async function createOffer(name) {
  await page.goto(`${BASE}/ofertas`);
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="slug"]', `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${run}`);
  await page.click("button:has-text('Criar oferta')");
  await page.waitForURL(/\/ofertas\/[0-9a-f-]{36}\/integracoes/);
  return page.url().match(/ofertas\/([0-9a-f-]{36})/)[1];
}
const cesta = await createOffer("CestaVitrine");
const sofa = await createOffer("Projetos de Sofas");
check("2 ofertas criadas", !!cesta && !!sofa);

async function mapProduct(offerId, productId) {
  await page.goto(`${BASE}/ofertas/${offerId}/integracoes`);
  await page.fill('input[name="cakto_product_id"]', productId);
  await page.click("button:has-text('Associar')");
  await page.waitForURL(/ok=/);
}
const P_CESTA = `e2e-cesta-${run}`;
const P_SOFA = `e2e-sofa-${run}`;
await mapProduct(cesta, P_CESTA);
await mapProduct(sofa, P_SOFA);
check("produtos Cakto diferentes associados", (await page.content()).includes(P_SOFA));

// ---- Meta: sem token real → simula o resultado de uma sincronização
const { data: ws } = await db.from("workspaces").select("id, timezone").eq("slug", "principal").single();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: ws.timezone }).format(new Date());
const ACC = `9${Date.now()}`.slice(0, 15);
const AD = `12029${Date.now()}`.slice(0, 18);
const ADSET = `12028${Date.now()}`.slice(0, 18);
const CAMP = `12027${Date.now()}`.slice(0, 18);
await db.from("meta_ad_accounts").insert({ workspace_id: ws.id, account_id: ACC, account_name: `Conta E2E ${run}`, currency: "BRL", timezone: "America/Sao_Paulo", active: true, last_sync_at: new Date().toISOString() });
await db.from("meta_ads").insert({ workspace_id: ws.id, account_id: ACC, campaign_id: CAMP, campaign_name: "Campanha A", adset_id: ADSET, adset_name: "Adset A", ad_id: AD, ad_name: "Ad 123" });
await db.from("meta_insights_daily").upsert({ workspace_id: ws.id, date: today, account_id: ACC, campaign_id: CAMP, campaign_name: "Campanha A", adset_id: ADSET, adset_name: "Adset A", ad_id: AD, ad_name: "Ad 123", spend: 10, impressions: 2000, clicks: 50, currency: "BRL" }, { onConflict: "workspace_id,account_id,ad_id,date" });
await page.goto(`${BASE}/ofertas/${sofa}/integracoes`);
await page.selectOption('select[name="ad_account_id"]', { label: new RegExp(`Conta E2E ${run}`) }).catch(async () => {
  const opts = await page.$$eval('select[name="ad_account_id"] option', (o) => o.map((x) => ({ v: x.value, t: x.textContent })));
  await page.selectOption('select[name="ad_account_id"]', opts.find((o) => o.t.includes(run)).v);
});
await page.click("button:has-text('Associar conta')");
await page.waitForURL(/ok=/);
check("conta Meta associada à oferta", (await page.content()).includes(`act_${ACC}`));

// ---- pixels (2 na Cesta, 1 no Sofá)
for (const [i, name] of [["1", "Pixel A"], ["2", "Pixel B"]]) {
  await page.goto(`${BASE}/pixels`);
  await page.fill('input[name="external_pixel_id"]', `55${run.replace(/\D/g, "").padEnd(8, "0")}${i}`.slice(0, 20));
  await page.fill('input[name="name"]', `${name} ${run}`);
  await page.click("button:has-text('Cadastrar')");
  await page.waitForURL(/ok=|error=/);
}
const { data: pixels } = await db.from("pixels").select("id").eq("workspace_id", ws.id).like("name", `%${run}`);
await db.from("offer_pixels").insert(pixels.map((p) => ({ workspace_id: ws.id, offer_id: sofa, pixel_id: p.id })));
check("2 pixels cadastrados na mesma oferta", pixels.length === 2);

// ---- tracker numa landing simulada
// Landing simulada interceptada no mesmo host (o Chrome bloqueia origem "pública" → localhost).
const landing = `${BASE}/__landing-e2e/vendas?utm_source=FB&utm_campaign=Campanha%20A%7C${CAMP}&utm_medium=Adset%20A%7C${ADSET}&utm_content=Ad%20123%7C${AD}&utm_term=Instagram_Reels&fbclid=IwAR0e2e`;
const lp = await ctx.newPage();
await lp.route(`${BASE}/__landing-e2e/**`, (r) =>
  r.fulfill({ contentType: "text/html", body: `<html><body><a id="buy" href="https://pay.cakto.com.br/OFSOFA?x=1">Comprar</a><script src="${BASE}/t.js" data-offer="${sofa}"></script></body></html>` }),
);
await lp.goto(landing);
await lp.waitForTimeout(1500);
const href = await lp.getAttribute("#buy", "href");
const callback = new URL(href).searchParams.get("callback");
check("tracker decorou o link do checkout", href.includes(`utm_content=Ad+123%7C${AD}`) && !!callback, href);
const { data: sess } = await db.from("tracking_sessions").select("session_id, ad_id").eq("session_id", callback).maybeSingle();
check("sessão do tracker gravada via beacon", sess?.ad_id === AD, JSON.stringify(sess));
await lp.close();

// ---- webhooks assinados (como a Cakto envia)
async function webhook(event, over) {
  const data = {
    id: over.id, refId: over.id.slice(-7), status: over.status, offer_type: "main", checkoutUrl: "https://pay.cakto.com.br/OFSOFA", checkout: 1, parent_order: "", affiliate: "",
    baseAmount: over.amount ?? 32.9, amount: over.amount ?? 32.9, fees: 2.5, discount: "0.00", charged_fees: "0.00", interest: "0.00", additionalInstallmentInterest: "0.00", installments: 1,
    paymentMethod: "pix", customer: { id: 1, name: "X", email: "x@example.com", phone: "34999999999" }, address: null, shipping: null,
    product: { id: over.product ?? P_SOFA, name: "Sofás", type: "unique" }, offer: { id: "OFSOFA", name: "Sofás", price: 32.9, currency: "BRL" }, commissions: [],
    utm_source: "FB", utm_campaign: `Campanha A|${CAMP}`, utm_medium: `Adset A|${ADSET}`, utm_content: `Ad 123|${AD}`, utm_term: "Instagram_Reels",
    sck: null, callback: over.callback ?? null, fbc: null, fbp: null, createdAt: new Date(Date.now() - 60000).toISOString(),
    paidAt: over.paidAt ?? null, refundedAt: over.refundedAt ?? null, chargedbackAt: over.chargedbackAt ?? null, canceledAt: null, ...over.extra,
  };
  const raw = JSON.stringify({ secret: SECRET, event, data });
  const ts = Math.floor(Date.now() / 1000);
  const sig = `v1=${createHmac("sha256", SECRET).update(`${ts}.`).update(raw).digest("hex")}`;
  const res = await fetch(`${BASE}/api/webhooks/cakto?ws=principal`, { method: "POST", headers: { "content-type": "application/json", "x-cakto-timestamp": String(ts), "x-cakto-signature": sig }, body: raw });
  return { status: res.status, body: await res.json() };
}
const XYZ = `XYZ-${run}`;
const w1 = await webhook("pix_gerado", { id: XYZ, status: "waiting_payment", callback });
const o1 = (await db.from("orders").select("status").eq("external_order_id", XYZ).single()).data;
check("Pix pendente recebido (não é venda)", w1.status === 200 && o1.status === "pending", JSON.stringify(w1));
const w2 = await webhook("purchase_approved", { id: XYZ, status: "paid", paidAt: new Date().toISOString(), callback });
const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("external_order_id", XYZ);
check("mesmo pedido aprovado sem duplicar", w2.status === 200 && count === 1);
const bad = await fetch(`${BASE}/api/webhooks/cakto?ws=principal`, { method: "POST", headers: { "content-type": "application/json", "x-cakto-timestamp": String(Math.floor(Date.now() / 1000)), "x-cakto-signature": `v1=${"0".repeat(64)}` }, body: "{}" });
check("assinatura inválida recusada (401)", bad.status === 401);
await webhook("purchase_approved", { id: `NOUTM-${run}`, status: "paid", paidAt: new Date().toISOString(), amount: 40, extra: { utm_source: null, utm_campaign: null, utm_medium: null, utm_content: null, utm_term: null } });
await webhook("purchase_approved", { id: `REF-${run}`, status: "paid", paidAt: new Date().toISOString(), amount: 20, product: P_CESTA });
await webhook("refund", { id: `REF-${run}`, status: "refunded", paidAt: new Date().toISOString(), refundedAt: new Date().toISOString(), amount: 20, product: P_CESTA });
await webhook("purchase_approved", { id: `CB-${run}`, status: "paid", paidAt: new Date().toISOString(), amount: 25, product: P_CESTA });
await webhook("chargeback", { id: `CB-${run}`, status: "chargedback", paidAt: new Date().toISOString(), chargedbackAt: new Date().toISOString(), amount: 25, product: P_CESTA });
const st = Object.fromEntries(((await db.from("orders").select("external_order_id, status").in("external_order_id", [`REF-${run}`, `CB-${run}`])).data ?? []).map((o) => [o.external_order_id, o.status]));
check("reembolso e chargeback processados", st[`REF-${run}`] === "refunded" && st[`CB-${run}`] === "chargedback", JSON.stringify(st));
const { data: disp } = await db.from("conversion_dispatches").select("pixel_id, status").eq("event_id", `cakto:${XYZ}:Purchase`);
check("1 dispatch CAPI por pixel (2)", disp.length === 2);

// ---- dashboard da oferta Sofás: Ad 123 → gasto 10, 1 venda, 32,90, CPA 10, ROAS 3,29
await page.goto(`${BASE}/ofertas/${sofa}/resumo`);
const txt = (await page.innerText("main")).replace(/\s+/g, " ");
check("dashboard da oferta: receita R$ 72,90 (32,90 do Ad 123 + 40 sem UTM), gasto R$ 10,00, 1 não rastreada", txt.includes("R$ 72,90") && txt.includes("R$ 10,00"), txt.slice(0, 300));
await page.goto(`${BASE}/ofertas/${sofa}/meta?nivel=anuncios&adset=${ADSET}`);
const camp = (await page.innerText("main")).replace(/\s+/g, " ");
check("relatório Ad 123: gasto R$ 10,00 / receita R$ 32,90 / ROAS 3,29 / CPA R$ 10,00", camp.includes("R$ 10,00") && camp.includes("R$ 32,90") && camp.includes("3,29"), "");
await page.screenshot({ path: join(OUT, "campanhas-ad123.png"), fullPage: true });

// ---- todas as telas
const screens = [
  "/",
  "/ofertas",
  `/ofertas/${sofa}/resumo`,
  `/ofertas/${sofa}/meta`,
  `/ofertas/${sofa}/pedidos`,
  `/ofertas/${sofa}/integracoes`,
  `/ofertas/${sofa}/tracking`,
  `/ofertas/${sofa}/configuracoes`,
  `/ofertas/${sofa}/configurar`, // legado → integrações
  `/ofertas/${sofa}/saude`, // legado → tracking
  "/campanhas",
  "/pedidos",
  "/nao-rastreadas",
  "/pixels",
  "/meta",
  "/cakto",
  "/utms",
  "/diagnostico",
  "/eventos",
  "/configuracoes",
  "/saude",
];
for (const s of screens) {
  const res = await page.goto(`${BASE}${s}`);
  const ok = res.status() === 200 && !(await page.content()).includes("Application error");
  check(`tela ${s} carrega`, ok, `HTTP ${res.status()}`);
  await page.screenshot({ path: join(OUT, `${s.replace(/\//g, "_").replace(/^_$/, "_home") || "_home"}.png`), fullPage: true });
}
const nr = await (await page.goto(`${BASE}/nao-rastreadas`)) && (await page.innerText("main"));
check("Não rastreadas mostra a razão (nenhuma UTM)", nr.includes("Nenhuma UTM recebida"));

// Diagnóstico: macro não resolvida
await page.goto(`${BASE}/diagnostico`);
await page.fill("textarea", "https://p.com/?utm_source=FB&utm_campaign={{campaign.name}}&utm_content=Ad%7C120200000000000123");
await page.waitForTimeout(300);
const dg = await page.innerText("main");
check("Diagnóstico sinaliza macro não resolvida como ERRO", dg.includes("utm_campaign chegou como {{campaign.name}}") && dg.includes("ERRO"));
await page.screenshot({ path: join(OUT, "diagnostico-macro.png"), fullPage: true });

// DEMO
await page.goto(`${BASE}/configuracoes`);
await page.click("button:has-text('dados DEMO')");
await page.waitForURL(/ok=/, { timeout: 60000 });
const demo = await page.innerText("body");
check("modo DEMO visível e separado", demo.includes("MODO DEMO"));
await page.goto(`${BASE}/campanhas`);
const dc = (await page.innerText("main")).replace(/\s+/g, " ");
check("DEMO: Campanha A R$150/8 vendas/R$320/ROAS 2,13 e Campanha B R$100/2/R$70/ROAS 0,70", dc.includes("R$ 320,00") && dc.includes("2,13") && dc.includes("0,70") && dc.includes("R$ 70,00"), dc.slice(0, 400));
await page.screenshot({ path: join(OUT, "demo-campanhas.png"), fullPage: true });
await page.goto(`${BASE}/`);
await page.screenshot({ path: join(OUT, "demo-dashboard.png"), fullPage: true });
// volta para o workspace principal
await page.goto(`${BASE}/configuracoes`);
await page.selectOption('select[name="workspace_id"]', { index: 0 }).catch(() => null);

check("sem erros de console", consoleErrors.length === 0, consoleErrors.slice(0, 5).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações OK`);
process.exit(failed ? 1 : 0);
