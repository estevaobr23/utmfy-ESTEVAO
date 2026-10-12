import Link from "next/link";
import { DashboardView } from "@/components/dashboard";
import { Flash } from "@/components/filters";
import { SectionTitle } from "@/components/ui";
import { requireOffer } from "@/lib/offer-context";

export default async function OfferSummary({ params, searchParams }: PageProps<"/ofertas/[id]/resumo">) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, workspace, accounts, pixels, canWrite } = await requireOffer(id);
  const [items, sessions, orders] = await Promise.all([
    sb.from("offer_cakto_items").select("id", { count: "exact", head: true }).eq("offer_id", id),
    sb.from("tracking_sessions").select("id", { count: "exact", head: true }).eq("offer_id", id),
    sb.from("orders").select("id", { count: "exact", head: true }).eq("offer_id", id),
  ]);
  const steps: [string, boolean, string][] = [
    ["Produto Cakto", (items.count ?? 0) > 0, "integracoes"],
    ["Conta Meta", accounts.length > 0, "integracoes"],
    ["Pixel", pixels.length > 0, "integracoes"],
    ["Script de tracking", (sessions.count ?? 0) > 0, "tracking"],
    ["Primeira venda recebida", (orders.count ?? 0) > 0, "pedidos"],
  ];
  const missing = steps.filter(([, ok]) => !ok);
  return (
    <>
      <SectionTitle title="Resumo" subtitle="Quanto gastei, quanto vendi, quanto sobrou e quais campanhas trazem resultado — só desta oferta." />
      <Flash sp={sp} />
      {missing.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <b>Configuração {steps.length - missing.length}/{steps.length}</b>
          {steps.map(([label, ok, seg]) => (
            <Link key={label} href={`/ofertas/${id}/${seg}`} className={ok ? "text-emerald-700" : "underline decoration-dotted"}>
              {ok ? "✓" : "○"} {label}
            </Link>
          ))}
        </div>
      )}
      <DashboardView
        sb={sb}
        ws={workspace}
        sp={sp}
        offerId={id}
        basePath={`/ofertas/${id}/resumo`}
        metaPath={`/ofertas/${id}/meta`}
        untrackedPath={`/ofertas/${id}/pedidos`}
        canWrite={canWrite}
      />
    </>
  );
}
