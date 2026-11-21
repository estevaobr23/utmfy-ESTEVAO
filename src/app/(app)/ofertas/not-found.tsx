import { LinkButton } from "@/components/ui";
import { CONSOLIDATED_HREF } from "@/lib/core/offer-navigation";

export default function OfferNotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-dashed border-input-border bg-surface p-8 text-center">
      <h2 className="text-base font-semibold text-copy-strong">Oferta não encontrada</h2>
      <p className="mt-2 text-sm text-copy-muted">Ela não existe neste workspace ou foi removida. Escolha outra em Minhas ofertas.</p>
      <div className="mt-4 flex justify-center gap-2">
        <LinkButton href="/ofertas">Gerenciar ofertas</LinkButton>
        <LinkButton href={CONSOLIDATED_HREF}>Todas as ofertas</LinkButton>
      </div>
    </div>
  );
}
