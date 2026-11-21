import "server-only";
import type { Db } from "../supabase/types";
import { sha256Hex } from "../core/hash";
import { fbclidFromFbc, normalizeWiapyOrders, parseWiapyEnvelope, redactWiapyPayload, wiapyTracking } from "../core/wiapy/normalize";
import { verifyWiapyAuth, wiapyOwnerId } from "../core/wiapy/signature";
import { matchWindow, pickSession, type SessionCandidate, type SessionMatchMethod } from "../core/wiapy/session-match";
import { ingestOrder } from "./orders";
import { logEvent } from "./logs";
import type { WebhookOutcome } from "./cakto-webhook";

export type WiapyWebhookConfig = {
  /** Token da URL (?o=<webhook_token da oferta>): define a oferta e qual segredo vale. */
  offerToken: string | null;
  /** Tokens extras aceitos (env WIAPY_WEBHOOK_TOKENS), além do guardado no Vault para a oferta. */
  secrets: string[];
};

/** Acha a sessão do tracker (t.js) desta venda: utm_term → fbc → IP+navegador → navegador único. Ver core/wiapy/session-match.ts. */
export async function matchWiapySession(
  db: Db,
  workspaceId: string,
  offerId: string,
  body: unknown,
): Promise<{ method: SessionMatchMethod; sessionId: string | null }> {
  const tr = wiapyTracking(body);
  const created = (body as { payment?: { dt_create?: string } } | null)?.payment?.dt_create ?? null;
  const win = matchWindow(created ?? null);
  const cols = "session_id, offer_id, last_seen_at";
  const sessions = () => db.from("tracking_sessions").select(cols).eq("workspace_id", workspaceId);

  if (tr.termSessionId) {
    const { data } = await sessions().eq("session_id", tr.termSessionId).maybeSingle();
    if (data) return { method: "utm_term", sessionId: data.session_id as string };
  }
  const fbclid = fbclidFromFbc(tr.fbc);
  if (fbclid) {
    const { data } = await sessions().eq("fbclid", fbclid).order("last_seen_at", { ascending: false }).limit(20);
    const hit = pickSession((data ?? []) as SessionCandidate[], { offerId, at: created });
    if (hit) return { method: "fbc", sessionId: hit };
  }
  if (tr.ip && tr.userAgent) {
    const { data } = await sessions().eq("client_ip", tr.ip).eq("user_agent", tr.userAgent).gte("last_seen_at", win.from).lte("last_seen_at", win.to).limit(20);
    const hit = pickSession((data ?? []) as SessionCandidate[], { offerId, at: created });
    if (hit) return { method: "ip_ua", sessionId: hit };
  }
  if (tr.userAgent) {
    const { data } = await sessions().eq("offer_id", offerId).eq("user_agent", tr.userAgent).gte("last_seen_at", win.from).lte("last_seen_at", win.to).limit(3);
    const hit = pickSession((data ?? []) as SessionCandidate[], { offerId, at: created, unique: true });
    if (hit) return { method: "ua_unico", sessionId: hit };
  }
  return { method: "none", sessionId: null };
}

/**
 * Webhook da Wiapy (uma integração "Webhook" por oferta, produtos da oferta marcados na Wiapy):
 *   corpo cru → oferta pelo ?o= → token do Authorization (Vault da oferta / env) → dedupe (payment.id + status)
 *   → grava evento → carrinho abandonado: registrado e encerrado → venda: casa a sessão do tracker, normaliza (principal + bumps)
 *   e processa cada pedido → marca processado.
 * Comprador fictício da Wiapy (teste+wiapy@wiapy.com): pedido com source "test" — fora das métricas e NUNCA vai à Meta.
 */
export async function handleWiapyWebhook(db: Db, req: { rawBody: string; authorization: string | null }, cfg: WiapyWebhookConfig): Promise<WebhookOutcome> {
  let body: unknown;
  try {
    body = JSON.parse(req.rawBody);
  } catch {
    return { httpStatus: 400, body: { error: "invalid_json" } };
  }
  if (!cfg.offerToken) return { httpStatus: 400, body: { error: "missing_offer_token", hint: "use /api/webhooks/wiapy?o=<token da oferta>" } };
  const { data: offer } = await db.from("offers").select("id, workspace_id").eq("webhook_token", cfg.offerToken).maybeSingle();
  if (!offer) {
    await logEvent(db, { level: "warn", code: "WEBHOOK_UNKNOWN_OFFER", provider: "wiapy", message: "Token de oferta desconhecido na URL do webhook" });
    return { httpStatus: 404, body: { error: "unknown_offer" } };
  }
  const offerId = offer.id as string;
  const workspaceId = offer.workspace_id as string;
  const { data: vaulted } = await db.rpc("read_secret", { p_owner_type: "cakto_webhook", p_owner_id: wiapyOwnerId(offerId) });
  const sig = verifyWiapyAuth({ header: req.authorization, secrets: [typeof vaulted === "string" ? vaulted : null, ...cfg.secrets] });
  const env = parseWiapyEnvelope(body);
  if (!sig.ok) {
    await logEvent(db, { workspaceId, level: "warn", code: "WEBHOOK_REJECTED", provider: "wiapy", message: sig.reason, context: { event: env.event, reason: sig.reason, offer_id: offerId } });
    return { httpStatus: sig.reason === "no_secret_configured" ? 503 : 401, body: { error: "unauthorized", reason: sig.reason } };
  }
  if (env.kind === "invalid") return { httpStatus: 200, body: { ok: true, ignored: "invalid" } };

  // Idempotência: o mesmo pagamento no mesmo status é o mesmo evento (a Wiapy reenvia em falha).
  const dedupeKey = env.kind === "order" ? sha256Hex(`wiapy|${env.paymentId}|${env.rawStatus}`) : sha256Hex(req.rawBody);
  const deliveredAt = (body as { payment?: { dt_update?: string } }).payment?.dt_update ?? null;
  const { data: inserted, error: insErr } = await db
    .from("webhook_events")
    .upsert(
      {
        workspace_id: workspaceId,
        provider: "wiapy",
        event_name: env.event,
        external_order_id: env.paymentId,
        dedupe_key: dedupeKey,
        payload: redactWiapyPayload(body),
        signature_verified: true,
        signature_method: sig.method,
        delivery_timestamp: deliveredAt && !Number.isNaN(new Date(deliveredAt).getTime()) ? new Date(deliveredAt).toISOString() : null,
      },
      { onConflict: "provider,dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) {
    await logEvent(db, { workspaceId, level: "error", code: "WEBHOOK_STORE_FAILED", provider: "wiapy", message: insErr.message });
    return { httpStatus: 500, body: { error: "store_failed" } };
  }
  let eventId = inserted?.[0]?.id as string | undefined;
  if (!eventId) {
    const { data: prev } = await db.from("webhook_events").select("id, processing_status").eq("provider", "wiapy").eq("dedupe_key", dedupeKey).maybeSingle();
    if (!prev || prev.processing_status !== "failed") return { httpStatus: 200, body: { ok: true, duplicate: true } };
    eventId = prev.id as string;
  }
  const finish = (status: "processed" | "ignored" | "failed", error: string | null) =>
    db.from("webhook_events").update({ processing_status: status, processed_at: new Date().toISOString(), error_message: error?.slice(0, 1000) ?? null }).eq("id", eventId!);

  if (env.kind === "abandonment") {
    // Registrado (payload sem PII) para a recuperação; não vira pedido.
    await finish("ignored", env.isTest ? "abandonment:test" : "abandonment");
    return { httpStatus: 200, body: { ok: true, ignored: "abandonment", test: env.isTest } };
  }

  let match: { method: SessionMatchMethod; sessionId: string | null } = { method: "none", sessionId: null };
  try {
    match = await matchWiapySession(db, workspaceId, offerId, body);
  } catch (e) {
    await logEvent(db, { workspaceId, level: "warn", code: "WIAPY_SESSION_MATCH_FAILED", provider: "wiapy", message: (e as Error).message.slice(0, 200) });
  }
  const n = normalizeWiapyOrders(body, { callback: match.sessionId });
  if ("error" in n) {
    await finish("failed", n.error);
    await logEvent(db, { workspaceId, level: "error", code: "WEBHOOK_PROCESSING_FAILED", provider: "wiapy", message: n.error, context: { event: env.event } });
    return { httpStatus: 200, body: { ok: false, processed: 0, errors: 1 } };
  }
  const tr = wiapyTracking(body);
  const matchInfo = { provider: "wiapy", method: match.method, session_id: match.sessionId, client_ip: tr.ip, client_user_agent: tr.userAgent };
  const results: { order: string; status: string; attribution: string }[] = [];
  try {
    for (const o of n.orders) {
      const r = await ingestOrder(db, workspaceId, o, env.isTest ? "test" : "webhook", { offerId, autoLink: !env.isTest, match: matchInfo });
      results.push({ order: o.external_order_id, status: r.status, attribution: r.attribution });
    }
    await finish("processed", null);
    return { httpStatus: 200, body: { ok: true, processed: results.length, errors: 0, status: results[0]?.status, test: env.isTest, match: match.method, orders: results } };
  } catch (e) {
    const msg = `${env.paymentId}: ${(e as Error).message}`;
    await finish("failed", msg);
    await logEvent(db, { workspaceId, level: "error", code: "WEBHOOK_PROCESSING_FAILED", provider: "wiapy", message: msg, context: { event: env.event } });
    return { httpStatus: 200, body: { ok: false, processed: results.length, errors: 1 } };
  }
}
