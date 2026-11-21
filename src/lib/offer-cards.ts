import "server-only";
import { todayIn } from "./core/dates";
import { dailyProfit, otherCostsFor, scopeSpendForOffer, type CostRule, type DailyOrderRow, type DailySpendRow, type OfferCard, type OfferScopeContext, type WorkspaceOfferLink } from "./core/offer-cards";
import type { OfferMetaBinding } from "./core/offer-spend-scope";
import { totals, type OrderRow, type SpendRow } from "./core/report";
import { spendStatus } from "./core/spend-status";
import { timed } from "./perf";
import type { Filters } from "./queries";
import { loadPixelDerivation } from "./services/offer-auto-link";
import type { Workspace } from "./session";
import type { Db } from "./supabase/types";

type CardOfferRow = { id: string; name: string; slug: string; status: string };

/**
 * Interruptor do mini gráfico diário dos cards. Depende das funções da migração 20261121000001_offer_cards_daily
 * (report_spend_daily_rows / report_offer_orders_daily). Desligado por padrão até a migração estar em produção:
 * ligue com OFFER_SPARKLINES=1 na Vercel. Se a função faltar, o card só fica sem o gráfico (nunca quebra).
 */
export const offerSparklinesEnabled = () => process.env.OFFER_SPARKLINES === "1";

/**
 * Cards de Gerenciar ofertas com UMA leitura compartilhada do workspace (gasto, vínculos, pixel, sincronizações,
 * custos) + 1 consulta de pedidos por oferta mostrada. Antes: loadReport por oferta (~9 consultas cada, e o gasto do
 * workspace inteiro baixado de novo a cada oferta). Os números seguem as mesmas regras do Resumo da oferta.
 */
export async function loadOfferCards(sb: Db, ws: Workspace, f: Filters, offers: CardOfferRow[]): Promise<OfferCard[]> {
  return timed("offer_cards.load", { offers: offers.length }, async () => {
    if (!offers.length) return [];
    const daily = offerSparklinesEnabled() && f.from < f.to;
    const [spend, excluded, offerLinks, bindingResult, pixelScope, pixelLinks, jobs, costs, orders, spendDaily, ordersDaily] = await Promise.all([
      sb.rpc("report_spend_rows", {
        p_workspace: ws.id, p_offer_ids: null, p_from: f.from, p_to: f.to, p_currency: ws.currency,
        p_account_id: null, p_campaign_id: null, p_adset_id: null, p_ad_id: null,
      }),
      sb.rpc("report_spend_excluded", { p_workspace: ws.id, p_from: f.from, p_to: f.to, p_currency: ws.currency }),
      sb.from("offer_ad_accounts").select("offer_id, campaign_filter, meta_ad_accounts(account_id, last_error)").eq("workspace_id", ws.id),
      sb.from("offer_meta_bindings").select("offer_id, level, object_id, meta_ad_accounts(account_id)").eq("workspace_id", ws.id).eq("status", "confirmed"),
      loadPixelDerivation(sb, ws.id),
      sb.from("offer_pixels").select("offer_id").eq("workspace_id", ws.id).eq("active", true),
      sb.from("sync_jobs").select("params").eq("workspace_id", ws.id).eq("kind", "meta_insights").in("status", ["success", "partial"]).order("started_at", { ascending: false }).limit(500),
      sb.from("cost_rules").select("offer_id, kind, value, active, starts_on, ends_on").eq("workspace_id", ws.id).eq("active", true),
      // Pedidos: a função não devolve a oferta da linha, então 1 chamada por oferta MOSTRADA (aba atual), em paralelo.
      Promise.all(offers.map((o) => sb.rpc("report_order_rows", {
        p_workspace: ws.id, p_offer_ids: [o.id], p_from: f.from, p_to: f.to, p_tz: ws.timezone, p_currency: ws.currency,
        p_source: null, p_campaign_id: null, p_adset_id: null, p_ad_id: null, p_status: null, p_account_id: null,
      }))),
      daily ? sb.rpc("report_spend_daily_rows", { p_workspace: ws.id, p_from: f.from, p_to: f.to, p_currency: ws.currency }) : Promise.resolve(null),
      daily ? sb.rpc("report_offer_orders_daily", { p_workspace: ws.id, p_from: f.from, p_to: f.to, p_tz: ws.timezone, p_currency: ws.currency }) : Promise.resolve(null),
    ]);
    if (spend.error) throw new Error(`report_spend_rows: ${spend.error.message}`);
    if (excluded.error) throw new Error(`report_spend_excluded: ${excluded.error.message}`);
    if (offerLinks.error) throw new Error(`offer_ad_accounts: ${offerLinks.error.message}`);

    type AccRef = { account_id: string; last_error?: string | null } | null;
    const links: (WorkspaceOfferLink & { lastError: string | null })[] = (offerLinks.data ?? []).flatMap((row) => {
      const acc = row.meta_ad_accounts as unknown as AccRef;
      return acc?.account_id ? [{ offerId: row.offer_id as string, accountId: acc.account_id, campaignFilter: row.campaign_filter as string | null, lastError: acc.last_error ?? null }] : [];
    });
    const manualBindings = (bindingResult.data ?? []).flatMap((row) => {
      const acc = row.meta_ad_accounts as unknown as AccRef;
      return acc?.account_id ? [{ offerId: row.offer_id as string, accountId: acc.account_id, level: row.level as "campaign" | "adset", objectId: row.object_id as string } satisfies OfferMetaBinding] : [];
    });
    const pixelBindings = pixelScope?.bindings ?? [];
    const ctx: OfferScopeContext = { links, manualBindings, pixelBindings, bindingsUsable: !bindingResult.error || pixelBindings.length > 0 };
    const rawSpend = (spend.data ?? []) as SpendRow[];
    const excludedRows = (excluded.data ?? []) as { account_id: string; currency: string; spend: number }[];
    const withPixel = new Set((pixelLinks.data ?? []).map((r) => r.offer_id as string));
    const windows = (jobs.data ?? [])
      .map((j) => j.params as { since?: string; until?: string } | null)
      .filter((p): p is { since: string; until: string } => !!p?.since && !!p?.until);
    const rules = (costs.error ? [] : costs.data ?? []) as CostRule[];
    const today = todayIn(ws.timezone);
    const dailyOrders = spendDaily && ordersDaily && !spendDaily.error && !ordersDaily.error ? ((ordersDaily.data ?? []) as DailyOrderRow[]) : null;
    const dailySpend = dailyOrders ? ((spendDaily!.data ?? []) as DailySpendRow[]) : null;

    return offers.map((o, i) => {
      const ordersResult = orders[i];
      if (ordersResult.error) throw new Error(`report_order_rows: ${ordersResult.error.message}`);
      const orderRows = (ordersResult.data ?? []) as OrderRow[];
      const scoped = scopeSpendForOffer(rawSpend, o.id, ctx);
      const pre = totals(scoped.rows, orderRows);
      const metrics = totals(scoped.rows, orderRows, otherCostsFor(rules, o.id, f.from, f.to, pre.gross_revenue, pre.approved_count));
      const safe = new Set(scoped.confirmedAccounts);
      const status = spendStatus({
        accounts: links.filter((l) => l.offerId === o.id).map((l) => ({ account_id: l.accountId, last_error: l.lastError })),
        syncedWindows: windows,
        excluded: excludedRows.filter((r) => safe.has(r.account_id)),
        pendingAssociations: scoped.pendingAccounts,
        offerScope: true,
        offerHasPixel: withPixel.has(o.id),
        from: f.from,
        to: f.to,
        today,
      });
      const daySeries = dailyOrders && dailySpend ? dailyProfit(f.from, f.to, o.id, dailyOrders, scopeSpendForOffer(dailySpend, o.id, ctx).rows) : null;
      return { id: o.id, name: o.name, slug: o.slug, status: o.status, metrics, reliable: status.reliable, spendMessage: status.message, daily: daySeries };
    });
  });
}
