import Link from "next/link";
import { createOffer } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Empty, Field, inputCls, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatMoney, formatNumber } from "@/lib/core/money";
import { listOffers, loadReport, parseFilters } from "@/lib/queries";
import { requireWorkspace } from "@/lib/session";

export default async function OffersPage({ searchParams }: PageProps<"/ofertas">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  const offers = await listOffers(s.sb, s.workspace.id);
  const f = parseFilters({ preset: "7d" }, s.workspace.timezone);
  const rows = await Promise.all(
    offers.map(async (o) => {
      const rep = await loadReport(s.sb, s.workspace, { ...f, offer: o.id });
      return { o, r: rep.summary, ok: rep.spendStatus.reliable };
    }),
  );
  return (
    <>
      <PageHeader title="Ofertas" subtitle="Cada oferta é uma operação independente (produtos Cakto, contas Meta e pixels próprios). Métricas: últimos 7 dias." />
      <Flash sp={sp} />
      {rows.length === 0 ? (
        <Empty>Nenhuma oferta ainda. Crie a primeira abaixo.</Empty>
      ) : (
        <Table>
          <thead>
            <tr><Th>Oferta</Th><Th>Status</Th><Th right>Gasto</Th><Th right>Receita líquida</Th><Th right>Vendas</Th><Th right>ROAS</Th><Th right>CPA</Th><Th /></tr>
          </thead>
          <tbody>
            {rows.map(({ o, r, ok }) => (
              <tr key={o.id}>
                <Td><Link href={`/ofertas/${o.id}`} className="font-medium text-slate-900 hover:underline">{o.name}</Link><div className="font-mono text-xs text-slate-400">{o.slug}</div></Td>
                <Td><Badge tone={o.status === "active" ? "ok" : "muted"}>{o.status}</Badge></Td>
                <Td right>{formatMoney(r.spend, s.workspace.currency)}{!ok && <div><Badge tone="warn">gasto incompleto</Badge></div>}</Td>
                <Td right>{formatMoney(r.net_revenue, s.workspace.currency)}</Td>
                <Td right>{formatNumber(r.approved_count)}</Td>
                <Td right>{!ok || r.roas == null ? "—" : formatNumber(r.roas, 2)}</Td>
                <Td right>{ok ? formatMoney(r.cpa, s.workspace.currency) : "—"}</Td>
                <Td><Link href={`/ofertas/${o.id}/configurar`} className="text-xs text-sky-700 hover:underline">configurar</Link> · <Link href={`/ofertas/${o.id}/saude`} className="text-xs text-sky-700 hover:underline">saúde</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {s.canWrite && (
        <Card title="Passo 1 — Criar oferta" className="mt-6 max-w-xl">
          <form action={createOffer} className="flex flex-wrap items-end gap-3">
            <Field label="Nome"><input name="name" required maxLength={120} placeholder="Ex.: CestaVitrine" className={inputCls} /></Field>
            <Field label="Slug (opcional)"><input name="slug" maxLength={60} placeholder="cestavitrine" className={inputCls} /></Field>
            <SubmitButton>Criar oferta</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
