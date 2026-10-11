import "server-only";
import type { Db } from "../supabase/types";
import { normalizeCaktoOrder, parseEnvelope, redactPayload } from "../core/cakto/normalize";
import { verifyCaktoWebhook } from "../core/cakto/signature";
import { sha256Hex } from "../core/hash";
import { ingestOrder } from "./orders";
import { logEvent } from "./logs";

export type WebhookOutcome = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export type WebhookConfig = {
  secrets: string[];
  allowBodySecret: boolean;
  workspaceSlug: string | null;
  nowSeconds?: number;
};

/** Qual workspace recebe o webhook: ?ws=slug > env > único workspace não-demo. */
export async function resolveWebhookWorkspace(db: Db, slug: string | null): Promise<string | null> {
  if (slug) {
    const { data } = await db.from("workspaces").select("id").eq("slug", slug).maybeSingle();
    return data?.id ?? null;
  }
  const { data } = await db.from("workspaces").select("id").eq("is_demo", false).order("created_at").limit(2);
  return data && data.length === 1 ? data[0].id : null;
}

/**
 * Fluxo: corpo cru → assinatura (HMAC + timestamp) → dedupe (hash do corpo) →
 * grava evento → normaliza e processa cada pedido do `data` (objeto ou array)
 * → marca processado. Só usa o banco (sem chamadas externas) para responder
 * bem dentro dos 8 s da Cakto.
 */
export async function handleCaktoWebhook(
  db: Db,
  req: { rawBody: string; timestamp: string | null; signature: string | null },
  cfg: WebhookConfig,
): Promise<WebhookOutcome> {
  let body: unknown;
  try {
    body = JSON.parse(req.rawBody);
  } catch {
    return { httpStatus: 400, body: { error: "invalid_json" } };
  }
  const env = parseEnvelope(body);

  const sig = verifyCaktoWebhook({
    rawBody: req.rawBody,
    timestampHeader: req.timestamp,
    signatureHeader: req.signature,
    bodySecret: env.secret,
    secrets: cfg.secrets,
    allowBodySecret: cfg.allowBodySecret,
    nowSeconds: cfg.nowSeconds,
  });

  const workspaceId = await resolveWebhookWorkspace(db, cfg.workspaceSlug);

  if (!sig.ok) {
    await logEvent(db, {
      workspaceId,
      level: "warn",
      code: "WEBHOOK_REJECTED",
      provider: "cakto",
      message: sig.reason,
      context: { event: env.event, reason: sig.reason },
    });
    const status = sig.reason === "no_secret_configured" ? 503 : 401;
    return { httpStatus: status, body: { error: "unauthorized", reason: sig.reason } };
  }
  if (!workspaceId) {
    await logEvent(db, { level: "error", code: "WEBHOOK_NO_WORKSPACE", provider: "cakto", message: "Defina ?ws=<slug> na URL ou CAKTO_WEBHOOK_WORKSPACE_SLUG" });
    return { httpStatus: 500, body: { error: "workspace_not_resolved" } };
  }

  // Dedupe: a mesma entrega (inclusive retentativas da Cakto) tem o mesmo corpo.
  const dedupeKey = sha256Hex(req.rawBody);
  const firstOrderId = env.items[0] && typeof env.items[0].id === "string" ? (env.items[0].id as string) : null;
  const { data: inserted, error: insErr } = await db
    .from("webhook_events")
    .upsert(
      {
        workspace_id: workspaceId,
        provider: "cakto",
        event_name: env.event,
        external_order_id: firstOrderId,
        dedupe_key: dedupeKey,
        payload: redactPayload(body),
        signature_verified: true,
        signature_method: sig.method,
        delivery_timestamp: sig.timestamp ? new Date(sig.timestamp * 1000).toISOString() : null,
      },
      { onConflict: "provider,dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) {
    await logEvent(db, { workspaceId, level: "error", code: "WEBHOOK_STORE_FAILED", provider: "cakto", message: insErr.message });
    return { httpStatus: 500, body: { error: "store_failed" } };
  }
  const eventId = inserted?.[0]?.id as string | undefined;
  if (!eventId) {
    // Já recebido. Se falhou antes, reprocessa; senão só confirma.
    const { data: prev } = await db.from("webhook_events").select("id, processing_status").eq("provider", "cakto").eq("dedupe_key", dedupeKey).maybeSingle();
    if (prev && prev.processing_status !== "failed") return { httpStatus: 200, body: { ok: true, duplicate: true } };
    if (!prev) return { httpStatus: 200, body: { ok: true, duplicate: true } };
    return processEvent(db, workspaceId, prev.id, env, sig.timestamp);
  }
  return processEvent(db, workspaceId, eventId, env, sig.timestamp);
}

async function processEvent(
  db: Db,
  workspaceId: string,
  eventId: string,
  env: ReturnType<typeof parseEnvelope>,
  deliveryTs: number | null,
): Promise<WebhookOutcome> {
  if (env.kind !== "order") {
    await db.from("webhook_events").update({ processing_status: "ignored", processed_at: new Date().toISOString(), error_message: env.kind }).eq("id", eventId);
    return { httpStatus: 200, body: { ok: true, ignored: env.kind } };
  }
  const eventAt = deliveryTs ? new Date(deliveryTs * 1000).toISOString() : null;
  const results: Record<string, unknown>[] = [];
  const errors: string[] = [];
  for (const item of env.items) {
    const n = normalizeCaktoOrder(item, { eventName: env.event, eventAt });
    if ("error" in n) {
      errors.push(n.error);
      continue;
    }
    try {
      const r = await ingestOrder(db, workspaceId, n.order, "webhook");
      results.push({ order: n.order.external_order_id, status: r.status, applied: r.applied, attribution: r.attribution });
    } catch (e) {
      errors.push(`${n.order.external_order_id}: ${(e as Error).message}`);
    }
  }
  const failed = errors.length > 0 && results.length === 0;
  await db
    .from("webhook_events")
    .update({
      processing_status: failed ? "failed" : "processed",
      processed_at: new Date().toISOString(),
      error_message: errors.length ? errors.join("; ").slice(0, 1000) : null,
    })
    .eq("id", eventId);
  await db.from("cakto_connections").update({ last_webhook_at: new Date().toISOString(), status: "active" }).eq("workspace_id", workspaceId);
  if (errors.length) {
    await logEvent(db, { workspaceId, level: "error", code: "WEBHOOK_PROCESSING_FAILED", provider: "cakto", message: errors.join("; "), context: { event: env.event } });
  }
  // Sempre 2xx quando o evento foi gravado: a Cakto não reenvia não-2xx e a
  // reconciliação recupera o que falhou.
  return { httpStatus: 200, body: { ok: !failed, processed: results.length, errors: errors.length } };
}
