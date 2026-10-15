import Link from "next/link";
import { Suspense } from "react";
import { OfferHeaderSkeleton } from "@/components/loading-skeletons";
import { requireOffer } from "@/lib/offer-context";

const STATUS: Record<string, [string, string]> = {
  active: ["ativa", "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25"],
  paused: ["pausada", "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/25"],
  archived: ["arquivada", "bg-slate-400/10 text-slate-300 ring-1 ring-slate-400/20"],
};

/** Faixa de contexto: todas as páginas da oferta mostram de onde vêm os números. */
async function OfferContextHeader({ params }: { params: LayoutProps<"/ofertas/[id]">["params"] }) {
  const { id } = await params;
  const { offer, pixels } = await requireOffer(id);
  const [label, cls] = STATUS[offer.status] ?? [offer.status, "bg-slate-400/10 text-slate-300"];
  const pending = <Link href={`/ofertas/${id}/integracoes`} className="text-amber-300 underline decoration-dotted">não vinculado</Link>;
  return (
      <div className="mb-[26px] flex min-h-[57px] flex-wrap items-center gap-x-6 gap-y-1 rounded-md bg-surface px-5 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-copy-muted">Dashboard</span>
          <span className="text-copy-muted">—</span>
          <h1 className="text-[19px] font-semibold text-copy-strong">{offer.name}</h1>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-copy">
          <div>
            <dt className="inline text-copy-muted">Pixel: </dt>
            <dd className="inline font-medium">{pixels.length ? pixels.map((p) => `${p.name} (${p.external_pixel_id})`).join(", ") : pending}</dd>
          </div>
        </dl>
      </div>
  );
}

export default function OfferLayout({ children, params }: LayoutProps<"/ofertas/[id]">) {
  return (
    <>
      <Suspense fallback={<OfferHeaderSkeleton />}><OfferContextHeader params={params} /></Suspense>
      {children}
    </>
  );
}
