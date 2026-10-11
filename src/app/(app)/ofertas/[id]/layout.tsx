import Link from "next/link";
import { requireOffer } from "@/lib/offer-context";

const STATUS: Record<string, [string, string]> = {
  active: ["ativa", "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25"],
  paused: ["pausada", "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/25"],
  archived: ["arquivada", "bg-slate-400/10 text-slate-300 ring-1 ring-slate-400/20"],
};

/** Faixa de contexto: todas as páginas da oferta mostram de onde vêm os números. */
export default async function OfferLayout({ children, params }: LayoutProps<"/ofertas/[id]">) {
  const { id } = await params;
  const { offer, accounts, pixels } = await requireOffer(id);
  const [label, cls] = STATUS[offer.status] ?? [offer.status, "bg-slate-400/10 text-slate-300"];
  const pending = <Link href={`/ofertas/${id}/integracoes`} className="text-amber-300 underline decoration-dotted">não vinculado</Link>;
  return (
    <>
      <div className="mb-5 rounded-md border border-[#34415d] bg-[#27334d] px-5 py-4 shadow-[0_10px_30px_rgba(4,9,20,0.12)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8491a8]">Dashboard</span>
          <span className="text-[#65738c]">—</span>
          <h1 className="text-lg font-semibold text-[#eef2f8]">{offer.name}</h1>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>
        </div>
        <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[#bac3d2]">
          <div>
            <dt className="inline text-[#7f8ca4]">Conta Meta: </dt>
            <dd className="inline font-medium">{accounts.length ? accounts.map((a) => a.account_name ?? `act_${a.account_id}`).join(", ") : pending}</dd>
          </div>
          <div>
            <dt className="inline text-[#7f8ca4]">Pixel: </dt>
            <dd className="inline font-medium">{pixels.length ? pixels.map((p) => `${p.name} (${p.external_pixel_id})`).join(", ") : pending}</dd>
          </div>
        </dl>
      </div>
      {children}
    </>
  );
}
