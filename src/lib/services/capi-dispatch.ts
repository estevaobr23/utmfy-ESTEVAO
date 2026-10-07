import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildPurchaseEvent } from "../core/capi";
import { env } from "../env";
import { finishJob, logEvent, startJob } from "./logs";

// Envio server-side (Conversions API). Desligado por padrão: com CAPI_ENABLED
// != true os dispatches ficam "pending" (visíveis em Eventos) e nada é enviado.
// Cada (pedido, pixel) tem seu dispatch: falha no pixel C não reenvia A e B.

const MAX_ATTEMPTS = 6;

async function pixelToken(db: SupabaseClient, pixel: { id: string; token_source: string }) {
  if (pixel.token_source === "env") return env.metaCapiToken || null;
  if (pixel.token_source === "vault") {
    const { data } = await db.rpc("read_secret", { p_owner_type: "pixel", p_owner_id: pixel.id });
    return (data as string | null) ?? null;
  }
  return null;
}

export async function processDispatches(db: SupabaseClient, opts: { limit?: number; trigger: "manual" | "cron"; workspaceId?: string | null }) {
  if (!env.capiEnabled) return { disabled: true as const };
  const jobId = await startJob(db, opts.workspaceId ?? null, "capi_dispatch", opts.trigger);
  let q = db
    .from("conversion_dispatches")
    .select("id, workspace_id, order_id, pixel_id, event_name, event_id, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at")
    .limit(opts.limit ?? 50);
  if (opts.workspaceId) q = q.eq("workspace_id", opts.workspaceId);
  const { data: items } = await q;
  const stats = { sent: 0, failed: 0, skipped: 0 };

  for (const d of items ?? []) {
    // trava otimista: só um worker pega o item
    const { data: locked } = await db.from("conversion_dispatches").update({ status: "sending" }).eq("id", d.id).eq("status", "pending").select("id");
    if (!locked?.length) continue;

    const { data: pixel } = await db.from("pixels").select("id, external_pixel_id, active, server_tracking_enabled, token_source, test_event_code").eq("id", d.pixel_id).single();
    const { data: order } = await db
      .from("orders")
      .select("provider, external_order_id, gross_amount, currency, paid_at, customer_email_sha256, customer_phone_sha256, product_external_id, status, order_attribution(fbc, fbp, session_id)")
      .eq("id", d.order_id)
      .single();

    const finish = async (status: "sent" | "failed" | "skipped" | "pending", patch: Record<string, unknown>) => {
      await db.from("conversion_dispatches").update({ status, ...patch }).eq("id", d.id);
    };

    if (!pixel?.active || !pixel.server_tracking_enabled) {
      await finish("skipped", { last_error: "pixel_disabled" });
      stats.skipped++;
      continue;
    }
    if (!order || order.status !== "paid") {
      await finish("skipped", { last_error: `order_status_${order?.status ?? "missing"}` });
      stats.skipped++;
      continue;
    }
    const attr = (Array.isArray(order.order_attribution) ? order.order_attribution[0] : order.order_attribution) as { fbc: string | null; fbp: string | null; session_id: string | null } | null;
    let ua: string | null = null;
    let sourceUrl: string | null = null;
    if (attr?.session_id) {
      const { data: s } = await db.from("tracking_sessions").select("user_agent, landing_url").eq("workspace_id", d.workspace_id).eq("session_id", attr.session_id).maybeSingle();
      ua = s?.user_agent ?? null;
      sourceUrl = s?.landing_url ?? null;
    }
    const built = buildPurchaseEvent({
      provider: order.provider,
      external_order_id: order.external_order_id,
      gross_amount: order.gross_amount != null ? Number(order.gross_amount) : null,
      currency: order.currency,
      paid_at: order.paid_at,
      customer_email_sha256: order.customer_email_sha256,
      customer_phone_sha256: order.customer_phone_sha256,
      fbc: attr?.fbc ?? null,
      fbp: attr?.fbp ?? null,
      client_user_agent: ua,
      event_source_url: sourceUrl,
      product_external_id: order.product_external_id,
    });
    if ("skip" in built) {
      await finish("skipped", { last_error: built.skip });
      stats.skipped++;
      continue;
    }
    if ("error" in built) {
      await finish("failed", { last_error: built.error, attempts: d.attempts + 1 });
      stats.failed++;
      continue;
    }
    const token = await pixelToken(db, pixel);
    if (!token) {
      await finish("failed", { last_error: "pixel_token_missing", attempts: d.attempts + 1 });
      stats.failed++;
      continue;
    }

    try {
      const body = new URLSearchParams({ data: JSON.stringify([built.event]), access_token: token });
      if (pixel.test_event_code) body.set("test_event_code", pixel.test_event_code);
      const res = await fetch(`https://graph.facebook.com/${env.metaGraphVersion}/${pixel.external_pixel_id}/events`, { method: "POST", body, cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (res.ok) {
        await finish("sent", { last_http_status: res.status, last_error: null, attempts: d.attempts + 1, sent_at: new Date().toISOString() });
        stats.sent++;
      } else {
        const attempts = d.attempts + 1;
        const retryable = res.status >= 500 || res.status === 429;
        await finish(retryable && attempts < MAX_ATTEMPTS ? "pending" : "failed", {
          last_http_status: res.status,
          last_error: (json.error?.message ?? `HTTP ${res.status}`).slice(0, 300),
          attempts,
          next_attempt_at: new Date(Date.now() + 2 ** attempts * 60000).toISOString(),
        });
        stats.failed++;
      }
    } catch (e) {
      const attempts = d.attempts + 1;
      await finish(attempts < MAX_ATTEMPTS ? "pending" : "failed", { last_error: (e as Error).message.slice(0, 300), attempts, next_attempt_at: new Date(Date.now() + 2 ** attempts * 60000).toISOString() });
      stats.failed++;
    }
  }
  if (stats.failed) await logEvent(db, { workspaceId: opts.workspaceId, level: "warn", code: "CAPI_DISPATCH_FAILED", provider: "meta", message: `${stats.failed} falha(s)`, context: stats });
  await finishJob(db, jobId, stats.failed ? "partial" : "success", stats);
  return stats;
}

/** Reprocessar: volta para a fila SOMENTE o dispatch escolhido (ex.: Pixel C). */
export async function retryDispatch(db: SupabaseClient, dispatchId: string) {
  return db.from("conversion_dispatches").update({ status: "pending", next_attempt_at: new Date().toISOString(), last_error: null }).eq("id", dispatchId).in("status", ["failed", "skipped"]);
}
