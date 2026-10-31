import "server-only";
import type { Db } from "../supabase/types";
import { hotmartOfferCode, hotmartProductId, normalizeHotmartOrder, parseHotmartEnvelope, redactHotmartPayload } from "../core/hotmart/normalize";
import { verifyHottok } from "../core/hotmart/signature";
import { sha256Hex } from "../core/hash";
import { ingestOrder, resolveOffer } from "./orders";
import { logEvent } from "./logs";
import { resolveWebhookWorkspace, type WebhookOutcome } from "./cakto-webhook";

export type HotmartWebhookConfig = {
  /** hottok(s) válidos (env HOTMART_HOTTOK[S]). */
  secrets: string[];
  workspaceSlug: string | null;
};

/** Produtos PRINCIPAIS (contam como venda); os demais produtos da oferta são complementos (bump/guia/Kit). */
const HOTMART_MAIN_PRODUCT_IDS = (process.env.HOTMART_MAIN_PRODUCT_IDS ?? "8814892").split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Webhook GERAL da Hotmart (uma URL para a conta inteira, produtos "todos"):
 *   corpo cru → hottok → workspace → oferta pelo produto → (produto sem oferta: 200 "ignorado", nada é gravado)
 *   → dedupe (hash do corpo) → grava evento → normaliza e processa o pedido → marca processado.
 * Produto que não está ligado a nenhuma oferta da UTMFY nunca vira pedido: a conta tem outros produtos que não são nossos.
 * Responde 200 sempre que o evento foi aceito (a Hotmart repete quando recebe outro status).
 */
export async function handleHotmartWebhook(
  db: Db,
  req: { rawBody: string; headerToken: string | null },
  cfg: HotmartWebhookConfig,
): Promise<WebhookOutcome> {
  let body: unknown;
  try {
    body = JSON.parse(req.rawBody);
  } catch {
    return { httpStatus: 400, body: { error: "invalid_json" } };
  }
  const env = parseHotmartEnvelope(body);

  const workspaceId = await resolveWebhookWorkspace(db, cfg.workspaceSlug);
  // hottok: env (HOTMART_HOTTOK[S]) + o guardado no Vault (`utmfy.mjs hotmart-hottok`). Mesmo tipo de dono do segredo da Cakto,
  // mas com o id do WORKSPACE como dono (o da Cakto usa o id da oferta), o que evita uma migration só para um novo tipo.
  const secrets = [...cfg.secrets];
  if (workspaceId) {
    const { data: vaulted } = await db.rpc("read_secret", { p_owner_type: "cakto_webhook", p_owner_id: workspaceId });
    if (typeof vaulted === "string" && vaulted) secrets.push(vaulted);
  }
  const sig = verifyHottok({ headerToken: req.headerToken, bodyToken: env.hottok, secrets });
  if (!sig.ok) {
    await logEvent(db, { workspaceId, level: "warn", code: "WEBHOOK_REJECTED", provider: "hotmart", message: sig.reason, context: { event: env.event, reason: sig.reason } });
    return { httpStatus: sig.reason === "no_secret_configured" ? 503 : 401, body: { error: "unauthorized", reason: sig.reason } };
  }
  if (!workspaceId) {
    await logEvent(db, { level: "error", code: "WEBHOOK_NO_WORKSPACE", provider: "hotmart", message: "Defina ?ws=<slug> na URL ou CAKTO_WEBHOOK_WORKSPACE_SLUG" });
    return { httpStatus: 500, body: { error: "workspace_not_resolved" } };
  }
  if (env.kind === "invalid" || !env.data) return { httpStatus: 200, body: { ok: true, ignored: "invalid" } };

  // Oferta pelo produto (ou pelo código da oferta Hotmart). Sem vínculo: não é nosso, nada é gravado.
  const productId = hotmartProductId(env.data);
  const offerCode = hotmartOfferCode(env.data);
  const offerId = await resolveOffer(db, workspaceId, productId, offerCode);
  if (!offerId) return { httpStatus: 200, body: { ok: true, ignored: "product_not_mapped" } };

  const dedupeKey = sha256Hex(req.rawBody);
  const transaction = typeof (env.data.purchase as Record<string, unknown> | undefined)?.transaction === "string" ? ((env.data.purchase as Record<string, unknown>).transaction as string) : null;
  const { data: inserted, error: insErr } = await db
    .from("webhook_events")
    .upsert(
      {
        workspace_id: workspaceId,
        provider: "hotmart",
        event_name: env.event,
        external_order_id: transaction,
        dedupe_key: dedupeKey,
        payload: redactHotmartPayload(body),
        signature_verified: true,
        signature_method: sig.method,
        delivery_timestamp: env.eventAt,
      },
      { onConflict: "provider,dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) {
    await logEvent(db, { workspaceId, level: "error", code: "WEBHOOK_STORE_FAILED", provider: "hotmart", message: insErr.message });
    return { httpStatus: 500, body: { error: "store_failed" } };
  }
  let eventId = inserted?.[0]?.id as string | undefined;
  if (!eventId) {
    const { data: prev } = await db.from("webhook_events").select("id, processing_status").eq("provider", "hotmart").eq("dedupe_key", dedupeKey).maybeSingle();
    if (!prev || prev.processing_status !== "failed") return { httpStatus: 200, body: { ok: true, duplicate: true } };
    eventId = prev.id as string;
  }

  const finish = (status: "processed" | "ignored" | "failed", error: string | null) =>
    db.from("webhook_events").update({ processing_status: status, processed_at: new Date().toISOString(), error_message: error?.slice(0, 1000) ?? null }).eq("id", eventId!);

  if (env.kind !== "order") {
    await finish("ignored", env.kind === "abandonment" ? "abandonment" : `event:${env.event}`);
    return { httpStatus: 200, body: { ok: true, ignored: env.kind } };
  }
  const n = normalizeHotmartOrder(env.data, { eventName: env.event, eventAt: env.eventAt, mainProductIds: HOTMART_MAIN_PRODUCT_IDS });
  if ("error" in n) {
    await finish("failed", n.error);
    await logEvent(db, { workspaceId, level: "error", code: "WEBHOOK_PROCESSING_FAILED", provider: "hotmart", message: n.error, context: { event: env.event } });
    return { httpStatus: 200, body: { ok: false, processed: 0, errors: 1 } };
  }
  try {
    // Evento sem a comissão do repasse (ex.: reembolso) voltaria o pedido para a moeda do comprador (ARS, UYU, MXN...),
    // sem cotação, e ele sumiria do painel. Se o pedido já foi gravado em outra moeda, os valores gravados são mantidos.
    const { data: prev } = await db.from("orders").select("currency").eq("workspace_id", workspaceId).eq("provider", "hotmart").eq("external_order_id", n.order.external_order_id).maybeSingle();
    if (prev?.currency && prev.currency !== n.order.currency) {
      Object.assign(n.order, { currency: null, base_amount: null, gross_amount: null, fees: null, net_amount: null });
    }
    const r = await ingestOrder(db, workspaceId, n.order, "webhook", { offerId });
    await finish("processed", null);
    return { httpStatus: 200, body: { ok: true, processed: 1, errors: 0, order: n.order.external_order_id, status: r.status, applied: r.applied, attribution: r.attribution } };
  } catch (e) {
    const msg = `${n.order.external_order_id}: ${(e as Error).message}`;
    await finish("failed", msg);
    await logEvent(db, { workspaceId, level: "error", code: "WEBHOOK_PROCESSING_FAILED", provider: "hotmart", message: msg, context: { event: env.event } });
    return { httpStatus: 200, body: { ok: false, processed: 0, errors: 1 } };
  }
}
