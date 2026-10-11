import "server-only";
import type { Db } from "../supabase/types";
import { caktoApi, caktoConfigured, type CaktoWebhook } from "./cakto-client";
import { logEvent } from "./logs";

// Modelo UTMify: cada oferta tem uma URL de webhook própria (?o=<token>). Na
// Cakto o usuário cria um webhook com essa URL e marca os produtos da oferta.
// Aqui lemos esses webhooks pela API e espelhamos produtos + secret, para que
// webhook e sincronização histórica coloquem cada venda na oferta certa.

export const TOKEN_RE = /^[a-f0-9]{32}$/;

export function offerWebhookUrl(appUrl: string, token: string) {
  return `${appUrl.replace(/\/$/, "")}/api/webhooks/cakto?o=${token}`;
}

function tokenOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const t = new URL(url).searchParams.get("o");
    return t && TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

const productsOf = (h: CaktoWebhook) =>
  (h.products ?? []).map((p) => (typeof p === "string" ? { id: p, name: null } : { id: p.id, name: p.name ?? null })).filter((p) => !!p.id);

export type OfferWebhookSync = { offers: number; matched: number; products: number; conflicts: string[] };

export async function syncOfferWebhooks(db: Db, workspaceId: string): Promise<OfferWebhookSync> {
  const stats: OfferWebhookSync = { offers: 0, matched: 0, products: 0, conflicts: [] };
  if (!caktoConfigured()) return stats;
  const { data: offers } = await db.from("offers").select("id, name, webhook_token").eq("workspace_id", workspaceId);
  stats.offers = offers?.length ?? 0;
  if (!offers?.length) return stats;

  const hooks = (await caktoApi.listWebhooks()).items;
  const { data: items } = await db.from("offer_cakto_items").select("id, offer_id, cakto_product_id, cakto_offer_id, source").eq("workspace_id", workspaceId);
  const existing = items ?? [];
  const now = new Date().toISOString();

  for (const offer of offers) {
    const mine = hooks.filter((h) => tokenOf(h.url) === offer.webhook_token);
    if (!mine.length) {
      await db.from("offers").update({ cakto_webhook_id: null, cakto_webhook_checked_at: now }).eq("id", offer.id);
      continue;
    }
    stats.matched++;

    const secret = mine.map((h) => h.fields?.secret).find((s): s is string => !!s);
    if (secret) {
      const { error } = await db.rpc("store_secret", { p_workspace: workspaceId, p_owner_type: "cakto_webhook", p_owner_id: offer.id, p_secret: secret });
      if (error) await logEvent(db, { workspaceId, level: "error", code: "CAKTO_WEBHOOK_SECRET_FAILED", provider: "cakto", message: error.message, context: { offer_id: offer.id } });
    }

    const products = [...new Map(mine.flatMap(productsOf).map((p) => [p.id, p])).values()];
    for (const p of products) {
      const row = existing.find((r) => r.cakto_product_id === p.id && !r.cakto_offer_id);
      if (!row) {
        await db.from("offer_cakto_items").insert({ workspace_id: workspaceId, offer_id: offer.id, cakto_product_id: p.id, product_name: p.name, label: p.name, source: "cakto_webhook" });
        existing.push({ id: "", offer_id: offer.id, cakto_product_id: p.id, cakto_offer_id: null, source: "cakto_webhook" });
      } else if (row.offer_id === offer.id) {
        if (row.id) await db.from("offer_cakto_items").update({ product_name: p.name }).eq("id", row.id);
      } else {
        // Mesmo produto marcado em webhooks de duas ofertas: não dá para separar as vendas.
        stats.conflicts.push(`${p.name ?? p.id} → já pertence a outra oferta`);
        await logEvent(db, { workspaceId, level: "warn", code: "OFFER_PRODUCT_CONFLICT", provider: "cakto", message: "Produto Cakto em webhooks de duas ofertas", context: { product_id: p.id, offer_id: offer.id, current_offer_id: row.offer_id } });
      }
    }
    stats.products += products.length;

    // Produto desmarcado na Cakto sai da oferta (só os que vieram do webhook).
    const keep = new Set(products.map((p) => p.id));
    const stale = existing.filter((r) => r.offer_id === offer.id && r.source === "cakto_webhook" && !keep.has(r.cakto_product_id) && r.id);
    if (stale.length) await db.from("offer_cakto_items").delete().in("id", stale.map((r) => r.id));

    await db.from("offers").update({ cakto_webhook_id: mine.map((h) => String(h.id)).join(","), cakto_webhook_checked_at: now }).eq("id", offer.id);
  }
  return stats;
}

/** Oferta dona do token + secret do webhook dela (Vault). */
export async function loadOfferForWebhook(db: Db, token: string) {
  const { data: offer } = await db.from("offers").select("id, workspace_id").eq("webhook_token", token).maybeSingle();
  if (!offer) return null;
  const { data: secret } = await db.rpc("read_secret", { p_owner_type: "cakto_webhook", p_owner_id: offer.id });
  return { id: offer.id as string, workspaceId: offer.workspace_id as string, secret: (secret as string | null) ?? null };
}
