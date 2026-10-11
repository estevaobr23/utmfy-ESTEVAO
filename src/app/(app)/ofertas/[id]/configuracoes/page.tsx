import { updateOffer } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Card, Field, inputCls, SectionTitle } from "@/components/ui";
import { requireOffer } from "@/lib/offer-context";

export default async function OfferSettings({ params, searchParams }: PageProps<"/ofertas/[id]/configuracoes">) {
  const { id } = await params;
  const sp = await searchParams;
  const { offer, canWrite } = await requireOffer(id);
  const v = (k: string) => (offer[k] as string | null) ?? "";
  return (
    <>
      <SectionTitle title="Configurações" subtitle="Dados básicos desta oferta." />
      <Flash sp={sp} />
      <Card title="Dados da oferta" className="max-w-2xl">
        <form action={updateOffer} className="grid gap-3">
          <input type="hidden" name="offer_id" value={offer.id} />
          <Field label="Nome"><input name="name" defaultValue={offer.name} className={inputCls} /></Field>
          <Field label="Status" hint="Pausada continua visível; arquivada sai do seletor de ofertas.">
            <select name="status" defaultValue={offer.status} className={inputCls}>
              <option value="active">ativa</option><option value="paused">pausada</option><option value="archived">arquivada</option>
            </select>
          </Field>
          <Field label="URL do checkout (Cakto)" hint="Usada no diagnóstico de tracking."><input name="checkout_url" defaultValue={v("checkout_url")} placeholder="https://pay.cakto.com.br/xxxx" className={inputCls} /></Field>
          <Field label="URL da página de vendas"><input name="landing_url" defaultValue={v("landing_url")} placeholder="https://..." className={inputCls} /></Field>
          <Field label="Notas"><textarea name="notes" defaultValue={v("notes")} rows={3} className={inputCls} /></Field>
          <p className="text-xs text-slate-500">Identificador interno: <span className="font-mono">{offer.slug}</span></p>
          {canWrite && <div><SubmitButton>Salvar</SubmitButton></div>}
        </form>
      </Card>
    </>
  );
}
