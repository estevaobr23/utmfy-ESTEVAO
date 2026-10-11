import "server-only";
import type { Db } from "../supabase/types";
import { caktoOrder } from "../core/cakto/fixtures";
import { normalizeCaktoOrder } from "../core/cakto/normalize";
import { todayIn } from "../core/dates";
import { finishJob, startJob } from "./logs";
import { ingestOrder } from "./orders";

// Modo DEMO: cria/recria um workspace SEPARADO (is_demo=true, slug "demo").
// Nunca toca em workspaces de produção. Todos os pedidos passam pelo mesmo
// pipeline real (normalização → máquina de estados → atribuição).

const DEMO_SLUG = "demo";
const ACC = "100000000000001";
const CAMP_A = "120200000000000001";
const CAMP_B = "120200000000000010";
const CAMP_S = "120200000000000100";

const catalog = [
  { campaign_id: CAMP_A, campaign_name: "Campanha A", adset_id: "120200000000000002", adset_name: "Adset A", ad_id: "120200000000000003", ad_name: "Criativo A1", spend: 90 },
  { campaign_id: CAMP_A, campaign_name: "Campanha A", adset_id: "120200000000000002", adset_name: "Adset A", ad_id: "120200000000000004", ad_name: "Criativo A2", spend: 35 },
  { campaign_id: CAMP_A, campaign_name: "Campanha A", adset_id: "120200000000000005", adset_name: "Adset A-Aberto", ad_id: "120200000000000006", ad_name: "Criativo A3", spend: 25 },
  { campaign_id: CAMP_B, campaign_name: "Campanha B", adset_id: "120200000000000011", adset_name: "Adset B", ad_id: "120200000000000012", ad_name: "Criativo B1", spend: 100 },
  { campaign_id: CAMP_S, campaign_name: "SOFÁS Topo", adset_id: "120200000000000101", adset_name: "Adset A", ad_id: "120200000000000123", ad_name: "Ad 123", spend: 10 },
];

export async function seedDemo(db: Db, userId: string) {
  // Remove SOMENTE o workspace demo anterior.
  const { data: old } = await db.from("workspaces").select("id, is_demo").eq("slug", DEMO_SLUG).maybeSingle();
  if (old && !old.is_demo) throw new Error("Já existe um workspace 'demo' que NÃO é demo — abortado por segurança.");
  if (old) await db.from("workspaces").delete().eq("id", old.id).eq("is_demo", true);

  const { data: ws, error } = await db.from("workspaces").insert({ name: "DEMO — dados fictícios", slug: DEMO_SLUG, is_demo: true }).select("id, timezone").single();
  if (error || !ws) throw new Error(`demo workspace: ${error?.message}`);
  const W = ws.id as string;
  const jobId = await startJob(db, W, "demo_seed", "manual");
  await db.from("workspace_members").insert({ workspace_id: W, user_id: userId, role: "owner" });
  await db.from("cakto_connections").insert({ workspace_id: W, name: "Cakto (demo)", status: "active" });

  const { data: offers } = await db
    .from("offers")
    .insert([
      { workspace_id: W, name: "CestaVitrine", slug: "cestavitrine", checkout_url: "https://pay.cakto.com.br/demoCesta" },
      { workspace_id: W, name: "Projetos de Sofás", slug: "projetos-de-sofas", checkout_url: "https://pay.cakto.com.br/demoSofa" },
    ])
    .select("id, slug");
  const cesta = offers!.find((o) => o.slug === "cestavitrine")!.id;
  const sofa = offers!.find((o) => o.slug === "projetos-de-sofas")!.id;
  await db.from("offer_cakto_items").insert([
    { workspace_id: W, offer_id: cesta, cakto_product_id: "demo-prod-cesta", label: "Produto CestaVitrine" },
    { workspace_id: W, offer_id: sofa, cakto_product_id: "demo-prod-sofa", label: "Produto Sofás" },
  ]);

  const { data: conn } = await db.from("meta_connections").insert({ workspace_id: W, name: "Meta (demo)", token_source: "env", status: "active", token_hint: "••••demo", last_sync_at: new Date().toISOString() }).select("id").single();
  const { data: acc } = await db.from("meta_ad_accounts").insert({ workspace_id: W, connection_id: conn!.id, account_id: ACC, account_name: "Conta Demo", currency: "BRL", timezone: "America/Sao_Paulo", active: true, last_sync_at: new Date().toISOString() }).select("id").single();
  await db.from("offer_ad_accounts").insert([
    { workspace_id: W, offer_id: cesta, ad_account_id: acc!.id, campaign_filter: "Campanha" },
    { workspace_id: W, offer_id: sofa, ad_account_id: acc!.id, campaign_filter: "SOFÁS" },
  ]);
  // Conta compartilhada: o filtro de nome separa o gasto de cada oferta.
  const today = todayIn(ws.timezone);
  await db.from("meta_ads").insert(catalog.map((c) => ({ workspace_id: W, account_id: ACC, campaign_id: c.campaign_id, campaign_name: c.campaign_name, adset_id: c.adset_id, adset_name: c.adset_name, ad_id: c.ad_id, ad_name: c.ad_name })));
  await db.from("meta_insights_daily").insert(
    catalog.map((c) => ({
      workspace_id: W, date: today, account_id: ACC, campaign_id: c.campaign_id, campaign_name: c.campaign_name, adset_id: c.adset_id,
      adset_name: c.adset_name, ad_id: c.ad_id, ad_name: c.ad_name, spend: c.spend, impressions: Math.round(c.spend * 180),
      clicks: Math.round(c.spend * 3.2), outbound_clicks: Math.round(c.spend * 2.4), currency: "BRL",
    })),
  );

  const { data: px } = await db.from("pixels").insert([
    { workspace_id: W, external_pixel_id: "900000000000001", name: "Pixel A (demo)" },
    { workspace_id: W, external_pixel_id: "900000000000002", name: "Pixel B (demo)" },
  ]).select("id");
  await db.from("offer_pixels").insert(px!.map((p) => ({ workspace_id: W, offer_id: cesta, pixel_id: p.id })));
  await db.from("offer_pixels").insert({ workspace_id: W, offer_id: sofa, pixel_id: px![0].id });

  const at = (h: number, m = 0) => `${today}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`;
  const utm = (c: (typeof catalog)[number]) => ({
    utm_source: "FB",
    utm_campaign: `${c.campaign_name}|${c.campaign_id}`,
    utm_medium: `${c.adset_name}|${c.adset_id}`,
    utm_content: `${c.ad_name}|${c.ad_id}`,
    utm_term: "Instagram_Reels",
  });
  const cestaProduct = { id: "demo-prod-cesta", short_id: "dCesta", name: "CestaVitrine", type: "unique" };
  const sofaProduct = { id: "demo-prod-sofa", short_id: "dSofa", name: "Projetos de Sofás", type: "unique" };

  const orders: { data: Record<string, unknown>; event: string }[] = [];
  // Campanha A: 8 vendas × R$40 = R$320 (gasto R$150 → ROAS 2,13)
  const aAds = [catalog[0], catalog[0], catalog[0], catalog[0], catalog[1], catalog[1], catalog[2], catalog[2]];
  aAds.forEach((c, i) => orders.push({ event: "purchase_approved", data: caktoOrder({ id: `demo-a-${i}`, refId: `DA${i}`, amount: 40, baseAmount: 40, fees: 3.2, product: cestaProduct, offer: { id: "demoCesta", name: "Cesta", price: 40, currency: "BRL" }, createdAt: at(9 + i), paidAt: at(9 + i, 3), ...utm(c) }) }));
  // Campanha B: 2 vendas × R$35 = R$70 (gasto R$100 → ROAS 0,70)
  [0, 1].forEach((i) => orders.push({ event: "purchase_approved", data: caktoOrder({ id: `demo-b-${i}`, refId: `DB${i}`, amount: 35, baseAmount: 35, fees: 2.8, paymentMethod: "credit_card", product: cestaProduct, offer: { id: "demoCesta", name: "Cesta", price: 35, currency: "BRL" }, createdAt: at(10 + i), paidAt: at(10 + i, 1), ...utm(catalog[3]) }) }));
  // Sofás: Ad 123 → 1 venda de R$32,90 (gasto R$10 → CPA R$10, ROAS 3,29)
  orders.push({ event: "pix_gerado", data: caktoOrder({ id: "demo-xyz", refId: "XYZ", status: "waiting_payment", paidAt: null, amount: 32.9, product: sofaProduct, offer: { id: "demoSofa", name: "Sofás", price: 32.9, currency: "BRL" }, createdAt: at(11), ...utm(catalog[4]) }) });
  orders.push({ event: "purchase_approved", data: caktoOrder({ id: "demo-xyz", refId: "XYZ", status: "paid", amount: 32.9, product: sofaProduct, offer: { id: "demoSofa", name: "Sofás", price: 32.9, currency: "BRL" }, createdAt: at(11), paidAt: at(11, 4), ...utm(catalog[4]) }) });
  // Pix gerado e não pago (não conta como venda)
  orders.push({ event: "pix_gerado", data: caktoOrder({ id: "demo-pix-pendente", refId: "PIXP", status: "waiting_payment", paidAt: null, amount: 40, product: cestaProduct, createdAt: at(12), ...utm(catalog[0]) }) });
  // Venda SEM UTM (não rastreada) e com macro não resolvida
  orders.push({ event: "purchase_approved", data: caktoOrder({ id: "demo-sem-utm", refId: "NOUTM", amount: 40, product: cestaProduct, createdAt: at(13), paidAt: at(13, 2), utm_source: null, utm_campaign: null, utm_medium: null, utm_content: null, utm_term: null, fbc: null }) });
  orders.push({ event: "purchase_approved", data: caktoOrder({ id: "demo-macro", refId: "MACRO", amount: 40, product: cestaProduct, createdAt: at(13, 30), paidAt: at(13, 32), utm_source: "FB", utm_campaign: "{{campaign.name}}|{{campaign.id}}", utm_medium: "{{adset.name}}|{{adset.id}}", utm_content: "{{ad.name}}|{{ad.id}}", utm_term: "{{placement}}" }) });
  // Produto não mapeado a nenhuma oferta
  orders.push({ event: "purchase_approved", data: caktoOrder({ id: "demo-nao-mapeado", refId: "UNMAP", amount: 27, product: { id: "demo-prod-desconhecido", name: "Produto sem oferta", type: "unique" }, createdAt: at(14), paidAt: at(14, 1), utm_source: "FB", utm_campaign: "Campanha Antiga|120200000000009990", utm_medium: "Adset Antigo|120200000000009991", utm_content: "Ad removido|120200000000009999", utm_term: "Facebook_Mobile_Feed" }) });
  // Reembolso e chargeback (vendas de outro dia — aparecem só no período correspondente)
  const y = new Date(`${today}T12:00:00-03:00`);
  y.setDate(y.getDate() - 1);
  const yd = y.toISOString().slice(0, 10);
  orders.push({ event: "purchase_approved", data: caktoOrder({ id: "demo-reembolso", refId: "REF", amount: 40, product: cestaProduct, createdAt: `${yd}T15:00:00-03:00`, paidAt: `${yd}T15:02:00-03:00`, ...utm(catalog[0]) }) });
  orders.push({ event: "refund", data: caktoOrder({ id: "demo-reembolso", refId: "REF", status: "refunded", amount: 40, product: cestaProduct, createdAt: `${yd}T15:00:00-03:00`, paidAt: `${yd}T15:02:00-03:00`, refundedAt: at(8), ...utm(catalog[0]) }) });
  orders.push({ event: "purchase_approved", data: caktoOrder({ id: "demo-chargeback", refId: "CHB", amount: 35, paymentMethod: "credit_card", product: cestaProduct, createdAt: `${yd}T16:00:00-03:00`, paidAt: `${yd}T16:01:00-03:00`, ...utm(catalog[3]) }) });
  orders.push({ event: "chargeback", data: caktoOrder({ id: "demo-chargeback", refId: "CHB", status: "chargedback", amount: 35, paymentMethod: "credit_card", product: cestaProduct, createdAt: `${yd}T16:00:00-03:00`, paidAt: `${yd}T16:01:00-03:00`, chargedbackAt: at(8, 30), ...utm(catalog[3]) }) });

  let n = 0;
  for (const [i, o] of orders.entries()) {
    const norm = normalizeCaktoOrder(o.data, { eventName: o.event, eventAt: new Date(Date.now() - (orders.length - i) * 1000).toISOString() });
    if ("order" in norm) {
      await ingestOrder(db, W, norm.order, "demo");
      n++;
    }
  }
  await finishJob(db, jobId, "success", { orders: n });
  return { workspaceId: W, orders: n };
}
