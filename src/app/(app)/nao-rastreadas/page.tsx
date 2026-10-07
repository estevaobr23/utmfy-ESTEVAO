import { FilterBar } from "@/components/filters";
import { AttributionBadge, Badge, Code, Empty, Kpi, OrderStatusBadge, PageHeader, Table, Td, Th } from "@/components/ui";
import { REASON_LABELS, type UntrackedReason } from "@/lib/core/attribution";
import { dayRangeUtc, formatDateTime } from "@/lib/core/dates";
import { formatMoney } from "@/lib/core/money";
import { listOffers, parseFilters } from "@/lib/queries";
import { requireWorkspace } from "@/lib/session";

const UTM_COLS = ["utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term", "sck"];

// Vendas sem atribuição confiável + o MOTIVO provável de cada uma.
export default async function UntrackedPage({ searchParams }: PageProps<"/nao-rastreadas">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  const f = parseFilters(sp, s.workspace.timezone);
  const { start, end } = dayRangeUtc(f.from, f.to, s.workspace.timezone);
  const offers = await listOffers(s.sb, s.workspace.id);

  // Mesma janela do dashboard: vendas pagas no período (paid_at).
  let q = s.sb
    .from("orders")
    .select(
      "id, external_order_id, ref_id, status, gross_amount, currency, paid_at, provider_created_at, product_name, product_external_id, offer_id, order_attribution!inner(utm_source, utm_medium, utm_campaign, utm_content, utm_term, sck, attribution_status, untracked_reason, issues, ad_id, campaign_id)",
    )
    .eq("workspace_id", s.workspace.id)
    .gte("paid_at", start)
    .lt("paid_at", end)
    .or("attribution_status.in.(UNTRACKED,UNKNOWN),untracked_reason.not.is.null", { referencedTable: "order_attribution" })
    .order("paid_at", { ascending: false })
    .limit(500);
  if (f.offer) q = q.eq("offer_id", f.offer);
  if (f.status) q = q.eq("status", f.status);
  const { data, error } = await q;
  const rows = data ?? [];

  const byReason = new Map<string, { n: number; v: number }>();
  for (const o of rows) {
    const a = (Array.isArray(o.order_attribution) ? o.order_attribution[0] : o.order_attribution) as { untracked_reason: string | null } | null;
    const r = !o.offer_id ? "offer_not_mapped" : (a?.untracked_reason ?? "unknown");
    const cur = byReason.get(r) ?? { n: 0, v: 0 };
    byReason.set(r, { n: cur.n + 1, v: cur.v + Number(o.gross_amount ?? 0) });
  }

  return (
    <>
      <PageHeader
        title="Não rastreadas"
        subtitle="Vendas pagas no período sem atribuição a anúncio (ou com atribuição parcial), com a razão provável de cada uma."
      />
      <FilterBar f={f} offers={offers} action="/nao-rastreadas" />
      {error && <p className="mb-2 text-sm text-rose-700">{error.message}</p>}
      {byReason.size > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[...byReason.entries()]
            .sort((a, b) => b[1].n - a[1].n)
            .map(([r, x]) => (
              <Kpi key={r} label={REASON_LABELS[r as UntrackedReason] ?? r} value={x.n} hint={formatMoney(x.v, s.workspace.currency)} tone="warn" />
            ))}
        </div>
      )}
      {!rows.length ? (
        <Empty>Nenhuma venda sem atribuição no período.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Data</Th><Th>Pedido</Th><Th right>Valor</Th><Th>Produto</Th><Th>Status</Th><Th>UTMs recebidas</Th><Th>Classificação</Th><Th>Razão provável</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const a = (Array.isArray(o.order_attribution) ? o.order_attribution[0] : o.order_attribution) as Record<string, unknown> | null;
              const reason = !o.offer_id ? "offer_not_mapped" : (a?.untracked_reason as string | null);
              const issues = ((a?.issues as { code: string; message: string }[] | undefined) ?? []).filter((i) => i.code !== "MISSING_PLACEMENT");
              return (
                <tr key={o.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(o.paid_at ?? o.provider_created_at, s.workspace.timezone)}</Td>
                  <Td><Code>{o.ref_id ?? o.external_order_id.slice(0, 8)}</Code></Td>
                  <Td right>{formatMoney(Number(o.gross_amount ?? 0), o.currency)}</Td>
                  <Td>
                    {o.product_name}
                    <div className="font-mono text-[10px] text-slate-400">{o.product_external_id}</div>
                  </Td>
                  <Td><OrderStatusBadge status={o.status} /></Td>
                  <Td className="max-w-80 text-[11px]">
                    {UTM_COLS.map((k) => (
                      <div key={k} className="truncate" title={String(a?.[k] ?? "")}>
                        <span className="text-slate-400">{k}:</span> {a?.[k] ? String(a[k]) : <span className="text-rose-600">(vazio)</span>}
                      </div>
                    ))}
                  </Td>
                  <Td><AttributionBadge status={a?.attribution_status as string} /></Td>
                  <Td className="max-w-80 text-sm">
                    {reason ? <Badge tone="error">{REASON_LABELS[reason as UntrackedReason] ?? reason}</Badge> : <Badge>—</Badge>}
                    <ul className="mt-1 list-disc pl-4 text-[11px] text-slate-500">
                      {issues.slice(0, 4).map((i, n) => (
                        <li key={n}>{i.message}</li>
                      ))}
                    </ul>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
