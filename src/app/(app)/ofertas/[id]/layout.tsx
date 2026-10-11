import Link from "next/link";
import { requireOffer } from "@/lib/offer-context";

const STATUS: Record<string, [string, string]> = {
  active: ["ativa", "bg-emerald-100 text-emerald-800"],
  paused: ["pausada", "bg-amber-100 text-amber-800"],
  archived: ["arquivada", "bg-slate-200 text-slate-700"],
};

/** Faixa de contexto: todas as páginas da oferta mostram de onde vêm os números. */
export default async function OfferLayout({ children, params }: LayoutProps<"/ofertas/[id]">) {
  const { id } = await params;
  const { offer, accounts, pixels } = await requireOffer(id);
  const [label, cls] = STATUS[offer.status] ?? [offer.status, "bg-slate-200 text-slate-700"];
  const pending = <Link href={`/ofertas/${id}/integracoes`} className="text-amber-700 underline decoration-dotted">não vinculado</Link>;
  return (
    <>
      <div className="mb-5 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Oferta</span>
          <h1 className="text-lg font-semibold text-slate-900">{offer.name}</h1>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
        </div>
        <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
          <div>
            <dt className="inline text-slate-400">Conta Meta: </dt>
            <dd className="inline font-medium">{accounts.length ? accounts.map((a) => a.account_name ?? `act_${a.account_id}`).join(", ") : pending}</dd>
          </div>
          <div>
            <dt className="inline text-slate-400">Pixel: </dt>
            <dd className="inline font-medium">{pixels.length ? pixels.map((p) => `${p.name} (${p.external_pixel_id})`).join(", ") : pending}</dd>
          </div>
        </dl>
      </div>
      {children}
    </>
  );
}
