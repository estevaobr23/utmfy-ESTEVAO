import "server-only";
import type { Db } from "../supabase/types";
import { hotmartApiSaleDate, hotmartApiSaleToData, type HotmartApiCommission, type HotmartApiSale } from "../core/hotmart/api-order";
import { hotmartOfferCode, hotmartProductId, normalizeHotmartOrder } from "../core/hotmart/normalize";
import { mapPool } from "../core/concurrency";
import { HOTMART_MAIN_PRODUCT_IDS } from "./hotmart-webhook";
import { hotmartApi, hotmartApiConfigured } from "./hotmart-client";
import { logEvent } from "./logs";
import { ingestOrder, resolveOffer } from "./orders";

// Reconciliação da Hotmart pela API de vendas: o webhook é o caminho normal (tempo real); aqui é a rede de segurança.
//  * venda aprovada que NÃO está no banco (webhook perdido/atrasado) → entra pelo mesmo caminho do webhook;
//  * venda paga no banco que a Hotmart já marca como reembolsada/chargeback → aplica o status.
// Só LEITURA na Hotmart. O que já está certo no banco não é tocado. Venda de produto não ligado a oferta é ignorada.

export type HotmartSyncStats = { fetched: number; missingFixed: number; statusFixed: number; unmapped: number; errors: number };

const EMPTY: HotmartSyncStats = { fetched: 0, missingFixed: 0, statusFixed: 0, unmapped: 0, errors: 0 };

export async function syncHotmartSales(db: Db, workspaceId: string, opts: { days?: number; minIntervalMs?: number } = {}): Promise<{ stats: HotmartSyncStats; skipped?: string; error?: string }> {
  if (!hotmartApiConfigured()) return { stats: { ...EMPTY }, skipped: "not_configured" };
  if (opts.minIntervalMs) {
    const since = new Date(Date.now() - opts.minIntervalMs).toISOString();
    const { data: recent } = await db.from("integration_logs").select("id").eq("workspace_id", workspaceId).eq("code", "HOTMART_RECONCILE").gte("created_at", since).limit(1);
    if (recent?.length) return { stats: { ...EMPTY }, skipped: "recent" };
  }
  const stats: HotmartSyncStats = { ...EMPTY };
  const to = Date.now();
  const from = to - (opts.days ?? 3) * 864e5;
  try {
    const [approved, refunded, chargedback, comms] = await Promise.all([
      hotmartApi.history(from, to),
      hotmartApi.history(from, to, "REFUNDED"),
      hotmartApi.history(from, to, "CHARGEBACK"),
      hotmartApi.commissions(from, to),
    ]);
    const commByTx = new Map<string, HotmartApiCommission>(comms.flatMap((c) => (c.transaction ? [[c.transaction, c] as const] : [])));
    const sales: HotmartApiSale[] = [...approved, ...refunded, ...chargedback];
    stats.fetched = sales.length;

    const ids = sales.flatMap((s) => (typeof s.purchase?.transaction === "string" ? [s.purchase.transaction] : []));
    const known = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await db.from("orders").select("external_order_id, status").eq("workspace_id", workspaceId).eq("provider", "hotmart").in("external_order_id", ids.slice(i, i + 100));
      for (const r of data ?? []) known.set(r.external_order_id as string, r.status as string);
    }

    await mapPool(sales, 4, async (sale) => {
      const tx = typeof sale.purchase?.transaction === "string" ? sale.purchase.transaction : null;
      if (!tx) return;
      const { data, event } = hotmartApiSaleToData(sale, commByTx.get(tx) ?? null);
      if (!event) return;
      const prevStatus = known.get(tx) ?? null;
      const isRefund = event === "PURCHASE_REFUNDED" || event === "PURCHASE_CHARGEBACK";
      // Já está igual ao que a Hotmart diz: nada a fazer.
      if (!isRefund && prevStatus) return;
      if (isRefund && (!prevStatus || prevStatus === "refunded" || prevStatus === "chargedback")) return;

      try {
        const offerId = await resolveOffer(db, workspaceId, hotmartProductId(data), hotmartOfferCode(data));
        if (!offerId) {
          stats.unmapped++;
          return;
        }
        // Reembolso: a API não informa a data; vale o momento em que foi detectado.
        const eventAt = isRefund ? new Date().toISOString() : hotmartApiSaleDate(sale);
        const n = normalizeHotmartOrder(data, { eventName: event, eventAt, mainProductIds: HOTMART_MAIN_PRODUCT_IDS });
        if ("error" in n) {
          stats.errors++;
          return;
        }
        // Mesma proteção do webhook: sem a comissão do repasse o pedido voltaria à moeda do comprador e sumiria do painel.
        if (isRefund) {
          const { data: prev } = await db.from("orders").select("currency").eq("workspace_id", workspaceId).eq("provider", "hotmart").eq("external_order_id", tx).maybeSingle();
          if (prev?.currency && prev.currency !== n.order.currency) Object.assign(n.order, { currency: null, base_amount: null, gross_amount: null, fees: null, net_amount: null });
        }
        const r = await ingestOrder(db, workspaceId, n.order, "reconcile", { offerId });
        const change = !prevStatus ? "missing_order" : event === "PURCHASE_CHARGEBACK" ? "chargeback_applied" : "refund_applied";
        if (!prevStatus) stats.missingFixed++;
        else stats.statusFixed++;
        await db.from("reconciliation_changes").insert({
          workspace_id: workspaceId,
          order_id: r.orderId,
          external_order_id: tx,
          change_type: change,
          before: prevStatus ? { status: prevStatus } : null,
          after: { status: r.status, gross_amount: n.order.gross_amount },
        });
        await logEvent(db, { workspaceId, level: "warn", code: "RECONCILIATION_FIXED", provider: "hotmart", message: `${change}: o webhook não entregou`, context: { order_id: tx, after: r.status } });
      } catch (e) {
        stats.errors++;
        await logEvent(db, { workspaceId, level: "error", code: "HOTMART_SYNC_ORDER_FAILED", provider: "hotmart", message: (e as Error).message.slice(0, 300), context: { order_id: tx } });
      }
    });
    await logEvent(db, { workspaceId, level: "info", code: "HOTMART_RECONCILE", provider: "hotmart", message: "reconciliação pela API", context: { ...stats, days: opts.days ?? 3 } });
    return { stats };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await logEvent(db, { workspaceId, level: "warn", code: "HOTMART_SYNC_FAILED", provider: "hotmart", message: msg });
    return { stats, error: msg };
  }
}
