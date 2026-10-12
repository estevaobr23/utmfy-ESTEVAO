"use client";

import { useRef, useState } from "react";
import { archiveOffer, deleteOffer } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import type { OfferDeletionPreview } from "@/lib/offer-deletion";

export function OfferDangerZone({ offerId, offerName, preview }: { offerId: string; offerName: string; preview: OfferDeletionPreview }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const exact = confirmation === offerName;
  const action = preview.hasHistory ? archiveOffer : deleteOffer;

  const close = () => {
    setConfirmation("");
    dialog.current?.close();
  };

  return (
    <section className="mt-6 max-w-2xl rounded-md border border-rose-400/35 bg-rose-400/5 p-4">
      <h2 className="text-sm font-semibold text-rose-200">Zona de perigo</h2>
      <h3 className="mt-2 text-sm font-semibold text-[#f2d8dd]">Excluir oferta</h3>
      {preview.hasHistory ? (
        <p className="mt-1 text-sm text-[#b8c2d3]">Esta oferta possui {preview.orders} pedido(s) e {preview.sessions} sessão(ões). Ela não pode ser excluída; pode apenas ser arquivada, preservando todo o histórico.</p>
      ) : (
        <p className="mt-1 text-sm text-[#b8c2d3]">Esta oferta está sem histórico comercial. A exclusão removerá somente sua configuração e seus vínculos exclusivos.</p>
      )}
      <button type="button" onClick={() => dialog.current?.showModal()} className="mt-3 rounded-md bg-rose-500/15 px-3 py-1.5 text-sm font-semibold text-rose-200 ring-1 ring-rose-400/35 hover:bg-rose-500/25">
        {preview.hasHistory ? "Arquivar oferta" : "Excluir oferta vazia"}
      </button>

      <dialog ref={dialog} onClose={() => setConfirmation("")} className="m-auto w-[min(34rem,calc(100%-2rem))] rounded-lg border border-[#46546e] bg-[#202b43] p-0 text-[#e8edf5] shadow-2xl backdrop:bg-black/70">
        <form action={action} className="p-5">
          <input type="hidden" name="offer_id" value={offerId} />
          <h3 className="text-base font-semibold">{preview.hasHistory ? "Arquivar esta oferta?" : "Excluir permanentemente esta oferta?"}</h3>
          <p className="mt-2 text-sm leading-relaxed text-[#aeb8c9]">
            {preview.hasHistory
              ? "Ela sairá do seletor principal, mas pedidos, sessões, atribuições e logs continuarão preservados."
              : `Serão removidos ${preview.caktoItems} vínculo(s) Cakto, ${preview.adAccounts} vínculo(s) Meta, ${preview.pixels} vínculo(s) de pixel e ${preview.costRules} regra(s) exclusiva(s). Contas Meta, pixels e insights compartilhados não serão apagados.`}
          </p>
          <label className="mt-4 block text-sm font-medium text-[#d9e0ea]">Digite <b>{offerName}</b> para confirmar
            <input name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-1 w-full rounded-md border border-[#53617b] bg-[#172137] px-3 py-2 text-white outline-none focus:border-rose-400" />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-md bg-[#34415e] px-3 py-1.5 text-sm text-[#dce2ec]">Cancelar</button>
            <SubmitButton variant="danger" disabled={!exact} pendingText={preview.hasHistory ? "Arquivando…" : "Excluindo…"}>
              {preview.hasHistory ? "Confirmar arquivamento" : "Confirmar exclusão"}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </section>
  );
}
