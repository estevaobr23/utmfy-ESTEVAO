import { LinkButton } from "@/components/ui";

export default function OfferNotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <h2 className="text-base font-semibold text-slate-900">Oferta não encontrada</h2>
      <p className="mt-2 text-sm text-slate-500">Ela não existe neste workspace ou foi removida. Escolha outra em Minhas ofertas.</p>
      <div className="mt-4 flex justify-center gap-2">
        <LinkButton href="/ofertas">Gerenciar ofertas</LinkButton>
        <LinkButton href="/">Todas as ofertas</LinkButton>
      </div>
    </div>
  );
}
