import "server-only";
import type { Db } from "../supabase/types";
import { isUnchangedOrder, normalizeCaktoOrder, pickMappedOffer, type ExistingOrder, type OfferItemRow } from "../core/cakto/normalize";
import { mapPool } from "../core/concurrency";
import { caktoApi, caktoConfigured, CaktoApiError } from "./cakto-client";
import { finishJob, logEvent, startJob } from "./logs";
import { syncOfferWebhooks } from "./offer-webhooks";
import { ingestOrder } from "./orders";

// Sincronização/reconciliação: busca pedidos na API (fonte da verdade) por
// janela de updatedAt e aplica pelo MESMO caminho do webhook. Cada diferença
// encontrada vira uma linha em reconciliation_changes.

export type SyncStats = {
  fetched: number;
  inserted: number;
  statusChanged: number;
  unchanged: number;
  ignored: number;
  errors: number;
  unmapped: number;
  truncated: boolean;
};

export async function syncCaktoOrders(
  db: Db,
  workspaceId: string,
  opts: { from: string; to: string; mode: "sync" | "reconcile"; trigger: "manual" | "cron"; skipWebhookSync?: boolean; skipUnchanged?: boolean },
): Promise<{ jobId: string | null; stats: SyncStats; error?: string }> {
  const kind = opts.mode === "reconcile" ? "cakto_reconcile" : "cakto_sync";
  const jobId = await startJob(db, workspaceId, kind, opts.trigger, { from: opts.from, to: opts.to });
  const stats: SyncStats = { fetched: 0, inserted: 0, statusChanged: 0, unchanged: 0, ignored: 0, errors: 0, unmapped: 0, truncated: false };

  if (!caktoConfigured()) {
    const error = "CAKTO_CLIENT_ID/CAKTO_CLIENT_SECRET não configurados (ver SETUP_REQUIRED.md)";
    await finishJob(db, jobId, "failed", stats, error);
    await logEvent(db, { workspaceId, level: "warn", code: "CAKTO_SYNC_SKIPPED", provider: "cakto", message: error });
    return { jobId, stats, error };
  }

  // Produtos escolhidos nos webhooks de cada oferta definem para onde vão os pedidos históricos.
  // (O "Atualizar" pula esta leitura — é lenta e o mapeamento já está salvo; ela roda depois, em segundo plano.)
  if (!opts.skipWebhookSync) {
    try {
      await syncOfferWebhooks(db, workspaceId);
    } catch (e) {
      await logEvent(db, { workspaceId, level: "warn", code: "CAKTO_WEBHOOKS_READ_FAILED", provider: "cakto", message: (e as Error).message });
    }
  }

  try {
    const res = await caktoApi.listOrders({ updatedAt__gte: opts.from, updatedAt__lte: opts.to, ordering: "createdAt" });
    stats.fetched = res.items.length;
    stats.truncated = res.truncated;
    const snapshotAt = new Date().toISOString();

    const normalized: { n: Extract<ReturnType<typeof normalizeCaktoOrder>, { order: unknown }> }[] = [];
    for (const item of res.items) {
      const n = normalizeCaktoOrder(item, { eventAt: snapshotAt });
      if ("error" in n) stats.errors++;
      else normalized.push({ n });
    }

    // "Atualizar": uma consulta só diz o que já está igual no banco; só os pedidos novos/alterados passam pelo
    // caminho completo (cada um faz ~10 idas ao banco). Venda nova já chega pelo webhook; aqui é a rede de segurança.
    const known = new Map<string, ExistingOrder & { id: string }>();
    let offerItems: OfferItemRow[] = [];
    if (opts.skipUnchanged && normalized.length) {
      offerItems = ((await db.from("offer_cakto_items").select("offer_id, cakto_product_id, cakto_offer_id").eq("workspace_id", workspaceId)).data ?? []) as OfferItemRow[];
      const ids = normalized.map(({ n }) => n.order.external_order_id);
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await db.from("orders").select("id, external_order_id, status, gross_amount, net_amount, fees, offer_id")
          .eq("workspace_id", workspaceId).eq("provider", "cakto").in("external_order_id", ids.slice(i, i + 100));
        for (const row of data ?? []) known.set(row.external_order_id as string, row as unknown as ExistingOrder & { id: string });
      }
    }
    const pending = normalized.filter(({ n }) => {
      const existing = known.get(n.order.external_order_id);
      if (existing && isUnchangedOrder(existing, n.order, pickMappedOffer(offerItems, n.order.product_external_id, n.order.offer_external_id))) {
        stats.unchanged++;
        return false;
      }
      return true;
    });

    // Cada pedido faz várias idas ao banco; pedidos são independentes, então até 6 em paralelo.
    await mapPool(pending, 6, async ({ n }) => {
      const before = known.get(n.order.external_order_id) ?? (await db
        .from("orders")
        .select("id, status, gross_amount")
        .eq("workspace_id", workspaceId)
        .eq("provider", "cakto")
        .eq("external_order_id", n.order.external_order_id)
        .maybeSingle()).data;
      try {
        const r = await ingestOrder(db, workspaceId, n.order, opts.mode === "reconcile" ? "reconcile" : "api_sync");
        if (!r.offerId) stats.unmapped++;
        let change: string | null = null;
        if (r.inserted) {
          stats.inserted++;
          change = "missing_order";
        } else if (r.applied && before && before.status !== r.status) {
          stats.statusChanged++;
          change = r.status === "refunded" ? "refund_applied" : r.status === "chargedback" ? "chargeback_applied" : "status_changed";
        } else if (!r.applied && r.reason && r.reason !== "same_status") {
          stats.ignored++;
        } else {
          stats.unchanged++;
        }
        if (change) {
          await db.from("reconciliation_changes").insert({
            workspace_id: workspaceId,
            sync_job_id: jobId,
            order_id: r.orderId,
            external_order_id: n.order.external_order_id,
            change_type: change,
            before: before ? { status: before.status, gross_amount: before.gross_amount } : null,
            after: { status: r.status, gross_amount: n.order.gross_amount },
          });
          await logEvent(db, {
            workspaceId,
            level: "info",
            code: opts.mode === "reconcile" ? "RECONCILIATION_FIXED" : "CAKTO_SYNC_CHANGE",
            provider: "cakto",
            message: change,
            context: { order_id: n.order.external_order_id, before: before?.status ?? null, after: r.status },
          });
        }
      } catch (e) {
        stats.errors++;
        await logEvent(db, { workspaceId, level: "error", code: "CAKTO_SYNC_ORDER_FAILED", provider: "cakto", message: (e as Error).message, context: { order_id: n.order.external_order_id } });
      }
    });

    await db.from("cakto_connections").update({ last_sync_at: new Date().toISOString(), last_api_ok_at: new Date().toISOString(), status: "active", last_error: null }).eq("workspace_id", workspaceId);
    await finishJob(db, jobId, stats.errors ? "partial" : "success", stats);
    return { jobId, stats };
  } catch (e) {
    const err = e as Error;
    const reason = e instanceof CaktoApiError ? e.code : "exception";
    await db.from("cakto_connections").update({ last_error: `${reason}: ${err.message}`.slice(0, 300), status: "error" }).eq("workspace_id", workspaceId);
    await logEvent(db, { workspaceId, level: "error", code: "CAKTO_SYNC_FAILED", provider: "cakto", message: err.message, context: { reason } });
    await finishJob(db, jobId, "failed", stats, err.message);
    return { jobId, stats, error: err.message };
  }
}
