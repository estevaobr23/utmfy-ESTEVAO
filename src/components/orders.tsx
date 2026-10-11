import { FilterBar } from "@/components/filters";
import { AttributionBadge, Code, Empty, OrderStatusBadge, Table, Td, Th, inputCls } from "@/components/ui";
import { dayRangeUtc, formatDateTime } from "@/lib/core/dates";
import { formatMoney } from "@/lib/core/money";
import { catalogOptions, listAccounts, listOffers, parseFilters } from "@/lib/queries";
import type { Workspace } from "@/lib/session";
import type { Db } from "@/lib/supabase/types";

const PAYMENT = ["pix", "credit_card", "boleto", "picpay", "pix_auto", "debit_card"];
const UTM_COLS = ["utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term"];
const ATTRIBUTION: [string, string][] = [
  ["nao-rastreadas", "Sem anúncio identificado"],
  ["parciais", "Atribuição parcial"],
  ["rastreadas", "Anúncio identificado"],
];

/** Pedidos Cakto pelo horário de criação. Com offerId, a oferta vem da rota. */
export async function OrdersView({ sb, ws, sp, offerId, action }: { sb: Db; ws: Workspace; sp: Record<string, string | string[] | undefined>; offerId?: string; action: string }) {
  const f = parseFilters(sp, ws.timezone, offerId);
  const payment = typeof sp.payment === "string" && PAYMENT.includes(sp.payment) ? sp.payment : null;
  const attr = typeof sp.atribuicao === "string" && ATTRIBUTION.some(([k]) => k === sp.atribuicao) ? sp.atribuicao : null;
  const { start, end } = dayRangeUtc(f.from, f.to, ws.timezone);
  const [offers, accounts, catalog] = await Promise.all([
    offerId ? Promise.resolve([]) : listOffers(sb, ws.id),
    listAccounts(sb, ws.id),
    catalogOptions(sb, ws.id, f),
  ]);

  const attrJoin = f.source || f.campaign || f.adset || f.ad || f.account || attr ? "order_attribution!inner" : "order_attribution";
  let q = sb
    .from("orders")
    .select(
      `id, external_order_id, ref_id, status, gross_amount, currency, payment_method, offer_type, provider_created_at, paid_at, product_name, offer_id, source, offers(name), ${attrJoin}(utm_source, utm_medium, utm_campaign, utm_content, utm_term, campaign_name, campaign_id, adset_name, adset_id, ad_name, ad_id, attribution_status, untracked_reason)`,
    )
    .eq("workspace_id", ws.id)
    .gte("provider_created_at", start)
    .lt("provider_created_at", end)
    .order("provider_created_at", { ascending: false })
    .limit(500);
  if (f.offer) q = q.eq("offer_id", f.offer);
  if (f.status) q = q.eq("status", f.status);
  if (payment) q = q.eq("payment_method", payment);
  if (f.source) q = q.ilike("order_attribution.utm_source", f.source);
  if (f.campaign) q = q.eq("order_attribution.campaign_id", f.campaign);
  if (f.adset) q = q.eq("order_attribution.adset_id", f.adset);
  if (f.ad) q = q.eq("order_attribution.ad_id", f.ad);
  if (f.account) q = q.eq("order_attribution.account_id", f.account);
  if (attr === "nao-rastreadas") q = q.in("order_attribution.attribution_status", ["UNTRACKED", "UNKNOWN"]);
  if (attr === "parciais") q = q.in("order_attribution.attribution_status", ["EXACT_ID", "UTM_PARSED", "NAME_MATCH"]).not("order_attribution.untracked_reason", "is", null);
  if (attr === "rastreadas") q = q.in("order_attribution.attribution_status", ["EXACT_ID", "UTM_PARSED", "NAME_MATCH"]).is("order_attribution.untracked_reason", null);
  const { data: orders, error } = await q;

  return (
    <>
      <FilterBar
        f={f}
        offers={offers}
        accounts={accounts}
        catalog={catalog}
        hideOffer={!!offerId}
        action={action}
        extra={
          <>
            <select name="payment" defaultValue={payment ?? ""} className={inputCls}>
              <option value="">Pagamento</option>
              {PAYMENT.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select name="atribuicao" defaultValue={attr ?? ""} className={inputCls}>
              <option value="">Atribuição</option>
              {ATTRIBUTION.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </>
        }
      />
      {error && <p className="mb-2 text-sm text-rose-700">{error.message}</p>}
      {!orders?.length ? (
        <Empty>
          {offerId
            ? "Nenhum pedido desta oferta no período. Se você já vende, confira em Integrações se o webhook da Cakto desta oferta tem os produtos marcados."
            : "Nenhum pedido no período."}
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Horário</Th><Th>Pedido</Th>{!offerId && <Th>Oferta</Th>}<Th right>Valor</Th><Th>Status</Th><Th>Pagamento</Th><Th>Campanha / Conjunto / Anúncio</Th><Th>UTMs</Th><Th>Atribuição</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const a = (Array.isArray(o.order_attribution) ? o.order_attribution[0] : o.order_attribution) as Record<string, string | null> | null;
              const offer = o.offers as unknown as { name: string } | null;
              return (
                <tr key={o.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(o.provider_created_at, ws.timezone)}</Td>
                  <Td>
                    <Code>{o.ref_id ?? o.external_order_id.slice(0, 8)}</Code>
                    {o.offer_type && o.offer_type !== "main" && <div className="text-xs text-slate-500">{o.offer_type}</div>}
                    {o.source !== "webhook" && <div className="text-[10px] text-slate-400">{o.source}</div>}
                    {offerId && <div className="text-xs text-slate-400">{o.product_name}</div>}
                  </Td>
                  {!offerId && (
                    <Td>
                      {offer?.name ?? <span className="text-rose-700">sem oferta</span>}
                      <div className="text-xs text-slate-400">{o.product_name}</div>
                    </Td>
                  )}
                  <Td right>{formatMoney(o.gross_amount != null ? Number(o.gross_amount) : null, o.currency)}</Td>
                  <Td><OrderStatusBadge status={o.status} /></Td>
                  <Td>{o.payment_method}</Td>
                  <Td className="max-w-72 text-xs">
                    <div className="truncate" title={a?.campaign_id ?? ""}>{a?.campaign_name ?? a?.campaign_id ?? "—"}</div>
                    <div className="truncate text-slate-500" title={a?.adset_id ?? ""}>{a?.adset_name ?? a?.adset_id ?? "—"}</div>
                    <div className="truncate text-slate-500" title={a?.ad_id ?? ""}>{a?.ad_name ?? a?.ad_id ?? "—"}</div>
                  </Td>
                  <Td className="max-w-64 text-[11px] text-slate-500">
                    {a &&
                      UTM_COLS.map((k) =>
                        a[k] ? (
                          <div key={k} className="truncate" title={a[k] ?? ""}>
                            {k.replace("utm_", "")}: {a[k]}
                          </div>
                        ) : null,
                      )}
                  </Td>
                  <Td>
                    <AttributionBadge status={a?.attribution_status} />
                    {a?.untracked_reason && <div className="text-[11px] text-slate-500">{a.untracked_reason}</div>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {orders && orders.length >= 500 && <p className="mt-2 text-xs text-slate-500">Mostrando os 500 mais recentes; refine o filtro.</p>}
    </>
  );
}
