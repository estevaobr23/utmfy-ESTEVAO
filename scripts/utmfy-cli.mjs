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
let _meta;
/** Helper global da Meta (~/.meta/meta.mjs): token de usuário do sistema, nunca impresso. */
async function metaApi() {
  if (!_meta) {
    const file = join(homedir(), ".meta", "meta.mjs");
    if (!existsSync(file)) throw new Error(`helper da Meta não encontrado em ${file}`);
    _meta = await import(pathToFileURL(file).href);
  }
  return _meta;
}
/** Conta de anúncio onde os pixels novos nascem (os pixels são do business "CONTA EUA" e visíveis nas 3 contas). */
const DEFAULT_AD_ACCOUNT = "act_2094401681297034";
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

async function ofertaCriar({ quiet = false } = {}) {
  const name = f.nome;
  if (!name || name === true) throw new Error('use --nome "Nome da oferta"');
  const slug = slugify(f.slug && f.slug !== true ? f.slug : name);
  const body = { name: String(name).slice(0, 120), slug, currency: "BRL", timezone: "America/Sao_Paulo" };
  if (!dryRun("vai criar a OFERTA no UTMFY:", body)) return null;
  const [o] = await db("POST", "offers", { workspace_id: await workspaceId(), ...body });
  p(`\noferta criada: ${o.name} (slug ${o.slug})\n  id: ${o.id}\n  URL do webhook (para a Cakto): ${webhookUrl(o)}`);
  if (quiet) return o;
  p(`\nPróximos passos:\n  1. node ~/.utmfy/utmfy.mjs webhook-criar --oferta ${o.slug} --produto <ID_PRODUTO_CAKTO> --confirmar\n  2. node ~/.utmfy/utmfy.mjs pixel-add --id <ID_DO_PIXEL> --nome "Pixel ..." --confirmar   (1 pixel exclusivo por oferta)\n  3. node ~/.utmfy/utmfy.mjs pixel-vincular --oferta ${o.slug} --pixel <ID_DO_PIXEL> --confirmar\n  4. colocar na página de vendas:  ${snippet(o)}\n  5. node ~/.utmfy/utmfy.mjs verificar --oferta ${o.slug}`);
  return o;
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

/** Desliga o pixel atual da oferta (offer_pixels.active=false; reversível com pixel-vincular) para poder trocar por outro. Não mexe na Meta. */
async function pixelDesvincular() {
  const offer = await findOffer(f.oferta);
  const rows = await db("GET", `offer_pixels?select=pixel_id,pixels(name,external_pixel_id)&offer_id=eq.${offer.id}&active=eq.true`);
  if (!rows.length) throw new Error(`a oferta "${offer.name}" não tem pixel ativo`);
  const px = rows[0].pixels;
  if (!dryRun(`vai DESLIGAR o pixel "${px?.name}" (${px?.external_pixel_id}) da oferta "${offer.name}" (nada é apagado; o pixel segue na Meta):`)) return;
  await db("PATCH", `offer_pixels?offer_id=eq.${offer.id}&pixel_id=eq.${rows[0].pixel_id}`, { active: false });
  check((await pixelOf(offer)) === "", "pixel desligado da oferta (relido)");
}

/** Leitura (sem gravar): o pixel já existe na Meta? Devolve o pixel a reaproveitar, ou null se pode criar; lança erro se for duplicar. */
async function metaPixelPreflight(conta, name, reuse) {
  const { graph } = await metaApi();
  if (reuse) {
    if (!/^\d{5,30}$/.test(reuse)) throw new Error("--reusar precisa ser o ID numérico do pixel");
    const px = await graph("GET", `${reuse}?fields=id,name,owner_business,last_fired_time`);
    return { id: px.id, name: px.name, businessId: px.owner_business?.id ?? null, lastFired: px.last_fired_time ?? null };
  }
  const all = (await graph("GET", `${conta}/adspixels?fields=id,name&limit=200`)).data ?? [];
  const same = all.find((x) => String(x.name).trim().toLowerCase() === name.trim().toLowerCase());
  if (same) throw new Error(`já existe um pixel "${same.name}" (${same.id}) na Meta. Reaproveite com --reusar ${same.id} (ou escolha outro --nome): não crie duplicado.`);
  return null;
}

/** Cria o pixel NA META (ou reaproveita um existente), cadastra no UTMFY e liga à oferta (1 oferta = 1 pixel exclusivo). */
async function pixelCriar() {
  const offer = await findOffer(f.oferta);
  const already = await pixelOf(offer);
  if (already) throw new Error(`a oferta "${offer.name}" já tem o pixel ${already}. Uma oferta tem UM pixel; para trocar, desvincule o atual no painel (Pixels).`);
  const conta = f.conta && f.conta !== true ? String(f.conta) : DEFAULT_AD_ACCOUNT;
  if (!/^act_\d+$/.test(conta)) throw new Error("--conta deve ser act_<número>");
  const name = f.nome && f.nome !== true ? String(f.nome).slice(0, 120) : offer.name.slice(0, 120);
  const reuse = f.reusar && f.reusar !== true ? String(f.reusar) : "";
  const found = await metaPixelPreflight(conta, name, reuse);
  const plan = found
    ? { acao: "REAPROVEITAR pixel existente da Meta (nada é criado na Meta)", pixel: found.id, nome_na_meta: found.name, ultimo_disparo: found.lastFired }
    : { acao: "CRIAR pixel novo na Meta (produção)", conta, nome: name };
  if (!dryRun(`vai ligar um pixel à oferta "${offer.name}": ${found ? "reaproveitar" : "criar"} na Meta, cadastrar no UTMFY, vincular à oferta e gerar o script da página:`, plan)) return;

  const { graph } = await metaApi();
  let id; let metaName; let businessId;
  if (found) {
    ({ id, name: metaName, businessId } = found);
  } else {
    const created = await graph("POST", `${conta}/adspixels`, { name });
    id = created.id;
    const back = await graph("GET", `${id}?fields=id,name,owner_business`); // 200 não prova nada: relê
    metaName = back.name;
    businessId = back.owner_business?.id ?? null;
    check(back.id === id && back.name === name, `pixel criado na Meta: ${metaName} (${id})`);
    // Melhor esforço: deixa o pixel utilizável nas outras contas de anúncio do mesmo business.
    if (businessId) {
      const accounts = ((await graph("GET", "me/adaccounts?fields=id&limit=100")).data ?? []).map((a) => a.id).filter((a) => a !== conta);
      for (const a of accounts) {
        try {
          await graph("POST", `${id}/shared_accounts`, { account_id: a.replace("act_", ""), business: businessId });
          check(true, `pixel compartilhado com ${a}`);
        } catch (e) {
          warn(`não compartilhou com ${a} (${e.message.slice(0, 120)}). Compartilhe no Gerenciador de Negócios antes de usar nessa conta.`);
        }
      }
    } else warn("a Meta não informou o business dono do pixel: confira o compartilhamento com as outras contas.");
  }
  f.id = id; f.nome = metaName; f.pixel = id;
  await pixelAdd();
  await pixelVincular();
  await mostrarSnippet();
  p("\nTraqueamento Avançado (CAPI): rode capi-ativar --oferta " + offer.slug + " --cakto-sem-pixel --confirmar (ou use oferta-nova com --cakto-sem-pixel, que já liga). O pixel do Facebook dos produtos na Cakto deve ficar VAZIO.");
}

/** A cadeia inteira de uma oferta nova: oferta → webhook de rastreio (Cakto) → pixel (Meta) → script → verificação. */
async function ofertaNova() {
  const name = f.nome;
  if (!name || name === true) throw new Error('use --nome "Nome da oferta"');
  const products = list(f.produto || f.produtos);
  if (!products.length) throw new Error("use --produto <id_do_produto_cakto[,outro]>");
  const slug = slugify(f.slug && f.slug !== true ? f.slug : name);
  const conta = f.conta && f.conta !== true ? String(f.conta) : DEFAULT_AD_ACCOUNT;
  const pixelName = f.pixelnome && f.pixelnome !== true ? String(f.pixelnome).slice(0, 120) : String(name).slice(0, 120);
  const reuse = f.reusar && f.reusar !== true ? String(f.reusar) : "";

  p("Pré-checagem (só leitura):");
  check(!(await db("GET", `offers?select=id&slug=eq.${encodeURIComponent(slug)}`)).length, `slug "${slug}" livre no UTMFY`, "use --slug outro, ou continue a oferta existente com os comandos separados");
  const taken = await db("GET", `offer_cakto_items?select=product_name&cakto_product_id=in.(${products.join(",")})`);
  check(!taken.length, "produto(s) ainda sem oferta no UTMFY", `já pertence a outra oferta: ${taken[0]?.product_name}`);
  try {
    const known = new Set((await caktoAll("products/")).map((x) => x.id));
    check(products.every((x) => known.has(x)), "produto(s) existem na Cakto", "confira o ID (skill criar-produto-cakto)");
  } catch (e) {
    warn(`não consegui listar produtos da Cakto (${e.message.slice(0, 80)}); o webhook-criar vai conferir`);
  }
  const found = await metaPixelPreflight(conta, pixelName, reuse);
  check(true, found ? `pixel da Meta a reaproveitar: ${found.name} (${found.id})` : `nenhum pixel "${pixelName}" na Meta: será criado em ${conta}`);
  if (process.exitCode) throw new Error("pré-checagem falhou; nada foi gravado.");

  const plan = {
    oferta: { nome: name, slug },
    produto_cakto: products,
    webhook_rastreio: "criar na Cakto (7 eventos, só esses produtos)",
    pixel: found ? { reaproveitar: found.id } : { criar_na_meta: pixelName, conta },
    capi: f["sem-capi"] ? "pulada (--sem-capi)" : f["cakto-sem-pixel"] ? "ligar: token do Usuário do Sistema no Vault + envio server-side" : "NÃO ligar (falta --cakto-sem-pixel)",
    depois: ["script t.js da página", "verificar (checklist)"],
  };
  if (!dryRun("vai montar a OFERTA COMPLETA (UTMFY + Cakto de PRODUÇÃO + Meta de PRODUÇÃO):", plan)) return;

  const offer = await ofertaCriar({ quiet: true });
  f.oferta = offer.slug;
  f.produto = products.join(",");
  f.nome = pixelName; // a partir daqui --nome é o nome do pixel
  p("\n[1/3] webhook de rastreio na Cakto");
  await webhookCriar();
  p("\n[2/3] pixel (Meta + UTMFY) e script da página");
  await pixelCriar();
  p("\n[3/4] Traqueamento Avançado (CAPI): token no Vault + envio pelo servidor");
  if (f["sem-capi"]) p("  (pulado: --sem-capi)");
  else if (!f["cakto-sem-pixel"]) warn("CAPI NÃO ligada. Produtos novos criados pela skill criar-produto-cakto não têm pixel: passe --cakto-sem-pixel (ou rode capi-ativar depois de conferir os produtos).");
  else await capiAtivar({ embutido: true });
  p("\n[4/4] verificação final");
  await verificar();
  p("\nFalta, fora desta automação: o produto nos webhooks de ACESSO e de RECUPERAÇÃO (skill criar-produto-cakto), o script na página e os anúncios com os parâmetros de URL.");
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
  if (px.length === 1) await verificarCapi(offer, px[0]);
  const acc = await db("GET", `meta_ad_accounts?select=account_name,last_error&workspace_id=eq.${offer.workspace_id}&active=eq.true`);
  check(acc.every((a) => !a.last_error), `contas Meta sem erro (${acc.map((a) => a.account_name).join(", ")})`, acc.find((a) => a.last_error)?.last_error);
  p(process.exitCode ? "\nHá pendências (✗)." : "\nTudo certo.");
}

/** Bloco "Traqueamento Avançado" do verificar: token, envio ligado, IP/sessões, fila de envio e o lembrete da Cakto. */
async function verificarCapi(offer, link) {
  const [px] = await db("GET", `pixels?select=id,name,external_pixel_id,server_tracking_enabled,token_source,token_hint&id=eq.${link.pixel_id}`);
  p("\n  Traqueamento Avançado (CAPI):");
  p(`  · envio pelo servidor: ${px.server_tracking_enabled ? "LIGADO" : "desligado"} · token: ${px.token_source}${px.token_hint ? " " + px.token_hint : ""}`);
  check(px.token_source !== "none", "token da CAPI guardado", "rode capi-ativar --oferta " + offer.slug + " --cakto-sem-pixel --confirmar");
  if (!px.server_tracking_enabled) warn("envio server-side desligado: a Meta só recebe o que o navegador/Cakto mandar. Ligue com capi-ativar (depois de esvaziar o pixel na Cakto).");
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const sess = await db("GET", `tracking_sessions?select=client_ip,session_id&offer_id=eq.${offer.id}&last_seen_at=gte.${since}&limit=5000`);
  const withIp = sess.filter((x) => x.client_ip).length;
  p(`  · sessões (7 dias): ${sess.length}, com IP: ${withIp}`);
  if (sess.length && !withIp) warn("sessões sem IP: o /api/track não está gravando IP (confira o deploy e a migration 20261019000001)");
  const disp = await db("GET", `conversion_dispatches?select=status,last_error&pixel_id=eq.${px.id}&created_at=gte.${since}&limit=5000`);
  const by = {};
  for (const d of disp) { const k = d.status === "skipped" || d.status === "failed" ? `${d.status}:${d.last_error ?? "?"}` : d.status; by[k] = (by[k] ?? 0) + 1; }
  p(`  · envios (7 dias): ${disp.length ? Object.entries(by).map(([k, v]) => `${k}=${v}`).join(" · ") : "nenhum"}`);
  const failed = disp.filter((d) => d.status === "failed").length;
  check(!failed, "nenhum envio com falha", `${failed} falha(s): veja Eventos no painel (retry automático até 6x)`);
  const items = await db("GET", `offer_cakto_items?select=product_name&offer_id=eq.${offer.id}`);
  warn(`CONFIRME NA CAKTO (a API não mostra): Produto → Configurar Pixel → Facebook VAZIO em TODOS os produtos da oferta (${items.length}): senão o Purchase conta em dobro. Depois de 24 h de vendas: capi-medir --oferta ${offer.slug} (~100% = ok).`);
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

// ------------------------------------------------ Traqueamento Avançado (CAPI) ---
// A UTMFY envia o Purchase à Meta pelo servidor (webhook da Cakto → UTMFY → Meta). A Cakto NÃO pode enviar junto:
// o pixel do Facebook dos produtos na Cakto fica VAZIO (senão a venda conta em dobro). Detalhes: INTEGRACAO-CHATS.md seção 2.3.
const GRAPH_V = process.env.META_GRAPH_VERSION || "v26.0";

/** Token da CAPI = token do Usuário do Sistema (~/.meta): aceito para qualquer pixel do business (testado em 19/10/2026). Nunca impresso. */
function systemToken() {
  const file = join(homedir(), ".meta", "credentials.env");
  if (!existsSync(file)) throw new Error(`credencial da Meta não encontrada em ${file}`);
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("META_ACCESS_TOKEN="));
  const t = line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  if (!t) throw new Error("META_ACCESS_TOKEN ausente em ~/.meta/credentials.env");
  return t;
}

/** Prova que o token é aceito para ENVIAR eventos ao pixel, sem criar evento: a Meta recusa evento com 30 dias (erro de parâmetro);
 *  erro de permissão/token é outro. NUNCA use evento recente nem test_event_code vencido: vira venda de mentira em produção. */
async function capiProbe(pixelId, token) {
  const old = Math.floor(Date.now() / 1000) - 30 * 86400;
  const body = new URLSearchParams({
    data: JSON.stringify([{ event_name: "Purchase", event_time: old, action_source: "website", event_source_url: APP, user_data: { client_user_agent: "utmfy-probe" }, custom_data: { value: 1, currency: "BRL" } }]),
    access_token: token,
  });
  const j = await (await fetch(`https://graph.facebook.com/${GRAPH_V}/${pixelId}/events`, { method: "POST", body })).json();
  if (j.error && j.error.code === 100 && !/permission/i.test(String(j.error.message))) return { ok: true };
  if (j.events_received) return { ok: true, detail: "a Meta aceitou o evento de sonda" };
  return { ok: false, detail: j.error ? `erro ${j.error.code}: ${String(j.error.message).slice(0, 140)}` : "resposta inesperada da Meta" };
}

async function capiPixelDaOferta(offer) {
  const [row] = await db("GET", `offer_pixels?select=pixels(id,name,external_pixel_id,server_tracking_enabled,token_source,token_hint,workspace_id)&offer_id=eq.${offer.id}&active=eq.true`);
  const px = row?.pixels;
  if (!px) throw new Error(`a oferta "${offer.name}" não tem pixel vinculado (rode pixel-criar ou pixel-vincular antes)`);
  return px;
}

async function capiGuardarToken(px, token) {
  await rpc("store_secret", { p_workspace: px.workspace_id, p_owner_type: "pixel", p_owner_id: px.id, p_secret: token });
  await db("PATCH", `pixels?id=eq.${px.id}`, { token_source: "vault", token_hint: `••••${token.slice(-4)}` });
}

/** Liga o envio server-side do pixel da oferta (token no Vault + server_tracking_enabled). Exige a confirmação de que a Cakto está sem pixel. */
async function capiAtivar({ embutido = false } = {}) {
  const offer = await findOffer(f.oferta);
  const px = await capiPixelDaOferta(offer);
  const items = await db("GET", `offer_cakto_items?select=product_name,cakto_product_id&offer_id=eq.${offer.id}`);
  p(`Traqueamento Avançado — ${offer.name} · pixel ${px.name} (${px.external_pixel_id})`);
  const token = systemToken();
  const probe = await capiProbe(px.external_pixel_id, token);
  check(probe.ok, "token da Meta aceito para enviar eventos a este pixel", probe.detail);
  if (!probe.ok) { if (embutido) return false; throw new Error("token recusado pela Meta: confira o usuário do sistema (gerenciador-api) e o acesso ao pixel"); }
  const semPixel = !!f["cakto-sem-pixel"];
  check(semPixel, "confirmado: pixel do Facebook VAZIO em todos os produtos desta oferta na Cakto",
    `em CADA produto: Cakto → Produto → Configurar Pixel → Facebook: sem Pixel ID, sem token → Salvar. Produtos (${items.length}): ${items.map((i) => i.product_name ?? i.cakto_product_id).join("; ")}. Depois repita com --cakto-sem-pixel`);
  if (!semPixel) { p("\nEnvio server-side NÃO ligado: ligar com o pixel da Cakto ativo manda o Purchase em dobro."); return false; }
  const plan = {
    pixel: px.external_pixel_id,
    token: px.token_source === "vault" && !f.renovar ? "já no Vault (use --renovar para regravar)" : "gravar o token do Usuário do Sistema no Vault",
    envio_server_side: "LIGAR (pixels.server_tracking_enabled = true)",
    lembrete: "a variável CAPI_ENABLED na Vercel precisa estar true (global, já ligada em 19/10/2026)",
  };
  if (!dryRun("vai ligar o envio do Purchase pelo servidor da UTMFY:", plan)) return false;
  if (px.token_source !== "vault" || f.renovar) await capiGuardarToken(px, token);
  await db("PATCH", `pixels?id=eq.${px.id}`, { server_tracking_enabled: true });
  const [back] = await db("GET", `pixels?select=server_tracking_enabled,token_source&id=eq.${px.id}`);
  check(back?.server_tracking_enabled === true && back?.token_source === "vault", "envio server-side ligado e token no Vault (relido do banco)");
  p("\nPróximo: 1ª venda real → rode verificar e abra o Gerenciador de Eventos (Purchase deve aparecer só como Servidor). Em 24 h: capi-medir.");
  return true;
}

async function capiDesativar() {
  const offer = await findOffer(f.oferta);
  const px = await capiPixelDaOferta(offer);
  if (!dryRun(`vai DESLIGAR o envio server-side do pixel ${px.external_pixel_id} (${offer.name}). Antes de religar a Cakto, confirme que isto fechou:`)) return;
  await db("PATCH", `pixels?id=eq.${px.id}`, { server_tracking_enabled: false });
  p("desligado. Se for devolver o envio à Cakto, ligue o pixel dela só depois de ver que não há mais envio da UTMFY.");
}

/** Token do Usuário do Sistema trocado? Regrava no Vault de todos os pixels que usam Vault (e prova que a Meta aceita). */
async function capiRenovarTokens() {
  const ws = await workspaceId();
  const pxs = await db("GET", `pixels?select=id,name,external_pixel_id,workspace_id&workspace_id=eq.${ws}&token_source=eq.vault&active=eq.true`);
  const token = systemToken();
  p(`${pxs.length} pixel(s) com token no Vault`);
  const ok = [];
  for (const px of pxs) {
    const r = await capiProbe(px.external_pixel_id, token);
    check(r.ok, `${px.name} (${px.external_pixel_id}): token novo aceito`, r.detail);
    if (r.ok) ok.push(px);
  }
  if (!ok.length || !dryRun(`vai regravar o token no Vault de ${ok.length} pixel(s):`)) return;
  for (const px of ok) await capiGuardarToken(px, token);
  p("tokens regravados.");
}

/** Razão compras da Meta ÷ vendas da UTMFY (mesmo fuso da conta de anúncio): ~100% ok · bem acima = duplicidade · abaixo = perde venda. */
async function capiMedir() {
  const offer = await findOffer(f.oferta);
  const px = await capiPixelDaOferta(offer);
  const dias = Math.min(30, Math.max(1, Number(f.dias) || 7));
  const { graph } = await metaApi();
  const accs = await db("GET", `offer_ad_accounts?select=meta_ad_accounts(account_id)&offer_id=eq.${offer.id}`);
  const accounts = [...new Set(accs.map((a) => a.meta_ad_accounts?.account_id).filter(Boolean))];
  if (!accounts.length) throw new Error("a oferta não tem conta de anúncio vinculada");
  const sets = await db("GET", `meta_adsets?select=campaign_id&workspace_id=eq.${offer.workspace_id}&promoted_object->>pixel_id=eq.${px.external_pixel_id}`);
  const campaigns = new Set(sets.map((x) => String(x.campaign_id)));
  p(`Medição — ${offer.name}: últimos ${dias} dia(s) fechados, ${campaigns.size} campanha(s) com o pixel ${px.external_pixel_id}`);
  const meta = new Map(); // dia → compras
  let tz = "America/New_York";
  for (const acc of accounts) {
    const id = String(acc).startsWith("act_") ? acc : `act_${acc}`;
    const info = await graph("GET", `${id}?fields=timezone_name`);
    tz = info.timezone_name || tz;
    const ins = await graph("GET", `${id}/insights?level=campaign&time_increment=1&date_preset=last_${dias}d&fields=campaign_id,date_start,actions&limit=500`);
    for (const r of ins.data ?? []) {
      if (!campaigns.has(String(r.campaign_id))) continue;
      const a = Object.fromEntries((r.actions ?? []).map((x) => [x.action_type, Number(x.value)]));
      meta.set(r.date_start, (meta.get(r.date_start) ?? 0) + (a.omni_purchase ?? a.purchase ?? 0));
    }
  }
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const since = new Date(Date.now() - (dias + 2) * 864e5).toISOString();
  const orders = await db("GET", `orders?select=paid_at&offer_id=eq.${offer.id}&status=eq.paid&source=neq.test&paid_at=gte.${since}&limit=5000`);
  const mine = new Map();
  for (const o of orders) { const d = fmt.format(new Date(o.paid_at)); mine.set(d, (mine.get(d) ?? 0) + 1); }
  const days = [...new Set([...meta.keys()])].sort();
  let tm = 0, tu = 0;
  for (const d of days) { const m = meta.get(d) ?? 0, u = mine.get(d) ?? 0; tm += m; tu += u; p(`  ${d}  Meta ${String(m).padStart(3)}  UTMFY ${String(u).padStart(3)}  ${u ? Math.round((m / u) * 100) + "%" : "—"}`); }
  const ratio = tu ? Math.round((tm / tu) * 100) : null;
  p(`  TOTAL   Meta ${tm}  UTMFY ${tu}  ${ratio == null ? "—" : ratio + "%"}  (fuso ${tz})`);
  if (ratio != null) p(ratio > 115 ? "  ✗ Meta conta MAIS que as vendas reais: provável envio em dobro (a Cakto ainda manda pixel/CAPI?)" : ratio >= 85 ? "  ✓ faixa saudável (~100%)" : "  ! a Meta ainda enxerga menos que as vendas: confira sessões/IP/skipped em verificar");
  p("  Obs.: a Meta conta por dia de impressão e a UTMFY por dia de pagamento; o total do período vale mais que o dia.");
}

const HELP = `UTMFY — configura ofertas, pixels e webhooks (qualquer chat)

  node ~/.utmfy/utmfy.mjs status                         saúde geral (app, banco, webhooks da Cakto)
  node ~/.utmfy/utmfy.mjs ofertas                        lista ofertas, pixels, produtos, webhook, pedidos
  node ~/.utmfy/utmfy.mjs oferta-criar --nome "X" [--slug x] --confirmar
  node ~/.utmfy/utmfy.mjs webhook-criar --oferta <slug> --produto <id[,id]> --confirmar   (Cakto: PRODUÇÃO)
  node ~/.utmfy/utmfy.mjs oferta-nova --nome "X" --produto <id[,id]> [--conta act_N] [--reusar <pixelId>] [--cakto-sem-pixel] [--sem-capi] --confirmar
                                                         CADEIA COMPLETA: oferta + webhook Cakto + pixel Meta + CAPI (com --cakto-sem-pixel) + script + verificação
  node ~/.utmfy/utmfy.mjs pixel-criar --oferta <slug> [--nome "X"] [--conta act_N] [--reusar <pixelId>] --confirmar
                                                         cria (ou reaproveita) o pixel NA META, cadastra e liga à oferta
  node ~/.utmfy/utmfy.mjs pixel-add --id <pixelId> --nome "Pixel X" --confirmar
  node ~/.utmfy/utmfy.mjs pixel-vincular --oferta <slug> --pixel <pixelId> --confirmar
  node ~/.utmfy/utmfy.mjs snippet --oferta <slug>        script da página + parâmetros de URL dos anúncios
  node ~/.utmfy/utmfy.mjs verificar --oferta <slug>      checklist ✓/✗ de tudo que a oferta precisa
  node ~/.utmfy/utmfy.mjs capi-ativar --oferta <slug> --cakto-sem-pixel [--renovar] --confirmar
                                                         TRAQUEAMENTO AVANÇADO: token no Vault + envio do Purchase pelo servidor (prova o token sem criar evento)
  node ~/.utmfy/utmfy.mjs capi-desativar --oferta <slug> --confirmar     desliga o envio server-side da oferta
  node ~/.utmfy/utmfy.mjs capi-medir --oferta <slug> [--dias 7]          razão compras da Meta ÷ vendas UTMFY (~100% ok, acima = em dobro)
  node ~/.utmfy/utmfy.mjs capi-renovar-tokens --confirmar                token do Usuário do Sistema trocado: regrava no Vault de todos os pixels
  node ~/.utmfy/utmfy.mjs simular --confirmar            venda de teste ponta a ponta (apaga tudo no fim)

  node ~/.utmfy/utmfy.mjs hotmart-hottok --confirmar                     guarda o hottok do webhook da Hotmart no Vault (lê da sessão logada; nunca imprime)
  node ~/.utmfy/utmfy.mjs hotmart-vincular --oferta <slug> --produto <id[,id]> [--moeda MXN] --confirmar   liga produto(s) da Hotmart a uma oferta (e troca a moeda dela)
  node ~/.utmfy/utmfy.mjs hotmart-verificar --oferta <slug>              checklist ✓/✗ do receptor, hottok, vínculo, webhook e moeda
  node ~/.utmfy/utmfy.mjs hotmart-simular --confirmar                    teste ponta a ponta no receptor da Hotmart (oferta temporária, sem pixel; apaga tudo)

Gravações exigem --confirmar; sem a flag é só simulação. Guia: INTEGRACAO-CHATS.md`;

// ------------------------------------------------------------------ Hotmart ---
// Webhook GERAL da Hotmart (produtos "todos"): <app>/api/webhooks/hotmart. A oferta sai do vínculo produto → oferta
// (tabela offer_cakto_items com source 'manual'; o nome da coluna é histórico). O hottok mora no Vault (tipo cakto_webhook,
// dono = workspace, sem migration). Sessão da Hotmart: ~/.hotmart/sessao.mjs (Chrome 9556, o usuário faz o login).
const HOTMART_URL = `${APP}/api/webhooks/hotmart`;
let _hm;
async function hotmart() {
  if (!_hm) {
    const file = join(homedir(), ".hotmart", "sessao.mjs");
    if (!existsSync(file)) throw new Error(`sessão da Hotmart não encontrada em ${file}`);
    _hm = await import(pathToFileURL(file).href);
  }
  return _hm;
}
const HOTMART_SALE_EVENTS = ["PURCHASE_APPROVED", "PURCHASE_BILLET_PRINTED", "PURCHASE_CANCELED", "PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"];

async function hotmartHottokCmd() {
  const ws = await workspaceId();
  if (!dryRun("vai guardar o hottok do webhook da Hotmart no Vault do UTMFY (o valor nunca é impresso).", { workspace: WS_SLUG })) return;
  const tok = await (await hotmart()).hotmartHottok();
  await rpc("store_secret", { p_workspace: ws, p_owner_type: "cakto_webhook", p_owner_id: ws, p_secret: tok });
  const back = await rpc("read_secret", { p_owner_type: "cakto_webhook", p_owner_id: ws });
  check(back === tok, "hottok guardado no Vault e relido");
}

async function hotmartVincular() {
  const offer = await findOffer(f.oferta);
  const ids = list(f.produto);
  if (!ids.length) throw new Error("informe --produto <id Hotmart>[,id] (ex.: 8813153)");
  const prods = await (await hotmart()).hotmartProducts();
  const rows = [];
  for (const id of ids) {
    if (!/^\d+$/.test(id)) throw new Error(`id Hotmart inválido: ${id} (é numérico)`);
    const prod = prods.find((x) => String(x.id) === id);
    if (!prod) throw new Error(`produto ${id} não está na conta da Hotmart logada`);
    const [dup] = await db("GET", `offer_cakto_items?select=offer_id&workspace_id=eq.${offer.workspace_id}&cakto_product_id=eq.${id}&cakto_offer_id=is.null`);
    if (dup && dup.offer_id !== offer.id) throw new Error(`produto ${id} já pertence a outra oferta`);
    rows.push({ id, name: prod.name, exists: !!dup });
  }
  const moeda = f.moeda && f.moeda !== true ? String(f.moeda).toUpperCase() : null;
  if (moeda && !/^[A-Z]{3}$/.test(moeda)) throw new Error("--moeda deve ter 3 letras (ex.: MXN)");
  if (!dryRun(`vai vincular à oferta "${offer.name}" os produtos Hotmart: ${rows.map((r) => `${r.id} (${r.name})${r.exists ? " [já vinculado]" : ""}`).join("; ")}${moeda ? ` e trocar a moeda da oferta ${offer.currency} → ${moeda}` : ""}`)) return;
  for (const r of rows.filter((x) => !x.exists)) {
    await db("POST", "offer_cakto_items", { workspace_id: offer.workspace_id, offer_id: offer.id, cakto_product_id: r.id, product_name: r.name, label: r.name, source: "manual" });
  }
  if (moeda) await db("PATCH", `offers?id=eq.${offer.id}`, { currency: moeda });
  const items = await db("GET", `offer_cakto_items?select=cakto_product_id,source&offer_id=eq.${offer.id}`);
  check(rows.every((r) => items.some((i) => i.cakto_product_id === r.id)), "produtos vinculados à oferta (relido)");
  if (moeda) check((await db("GET", `offers?select=currency&id=eq.${offer.id}`))[0]?.currency === moeda, `moeda da oferta = ${moeda}`);
}

async function hotmartVerificar() {
  const offer = await findOffer(f.oferta);
  const hm = await hotmart();
  p(`Hotmart — ${offer.name} (${offer.slug})`);
  const root = await fetch(HOTMART_URL).then((r) => r.status).catch(() => 0);
  check(root === 200, `receptor no ar (GET /api/webhooks/hotmart → ${root})`, "confira o deploy na Vercel (projeto utmfy-tracker)");
  const sec = await rpc("read_secret", { p_owner_type: "cakto_webhook", p_owner_id: offer.workspace_id });
  check(!!sec, "hottok guardado no Vault", "rode: node ~/.utmfy/utmfy.mjs hotmart-hottok --confirmar");
  const items = (await db("GET", `offer_cakto_items?select=cakto_product_id,product_name&offer_id=eq.${offer.id}`)).filter((i) => /^\d+$/.test(i.cakto_product_id));
  check(items.length > 0, `produtos Hotmart vinculados: ${items.map((i) => `${i.cakto_product_id} ${i.product_name ?? ""}`.trim()).join("; ") || "nenhum"}`, "rode: node ~/.utmfy/utmfy.mjs hotmart-vincular --oferta <slug> --produto <id> --confirmar");
  const prods = await hm.hotmartProducts();
  for (const i of items) check(prods.some((x) => String(x.id) === i.cakto_product_id && x.status === "ACTIVE"), `produto ${i.cakto_product_id} ativo na Hotmart`, "produto em rascunho/análise: a venda só entra depois de aprovado");
  const groups = (await hm.hotmartWebhookGroups()).filter((g) => String(g.url).split("?")[0] === HOTMART_URL);
  if (check(groups.length > 0, "webhook da Hotmart aponta para a UTMFY", `crie na Hotmart (Ferramentas → Webhook) com a URL ${HOTMART_URL}`)) {
    const g = groups[0];
    check(g.active, "webhook ativo");
    check(HOTMART_SALE_EVENTS.every((e) => (g.event ?? []).includes(e)), "eventos de venda marcados", `faltam: ${HOTMART_SALE_EVENTS.filter((e) => !(g.event ?? []).includes(e)).join(", ")}`);
    const ids = (g.configs ?? []).map((c) => Number(c.product?.id));
    check(ids.includes(0) || items.every((i) => ids.includes(Number(i.cakto_product_id))), ids.includes(0) ? "webhook vale para todos os produtos (os não vinculados são ignorados)" : "todos os produtos da oferta estão no webhook", "produto fora da lista vende e NUNCA dispara evento");
  }
  p(`  · moeda da oferta: ${offer.currency}`);
  if (offer.currency !== "MXN") warn("as vendas da Hotmart do 120 Fallas são em MXN: troque a moeda da oferta (hotmart-vincular --moeda MXN), senão o relatório as esconde");
  const n = (await db("GET", `orders?select=id&provider=eq.hotmart&offer_id=eq.${offer.id}&source=neq.test`)).length;
  p(`  · pedidos da Hotmart nesta oferta: ${n}`);
  if (!n) warn("sem pedido da Hotmart ainda: o receptor só se prova com a 1ª venda real (ou 'hotmart-simular')");
  p(process.exitCode ? "\nHá pendências (✗)." : "\nTudo certo.");
}

/** Venda de teste ponta a ponta pelo receptor da Hotmart (oferta temporária, produto fictício, SEM pixel = nunca chega à Meta) e limpeza. */
async function hotmartSimular() {
  if (!dryRun("vai simular eventos da Hotmart no receptor de PRODUÇÃO (oferta temporária 'SIMULAÇÃO HOTMART – APAGAR', pedidos SIMHM-*) e apagar tudo no fim. A oferta não tem pixel: nada vai para a Meta.")) return;
  const hottok = await (await hotmart()).hotmartHottok();
  const ws = await workspaceId();
  const stamp = Date.now();
  const PRODUCT = `9${String(stamp).slice(-8)}`;
  const OTHER = `8${String(stamp).slice(-8)}`;
  const tx = { A: `SIMHM-A-${stamp}`, B: `SIMHM-B-${stamp}`, X: `SIMHM-X-${stamp}` };
  const sess = `simsess${String(stamp).slice(-8)}`;
  const mk = (event, transaction, value, productId = PRODUCT) => JSON.stringify({
    id: `sim-${stamp}-${event}-${transaction}`, creation_date: Date.now(), event, version: "2.0.0", hottok,
    data: {
      product: { id: Number(productId), ucode: "sim", name: "Produto SIMULAÇÃO Hotmart" },
      buyer: { email: "simulacao@example.com", name: "Cliente Simulacao", address: { country_iso: "MX" }, checkout_phone: "5512345678", checkout_phone_code: "52" },
      commissions: [{ value: Math.round(value * 0.86 * 100) / 100, source: "PRODUCER", currency_value: "MXN" }],
      purchase: {
        approved_date: Date.now(), order_date: Date.now() - 60000, price: { value, currency_value: "MXN" }, status: event.replace("PURCHASE_", ""), transaction,
        payment: { type: "CREDIT_CARD", installments_number: 1 }, offer: { code: "simoffer" }, origin: { sck: sess }, order_bump: { is_order_bump: false },
      },
    },
  });
  const send = async (raw, token = hottok) => {
    const r = await fetch(HOTMART_URL, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Hotmart-Webhook/simulacao", ...(token ? { "X-HOTMART-HOTTOK": token } : {}) }, body: raw });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  let offer;
  try {
    [offer] = await db("POST", "offers", { workspace_id: ws, name: "SIMULAÇÃO HOTMART – APAGAR", slug: `simulacao-hotmart-apagar-${stamp}`, currency: "MXN", timezone: "America/Mexico_City" });
    await db("POST", "offer_cakto_items", { workspace_id: ws, offer_id: offer.id, cakto_product_id: PRODUCT, product_name: "Produto SIMULAÇÃO Hotmart", label: "SIM", source: "manual" });
    p("\n[segurança]");
    // o receptor aceita o hottok do cabeçalho OU do corpo (a Hotmart manda os dois): o "errado" tem que valer nos dois lugares
    check((await send(mk("PURCHASE_APPROVED", tx.X, 197).replace(/"hottok":"[^"]*",/, '"hottok":"errado",'), "errado")).status === 401, "hottok errado (cabeçalho e corpo) recusado (401)");
    check((await send(mk("PURCHASE_APPROVED", tx.X, 197).replace(/"hottok":"[^"]*",/, ""), "")).status === 401, "sem hottok recusado (401)");
    p("\n[produto que não é nosso]");
    const o = await send(mk("PURCHASE_APPROVED", tx.X, 197, OTHER));
    check(o.status === 200 && o.body.ignored === "product_not_mapped", "produto não vinculado: 200 'ignorado' (a Hotmart para de repetir)");
    check((await db("GET", `webhook_events?select=id&external_order_id=eq.${tx.X}`)).length === 0, "produto não vinculado não grava evento nenhum");
    p("\n[fluxo de venda]");
    check((await send(mk("PURCHASE_BILLET_PRINTED", tx.A, 197))).status === 200, "A: pagamento pendente (boleto/OXXO/PIX gerado)");
    check((await send(mk("PURCHASE_APPROVED", tx.A, 197))).status === 200, "A: compra aprovada MX$ 197");
    check((await send(mk("PURCHASE_APPROVED", tx.B, 147))).status === 200, "B: compra aprovada MX$ 147");
    await new Promise((s) => setTimeout(s, 1200));
    check((await send(mk("PURCHASE_REFUNDED", tx.B, 147))).status === 200, "B: reembolso");
    p("\n[gravado]");
    const orders = await db("GET", "orders?select=id,external_order_id,status,gross_amount,net_amount,currency,provider,offer_id,source,callback&external_order_id=like.SIMHM-*");
    const by = (k) => orders.find((x) => x.external_order_id === tx[k]);
    check(orders.length === 2, `2 pedidos gravados (${orders.length})`);
    check(by("A")?.status === "paid" && Number(by("A").gross_amount) === 197 && by("A").currency === "MXN" && by("A").provider === "hotmart" && by("A").offer_id === offer.id && by("A").source === "webhook", "A: paga, MX$ 197, provedor hotmart, na oferta certa");
    check(Math.abs(Number(by("A")?.net_amount) - 197 * 0.86) < 0.011, `A: líquido = comissão do produtor (${by("A")?.net_amount})`);
    check(by("B")?.status === "refunded", "B: reembolsado");
    const [at] = await db("GET", `order_attribution?select=sck&order_id=eq.${by("A").id}`);
    check(at?.sck === sess, "A: sck (sessão do tracker) guardado na atribuição");
    await send(mk("PURCHASE_APPROVED", tx.A, 197));
    check((await db("GET", "orders?select=id&external_order_id=like.SIMHM-*")).length === 2, "reenvio da mesma venda não duplica");
    check((await db("GET", `conversion_dispatches?select=id&order_id=eq.${by("A").id}`)).length === 0, "oferta sem pixel: nada entra na fila da Meta");
    check(!JSON.stringify(await db("GET", `webhook_events?select=payload&external_order_id=eq.${tx.A}`)).includes("example.com"), "payload de auditoria sem e-mail em claro");
  } catch (e) {
    p(`\nERRO NA SIMULAÇÃO: ${e.message}`); process.exitCode = 1;
  } finally {
    p("\n[limpeza]");
    try {
      const sim = await db("GET", "orders?select=id&external_order_id=like.SIMHM-*");
      const idList = sim.map((x) => x.id).join(",");
      if (idList) {
        for (const t of ["order_attribution", "order_status_history", "conversion_dispatches"]) { try { await db("DELETE", `${t}?order_id=in.(${idList})`); } catch { /* sem linhas */ } }
        await db("DELETE", `orders?id=in.(${idList})`);
      }
      await db("DELETE", "webhook_events?external_order_id=like.SIMHM-*");
      if (offer?.id) { await db("DELETE", `offer_cakto_items?offer_id=eq.${offer.id}`); await db("DELETE", `offers?id=eq.${offer.id}`); }
      const left = (await db("GET", "orders?select=id&external_order_id=like.SIMHM-*")).length + (await db("GET", "offers?select=id&slug=like.simulacao-hotmart-apagar-*")).length + (await db("GET", "webhook_events?select=id&external_order_id=like.SIMHM-*")).length;
      check(left === 0, "dados de teste removidos");
    } catch (e) { p(`LIMPEZA FALHOU: ${e.message} — apague as linhas SIMHM-* e a oferta "SIMULAÇÃO HOTMART – APAGAR"`); process.exitCode = 1; }
  }
}

const COMMANDS = { "hotmart-hottok": hotmartHottokCmd, "hotmart-vincular": hotmartVincular, "hotmart-verificar": hotmartVerificar, "hotmart-simular": hotmartSimular, status, ofertas, "oferta-criar": ofertaCriar, "webhook-criar": webhookCriar, "oferta-nova": ofertaNova, "pixel-criar": pixelCriar, "pixel-add": pixelAdd, "pixel-vincular": pixelVincular, "pixel-desvincular": pixelDesvincular, snippet: mostrarSnippet, verificar, simular, "capi-ativar": capiAtivar, "capi-desativar": capiDesativar, "capi-medir": capiMedir, "capi-renovar-tokens": capiRenovarTokens };
try {
  if (!cmd || cmd === "ajuda" || cmd === "help" || !COMMANDS[cmd]) { p(HELP); if (cmd && !COMMANDS[cmd] && cmd !== "ajuda" && cmd !== "help") process.exitCode = 1; }
  else await COMMANDS[cmd]();
} catch (e) {
  console.error(`erro: ${e.message}`);
  process.exitCode = 1;
}
