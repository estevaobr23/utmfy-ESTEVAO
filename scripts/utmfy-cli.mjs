#!/usr/bin/env node
// UTMFY — helper de linha de comando para qualquer chat configurar ofertas, pixels e webhooks.
// Uso global (qualquer projeto):  node ~/.utmfy/utmfy.mjs <comando> [opções]
// Fonte da verdade: este arquivo, no repositório (scripts/utmfy-cli.mjs). Guia completo: INTEGRACAO-CHATS.md
//
// Regras: comandos que GRAVAM exigem --confirmar (sem a flag é simulação). Nunca imprime segredos.
// Credenciais: lidas de <repo>/.env.local (Supabase) e ~/.cakto/credentials.env (Cakto). Nada é copiado para outro lugar.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHmac } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = (process.env.UTMFY_URL || "https://utmfy-tracker.vercel.app").replace(/\/$/, "");
const WS_SLUG = process.env.UTMFY_WORKSPACE || "principal";
/** Eventos que o rastreio precisa receber da Cakto (mesmos que a tela de Integrações da oferta lista). */
const EVENTS = ["pix_gerado", "boleto_gerado", "purchase_approved", "purchase_refused", "refund", "chargeback", "refund_requested"];
const AD_PARAMS = "utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}";

const p = console.log;
const argv = process.argv.slice(2);
const cmd = argv.shift();
const f = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const k = argv[i].slice(2);
  f[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
}
const list = (v) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const slugify = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "oferta";

function loadEnv() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) throw new Error(`.env.local não encontrado em ${ROOT} (credenciais do banco do UTMFY)`);
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  return out;
}
const env = loadEnv();
const REST = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const HEAD = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Accept-Profile": "utmfy", "Content-Profile": "utmfy", "Content-Type": "application/json" };

async function db(method, path, body, prefer = "return=representation") {
  const r = await fetch(`${REST}/${path}`, { method, headers: { ...HEAD, Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} → ${r.status}: ${String(t).slice(0, 220)}`);
  return j;
}
const rpc = (fn, args) => db("POST", `rpc/${fn}`, args);

let _cakto;
async function cakto() {
  if (!_cakto) {
    const file = join(homedir(), ".cakto", "cakto.mjs");
    if (!existsSync(file)) throw new Error(`helper da Cakto não encontrado em ${file}`);
    _cakto = await import(pathToFileURL(file).href);
  }
  return _cakto;
}
/** A API da Cakto ignora page_size e devolve 10 por página: percorre todas. */
async function caktoAll(path) {
  const { api } = await cakto();
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const d = await api("GET", `${path}${path.includes("?") ? "&" : "?"}page=${page}`);
    out.push(...(d.results ?? []));
    if (!d.next) break;
  }
  return out;
}

const check = (ok, msg, hint) => { p(`  ${ok ? "✓" : "✗"} ${msg}${!ok && hint ? `\n      → ${hint}` : ""}`); if (!ok) process.exitCode = 1; return ok; };
const warn = (msg) => p(`  ! ${msg}`);

async function workspaceId() {
  const [w] = await db("GET", `workspaces?select=id&slug=eq.${WS_SLUG}`);
  if (!w) throw new Error(`workspace "${WS_SLUG}" não encontrado`);
  return w.id;
}
async function findOffer(ref) {
  if (!ref || ref === true) throw new Error("informe --oferta <slug|id>");
  const isUuid = /^[0-9a-f-]{36}$/i.test(ref);
  const rows = await db("GET", `offers?select=*&${isUuid ? `id=eq.${ref}` : `slug=eq.${encodeURIComponent(ref)}`}`);
  if (!rows.length) throw new Error(`oferta "${ref}" não encontrada (use: ofertas)`);
  return rows[0];
}
const webhookUrl = (offer) => `${APP}/api/webhooks/cakto?o=${offer.webhook_token}`;
const snippet = (offer, pixelId = "") => `<script src="${APP}/t.js" data-offer="${offer.id}"${pixelId ? ` data-pixel="${pixelId}"` : ""} async></script>`;
/** ID (externo) do pixel Meta vinculado à oferta, ou "". */
async function pixelOf(offer) {
  const r = await db("GET", `offer_pixels?select=pixels(external_pixel_id)&offer_id=eq.${offer.id}&active=eq.true`);
  return r[0]?.pixels?.external_pixel_id ?? "";
}
function dryRun(what, body) {
  p(what);
  if (body) p(JSON.stringify(body, null, 2));
  if (f.confirmar) return true;
  p("\nSIMULAÇÃO — nada foi gravado. Para valer, repita com --confirmar");
  return false;
}

// ---------------------------------------------------------------- comandos ---

async function status() {
  p(`UTMFY — ${APP}`);
  const root = await fetch(`${APP}/api/webhooks/cakto`).then((r) => r.status).catch(() => 0);
  check(root === 200, `app no ar (GET /api/webhooks/cakto → ${root})`, "confira o deploy na Vercel (projeto utmfy-tracker)");
  const n = async (t, q = "") => (await db("GET", `${t}?select=id${q}`, undefined, "count=exact")).length;
  p(`  banco: ${await n("offers")} oferta(s), ${await n("orders")} pedido(s), ${await n("tracking_sessions")} sessão(ões) do tracker`);
  const hooks = await caktoAll("webhook/");
  p(`  Cakto: ${hooks.length} webhook(s)`);
  for (const h of hooks) p(`    · #${h.id} ${h.status.padEnd(7)} ${h.name} — ${String(h.url).replace(/\?o=[a-f0-9]{32}/, "?o=<token>").slice(0, 70)} — ${h.products?.length ?? 0} produto(s)`);
}

async function ofertas() {
  const offers = await db("GET", "offers?select=*&order=created_at");
  const pixelRows = await db("GET", "offer_pixels?select=offer_id,active,pixels(external_pixel_id,name)");
  const items = await db("GET", "offer_cakto_items?select=offer_id,product_name,cakto_product_id");
  p(`${offers.length} oferta(s):`);
  for (const o of offers) {
    const px = pixelRows.filter((r) => r.offer_id === o.id && r.active).map((r) => `${r.pixels?.name} (${r.pixels?.external_pixel_id})`);
    const pr = items.filter((i) => i.offer_id === o.id).map((i) => i.product_name ?? i.cakto_product_id);
    const orders = (await db("GET", `orders?select=id&offer_id=eq.${o.id}&source=neq.test`)).length;
    p(`\n · ${o.name}  [${o.status}]  slug: ${o.slug}\n     id: ${o.id}\n     webhook Cakto: ${o.cakto_webhook_id ? `#${o.cakto_webhook_id}` : "— (não criado)"}   pixel: ${px.join(", ") || "— (nenhum)"}\n     produtos: ${pr.join("; ") || "—"}   pedidos: ${orders}`);
  }
}

async function ofertaCriar() {
  const name = f.nome;
  if (!name || name === true) throw new Error('use --nome "Nome da oferta"');
  const slug = slugify(f.slug && f.slug !== true ? f.slug : name);
  const body = { name: String(name).slice(0, 120), slug, currency: "BRL", timezone: "America/Sao_Paulo" };
  if (!dryRun("vai criar a OFERTA no UTMFY:", body)) return;
  const [o] = await db("POST", "offers", { workspace_id: await workspaceId(), ...body });
  p(`\noferta criada: ${o.name} (slug ${o.slug})\n  id: ${o.id}\n  URL do webhook (para a Cakto): ${webhookUrl(o)}`);
  p(`\nPróximos passos:\n  1. node ~/.utmfy/utmfy.mjs webhook-criar --oferta ${o.slug} --produto <ID_PRODUTO_CAKTO> --confirmar\n  2. node ~/.utmfy/utmfy.mjs pixel-add --id <ID_DO_PIXEL> --nome "Pixel ..." --confirmar   (1 pixel exclusivo por oferta)\n  3. node ~/.utmfy/utmfy.mjs pixel-vincular --oferta ${o.slug} --pixel <ID_DO_PIXEL> --confirmar\n  4. colocar na página de vendas:  ${snippet(o)}\n  5. node ~/.utmfy/utmfy.mjs verificar --oferta ${o.slug}`);
}

async function webhookCriar() {
  const offer = await findOffer(f.oferta);
  const products = list(f.produto || f.produtos);
  if (!products.length) throw new Error("use --produto <id_do_produto_cakto[,outro]>");
  const hooks = await caktoAll("webhook/");
  const existing = hooks.find((h) => String(h.url).includes(`o=${offer.webhook_token}`));
  if (existing) throw new Error(`esta oferta já tem webhook na Cakto (#${existing.id}). Para trocar produtos, edite esse webhook em vez de criar outro.`);
  const taken = await db("GET", `offer_cakto_items?select=offer_id,product_name&cakto_product_id=in.(${products.join(",")})&offer_id=neq.${offer.id}`);
  if (taken.length) throw new Error(`produto já pertence a outra oferta (${taken[0].product_name ?? "?"}). Um produto só pode estar em UMA oferta — senão as vendas não se separam.`);
  const body = { name: `UTMFY Tracker - ${offer.name}`.slice(0, 120), url: webhookUrl(offer), products, events: EVENTS, status: "active" };
  if (!dryRun("vai criar o WEBHOOK de rastreio na Cakto (conta de PRODUÇÃO):", { ...body, url: body.url.replace(/\?o=.*/, "?o=<token>") })) return;
  const { api } = await cakto();
  const created = await api("POST", "webhook/", body);
  // 200 não é sucesso: relê e confere.
  const back = await api("GET", `webhook/${created.id}/`);
  const gotEvents = (back.events ?? []).map((e) => e.custom_id);
  const gotProducts = (back.products ?? []).map((x) => x.id);
  p(`\nwebhook criado: #${created.id}`);
  check(back.status === "active", "status ativo");
  check(String(back.url).includes(`o=${offer.webhook_token}`), "URL com o token da oferta");
  check(products.every((x) => gotProducts.includes(x)), "produtos gravados", "a Cakto não aceitou algum produto; confira no painel");
  check(EVENTS.every((e) => gotEvents.includes(e)), "7 eventos gravados", `faltam: ${EVENTS.filter((e) => !gotEvents.includes(e)).join(", ")}`);
  const secret = created.fields?.secret ?? back.fields?.secret;
  if (secret) {
    await rpc("store_secret", { p_workspace: offer.workspace_id, p_owner_type: "cakto_webhook", p_owner_id: offer.id, p_secret: secret });
    check(true, "secret do webhook guardado no cofre (não exibido)");
  } else warn("a Cakto não devolveu o secret; o UTMFY lê na primeira entrega (ou clique 'Verificar na Cakto' na oferta)");
  await db("PATCH", `offers?id=eq.${offer.id}`, { cakto_webhook_id: String(created.id), cakto_webhook_checked_at: new Date().toISOString() });
  for (const prod of back.products ?? []) {
    const have = await db("GET", `offer_cakto_items?select=id&offer_id=eq.${offer.id}&cakto_product_id=eq.${prod.id}`);
    if (!have.length) await db("POST", "offer_cakto_items", { workspace_id: offer.workspace_id, offer_id: offer.id, cakto_product_id: prod.id, product_name: prod.name ?? null, label: prod.name ?? null, source: "cakto_webhook" });
  }
  p("  ✓ produtos vinculados à oferta no UTMFY");
  p("\nLembrete: este webhook é SÓ do rastreio. O produto também precisa estar nos webhooks de acesso (área de membros) e de recuperação — ver skill criar-produto-cakto.");
}

async function pixelAdd() {
  const id = String(f.id ?? "");
  if (!/^\d{5,30}$/.test(id)) throw new Error("use --id <id numérico do pixel Meta> --nome \"Pixel ...\"");
  const name = f.nome && f.nome !== true ? String(f.nome).slice(0, 120) : `Pixel ${id}`;
  const ws = await workspaceId();
  const have = await db("GET", `pixels?select=id,name&workspace_id=eq.${ws}&external_pixel_id=eq.${id}`);
  if (have.length) { p(`pixel ${id} já cadastrado: "${have[0].name}"`); return; }
  if (!dryRun("vai cadastrar o PIXEL no UTMFY:", { external_pixel_id: id, name })) return;
  await db("POST", "pixels", { workspace_id: ws, external_pixel_id: id, name });
  p(`pixel cadastrado: ${name} (${id})`);
}

async function pixelVincular() {
  const offer = await findOffer(f.oferta);
  const ext = String(f.pixel ?? "");
  const [px] = await db("GET", `pixels?select=id,name,external_pixel_id&workspace_id=eq.${offer.workspace_id}&external_pixel_id=eq.${ext}`);
  if (!px) throw new Error(`pixel ${ext} não cadastrado (use: pixel-add)`);
  const other = await db("GET", `offer_pixels?select=offers(name)&pixel_id=eq.${px.id}&active=eq.true&offer_id=neq.${offer.id}`);
  if (other.length) throw new Error(`pixel já vinculado a outra oferta (${other[0].offers?.name}). Um pixel por oferta — senão o gasto não se separa. Use um pixel exclusivo.`);
  if (!dryRun(`vai vincular o pixel "${px.name}" (${ext}) à oferta "${offer.name}":`)) return;
  await db("POST", "offer_pixels", { workspace_id: offer.workspace_id, offer_id: offer.id, pixel_id: px.id, active: true }, "resolution=merge-duplicates,return=representation");
  p("vinculado. Clique em Atualizar no painel: as campanhas que usam esse pixel entram na oferta sozinhas.");
}

async function mostrarSnippet() {
  const offer = await findOffer(f.oferta);
  const px = await pixelOf(offer);
  p(`Página de vendas — em TODAS as páginas do funil, dentro do <head>:

  ${snippet(offer, px)}
`);
  if (px) p(`  O pixel da Meta (${px}) é carregado pelo próprio t.js: PageView + InitiateCheckout (clique no checkout).
  NÃO instale outro código do pixel da Meta nem o pixel da UTMify na página (dobra os eventos).
  Marque com data-checkout os links que vão ao checkout (links para pay.cakto.com.br já contam).
`);
  else warn("esta oferta ainda não tem pixel vinculado: o snippet acima NÃO carrega o pixel da Meta. Rode pixel-add + pixel-vincular e peça o snippet de novo.");
  p(`Anúncios (Meta) — campo "Parâmetros de URL", no nível do anúncio:

  ${AD_PARAMS}
`);
  p(`Webhook da Cakto (já criado por webhook-criar):

  ${webhookUrl(offer).replace(/\?o=.*/, "?o=<token>")}`);
}

async function verificar() {
  const offer = await findOffer(f.oferta);
  p(`Verificação: ${offer.name} (${offer.slug}) [${offer.status}]`);
  check(offer.status === "active", `oferta ativa (${offer.status})`, "reative em Configurações da oferta se for rodar anúncio");
  const items = await db("GET", `offer_cakto_items?select=cakto_product_id,product_name&offer_id=eq.${offer.id}`);
  check(items.length > 0, `produtos vinculados: ${items.map((i) => i.product_name ?? i.cakto_product_id).join("; ") || "nenhum"}`, "rode webhook-criar com --produto");
  if (items.length) {
    const dup = await db("GET", `offer_cakto_items?select=product_name&cakto_product_id=in.(${items.map((i) => i.cakto_product_id).join(",")})&offer_id=neq.${offer.id}`);
    check(!dup.length, "nenhum produto repartido com outra oferta", `produto também em outra oferta: ${dup[0]?.product_name}`);
  }
  const hooks = await caktoAll("webhook/");
  const hook = hooks.find((h) => String(h.url).includes(`o=${offer.webhook_token}`));
  if (check(!!hook, hook ? `webhook na Cakto #${hook.id}` : "webhook na Cakto", "rode webhook-criar")) {
    check(hook.status === "active", `webhook ativo (${hook.status})`);
    const ev = (hook.events ?? []).map((e) => e.custom_id);
    check(EVENTS.every((e) => ev.includes(e)), "7 eventos marcados", `faltam: ${EVENTS.filter((e) => !ev.includes(e)).join(", ")}`);
    const hp = (hook.products ?? []).map((x) => x.id);
    check(items.every((i) => hp.includes(i.cakto_product_id)), "todos os produtos da oferta estão no webhook", "produto fora da lista vende e NUNCA dispara evento — inclua-o no webhook");
    check(String(offer.cakto_webhook_id) === String(hook.id), "oferta aponta para este webhook no UTMFY", "clique 'Verificar na Cakto' na oferta ou rode webhook-criar");
  }
  const refs = await db("GET", `secret_refs?select=owner_id&owner_type=eq.cakto_webhook&owner_id=eq.${offer.id}`);
  check(refs.length > 0, "secret do webhook guardado", "será lido na 1ª entrega; ou 'Verificar na Cakto'");
  const px = await db("GET", `offer_pixels?select=pixel_id,pixels(name,external_pixel_id)&offer_id=eq.${offer.id}&active=eq.true`);
  if (check(px.length === 1, px.length ? `pixel: ${px[0].pixels?.name} (${px[0].pixels?.external_pixel_id})` : "pixel vinculado", px.length > 1 ? "mais de um pixel: deixe só um" : "pixel-add + pixel-vincular")) {
    const shared = await db("GET", `offer_pixels?select=offer_id&pixel_id=eq.${px[0].pixel_id}&active=eq.true&offer_id=neq.${offer.id}`);
    check(!shared.length, "pixel exclusivo desta oferta", "outro pixel por oferta, senão o gasto não separa");
    const sets = await db("GET", `meta_adsets?select=adset_id,campaign_id&workspace_id=eq.${offer.workspace_id}&promoted_object->>pixel_id=eq.${px[0].pixels?.external_pixel_id}`);
    const camps = new Set(sets.map((s) => s.campaign_id));
    p(`  · campanhas que usam este pixel: ${camps.size} (conjuntos: ${sets.length})${sets.length ? "" : " — suba um anúncio com este pixel e clique Atualizar"}`);
  }
  const pixelForSnippet = px[0]?.pixels?.external_pixel_id ?? "";
  const sess = await db("GET", `tracking_sessions?select=last_seen_at&offer_id=eq.${offer.id}&order=last_seen_at.desc&limit=1`);
  const total = (await db("GET", `tracking_sessions?select=id&offer_id=eq.${offer.id}`)).length;
  check(total > 0, total ? `tracker na página: ${total} sessão(ões), última ${sess[0]?.last_seen_at?.slice(0, 16)}` : "tracker na página (t.js)", `coloque ${snippet(offer, pixelForSnippet)} na página e abra com ?utm_source=teste`);
  const orders = await db("GET", `orders?select=paid_at,status&offer_id=eq.${offer.id}&source=neq.test&order=paid_at.desc.nullslast&limit=1`);
  const nOrders = (await db("GET", `orders?select=id&offer_id=eq.${offer.id}&source=neq.test`)).length;
  p(`  · pedidos: ${nOrders}${orders[0]?.paid_at ? `, último pago ${orders[0].paid_at.slice(0, 16)}` : ""}`);
  if (!nOrders) warn("sem pedido ainda: o webhook só se prova com a 1ª venda real (ou 'simular')");
  const acc = await db("GET", `meta_ad_accounts?select=account_name,last_error&workspace_id=eq.${offer.workspace_id}&active=eq.true`);
  check(acc.every((a) => !a.last_error), `contas Meta sem erro (${acc.map((a) => a.account_name).join(", ")})`, acc.find((a) => a.last_error)?.last_error);
  p(process.exitCode ? "\nHá pendências (✗)." : "\nTudo certo.");
}

/** Simulação ponta a ponta com dados de teste identificáveis (SIM-*); apaga tudo no fim. */
async function simular() {
  if (!dryRun("vai rodar a SIMULAÇÃO ponta a ponta no banco de PRODUÇÃO (oferta 'SIMULAÇÃO – APAGAR', pedidos SIM-*), e apagar tudo no fim.")) return;
  const secret = (env.CAKTO_WEBHOOK_SECRETS || "").split(",")[0].trim();
  if (!secret) throw new Error("CAKTO_WEBHOOK_SECRETS ausente no .env.local do UTMFY");
  const ws = await workspaceId();
  const [ad] = await db("GET", "meta_ads?select=campaign_id,adset_id,ad_id&order=updated_at.desc&limit=1");
  if (!ad) throw new Error("sem anúncios no catálogo Meta para simular atribuição (rode Atualizar no painel)");
  const stamp = Date.now();
  const ids = { A: `SIM-A-${stamp}`, B: `SIM-B-${stamp}`, C: `SIM-C-${stamp}` };
  const PRODUCT = "sim-produto-0001";
  const mk = (event, order, amount, utm = true) => {
    const status = { pix_gerado: "waiting_payment", purchase_approved: "paid", refund: "refunded" }[event];
    const now = new Date(); const paid = status === "paid" || status === "refunded";
    const data = {
      id: order, refId: order.slice(-7).toUpperCase(), status, offer_type: "main", checkoutUrl: "https://pay.cakto.com.br/SIMULACAO", checkout: 1, parent_order: "", affiliate: "",
      baseAmount: amount, amount, fees: 2.49, discount: "0.00", charged_fees: "0.00", interest: "0.00", additionalInstallmentInterest: "0.00", installments: 1,
      couponCode: null, reason: null, refund_reason: null, paymentMethod: "pix", paymentMethodName: "Pix",
      customer: { id: 1, name: "Cliente Simulacao", email: "simulacao@example.com", phone: "11999999999", birthDate: null, docType: "cpf", docNumber: "00000000000" },
      address: null, shipping: null, product: { id: PRODUCT, short_id: "sim", name: "Produto SIMULAÇÃO", type: "unique", supportEmail: "", invoiceDescription: "" },
      offer: { id: "SIMOFFER", image: null, name: "Oferta Simulação", price: amount, currency: "BRL" }, commissions: [], subscription: null, subscription_period: null,
      ...(utm ? { utm_source: "FB", utm_term: "Instagram_Reels", utm_campaign: `Campanha|${ad.campaign_id}`, utm_medium: `Conjunto|${ad.adset_id}`, utm_content: `Anuncio|${ad.ad_id}` } : {}),
      sck: null, callback: null, fbc: null, fbp: null, createdAt: new Date(now - 90000).toISOString(), due_date: null,
      paidAt: paid ? now.toISOString() : null, refundedAt: status === "refunded" ? now.toISOString() : null, chargedbackAt: null, canceledAt: null,
    };
    return JSON.stringify({ secret, event, data });
  };
  const send = async (url, raw, bad = false) => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", bad ? "errado" : secret).update(`${ts}.`).update(raw).digest("hex");
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "CaktoBot/1.0 (simulacao)", "X-Cakto-Timestamp": String(ts), "X-Cakto-Signature": `v1=${sig}` }, body: raw });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  let offer;
  try {
    [offer] = await db("POST", "offers", { workspace_id: ws, name: "SIMULAÇÃO – APAGAR", slug: `simulacao-apagar-${stamp}`, currency: "BRL", timezone: "America/Sao_Paulo" });
    const url = webhookUrl(offer);
    p("\n[segurança]");
    check((await send(url, mk("pix_gerado", ids.C, 37.9), true)).status === 401, "assinatura errada recusada (401)");
    check((await send(`${APP}/api/webhooks/cakto?o=${"0".repeat(32)}`, mk("pix_gerado", ids.C, 37.9))).status === 404, "token inexistente recusado (404)");
    p("\n[fluxo de venda]");
    check((await send(url, mk("pix_gerado", ids.A, 29.9))).status === 200, "A: pix gerado");
    check((await send(url, mk("purchase_approved", ids.A, 29.9))).status === 200, "A: compra aprovada R$ 29,90 com UTM de anúncio real");
    check((await send(url, mk("purchase_approved", ids.B, 24.9, false))).status === 200, "B: compra aprovada R$ 24,90 sem UTM");
    check((await send(url, mk("pix_gerado", ids.C, 37.9))).status === 200, "C: pix gerado e não pago R$ 37,90");
    await new Promise((s) => setTimeout(s, 1200));
    check((await send(url, mk("refund", ids.B, 24.9, false))).status === 200, "B: reembolso");
    p("\n[gravado]");
    const orders = await db("GET", "orders?select=id,external_order_id,status,gross_amount,source,offer_id&external_order_id=like.SIM-*");
    const by = (k) => orders.find((o) => o.external_order_id === ids[k]);
    check(orders.length === 3, `3 pedidos gravados (${orders.length})`);
    check(by("A")?.status === "paid" && Number(by("A").gross_amount) === 29.9 && by("A").source === "webhook" && by("A").offer_id === offer.id, "A: paga, R$ 29,90, na oferta certa");
    check(by("B")?.status === "refunded" && by("C")?.status === "pending", "B reembolsado, C pendente");
    const items = await db("GET", `offer_cakto_items?select=cakto_product_id,source&offer_id=eq.${offer.id}`);
    check(items.length === 1 && items[0].source === "cakto_webhook", "produto novo entrou na oferta sozinho");
    const [aA] = await db("GET", `order_attribution?select=attribution_status,ad_id&order_id=eq.${by("A").id}`);
    const [aB] = await db("GET", `order_attribution?select=attribution_status&order_id=eq.${by("B").id}`);
    check(aA?.attribution_status === "EXACT_ID" && aA.ad_id === ad.ad_id, `A atribuída ao anúncio certo (${aA?.attribution_status})`);
    check(["UNTRACKED", "UNKNOWN"].includes(aB?.attribution_status), `B sem UTM fica separada (${aB?.attribution_status})`);
    await send(url, mk("purchase_approved", ids.A, 29.9));
    check((await db("GET", "orders?select=id&external_order_id=like.SIM-*")).length === 3, "reenvio da mesma venda não duplica");
    p("\n[relatório do painel]");
    const day = new Date().toISOString().slice(0, 10);
    const rep = await rpc("report_order_rows", { p_workspace: ws, p_offer_ids: [offer.id], p_from: day, p_to: day, p_tz: "America/Sao_Paulo", p_currency: "BRL" });
    const sum = (k) => rep.reduce((s, x) => s + Number(x[k] || 0), 0);
    check(sum("approved_count") === 2 && Math.abs(sum("gross_revenue") - 54.8) < 0.01, `2 vendas, bruto R$ ${sum("gross_revenue").toFixed(2)} (esperado 54,80)`);
    check(sum("refunded_count") === 1 && sum("pix_generated") === 3 && sum("pix_paid") === 2, `reembolso ${sum("refunded_count")}, pix ${sum("pix_generated")}/${sum("pix_paid")} (esperado 1, 3/2)`);
  } catch (e) {
    p(`\nERRO NA SIMULAÇÃO: ${e.message}`); process.exitCode = 1;
  } finally {
    p("\n[limpeza]");
    try {
      const sim = await db("GET", "orders?select=id&external_order_id=like.SIM-*");
      const idList = sim.map((o) => o.id).join(",");
      if (idList) {
        for (const t of ["order_attribution", "order_status_history", "conversion_dispatches"]) { try { await db("DELETE", `${t}?order_id=in.(${idList})`); } catch { /* tabela sem linhas */ } }
        await db("DELETE", `orders?id=in.(${idList})`);
      }
      await db("DELETE", "webhook_events?external_order_id=like.SIM-*");
      if (offer?.id) { await db("DELETE", `offer_cakto_items?offer_id=eq.${offer.id}`); await db("DELETE", `offers?id=eq.${offer.id}`); }
      const left = (await db("GET", "orders?select=id&external_order_id=like.SIM-*")).length + (await db("GET", "offers?select=id&slug=like.simulacao-apagar-*")).length;
      check(left === 0, "dados de teste removidos");
    } catch (e) { p(`LIMPEZA FALHOU: ${e.message} — apague manualmente as linhas SIM-* e a oferta "SIMULAÇÃO – APAGAR"`); process.exitCode = 1; }
  }
}

const HELP = `UTMFY — configura ofertas, pixels e webhooks (qualquer chat)

  node ~/.utmfy/utmfy.mjs status                         saúde geral (app, banco, webhooks da Cakto)
  node ~/.utmfy/utmfy.mjs ofertas                        lista ofertas, pixels, produtos, webhook, pedidos
  node ~/.utmfy/utmfy.mjs oferta-criar --nome "X" [--slug x] --confirmar
  node ~/.utmfy/utmfy.mjs webhook-criar --oferta <slug> --produto <id[,id]> --confirmar   (Cakto: PRODUÇÃO)
  node ~/.utmfy/utmfy.mjs pixel-add --id <pixelId> --nome "Pixel X" --confirmar
  node ~/.utmfy/utmfy.mjs pixel-vincular --oferta <slug> --pixel <pixelId> --confirmar
  node ~/.utmfy/utmfy.mjs snippet --oferta <slug>        script da página + parâmetros de URL dos anúncios
  node ~/.utmfy/utmfy.mjs verificar --oferta <slug>      checklist ✓/✗ de tudo que a oferta precisa
  node ~/.utmfy/utmfy.mjs simular --confirmar            venda de teste ponta a ponta (apaga tudo no fim)

Gravações exigem --confirmar; sem a flag é só simulação. Guia: INTEGRACAO-CHATS.md`;

const COMMANDS = { status, ofertas, "oferta-criar": ofertaCriar, "webhook-criar": webhookCriar, "pixel-add": pixelAdd, "pixel-vincular": pixelVincular, snippet: mostrarSnippet, verificar, simular };
try {
  if (!cmd || cmd === "ajuda" || cmd === "help" || !COMMANDS[cmd]) { p(HELP); if (cmd && !COMMANDS[cmd] && cmd !== "ajuda" && cmd !== "help") process.exitCode = 1; }
  else await COMMANDS[cmd]();
} catch (e) {
  console.error(`erro: ${e.message}`);
  process.exitCode = 1;
}
