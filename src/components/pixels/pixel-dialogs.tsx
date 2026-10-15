"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPixel, deletePixel } from "@/app/actions";
import { CodeBlock, SubmitButton } from "@/components/client";

const dialogCls = "m-auto w-[min(34rem,calc(100%-2rem))] rounded-lg border border-divider bg-surface p-0 text-copy shadow-2xl backdrop:bg-black/70";
const inputCls = "mt-1 w-full rounded-md border border-input-border bg-app-bg px-3 py-2 text-sm text-white outline-none placeholder:text-copy-muted focus:border-primary";
const labelCls = "block text-sm font-medium text-copy";
const ghostBtn = "rounded-md bg-surface-hover px-3 py-1.5 text-sm text-copy hover:bg-surface";

/** Abre um <dialog> nativo (e fecha ao clicar fora). */
function useDialog(openOnMount = false) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (openOnMount && ref.current && !ref.current.open) ref.current.showModal();
  }, [openOnMount]);
  const open = () => ref.current?.showModal();
  const close = () => ref.current?.close();
  const backdropClose = (e: React.MouseEvent<HTMLDialogElement>) => { if (e.target === e.currentTarget) close(); };
  return { ref, open, close, backdropClose };
}

export type OfferOption = { id: string; name: string; hasPixel: boolean };

/** Botão "Cadastrar novo pixel": ID + token da API de Conversões + oferta. Ao concluir, a página abre o popup do código. */
export function NewPixelDialog({ offers }: { offers: OfferOption[] }) {
  const { ref, open, close, backdropClose } = useDialog();
  return (
    <>
      <button type="button" onClick={open} className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-hover)]">
        + Cadastrar novo pixel
      </button>
      <dialog ref={ref} onClick={backdropClose} className={dialogCls}>
        <form action={createPixel} className="p-5">
          <h3 className="text-base font-semibold">Cadastrar novo pixel</h3>
          <p className="mt-1 text-sm text-copy-muted">Pixel da Meta. Ao salvar, você recebe o código para colar no topo da sua página.</p>

          <label className={`mt-4 ${labelCls}`}>Nome
            <input name="name" maxLength={120} placeholder="Ex.: Pixel Calistenia" className={inputCls} />
          </label>
          <label className={`mt-3 ${labelCls}`}>ID do pixel (numérico)
            <input name="external_pixel_id" required inputMode="numeric" pattern="[0-9]{5,30}" autoComplete="off" placeholder="Ex.: 1278010487791087" className={inputCls} />
          </label>
          <label className={`mt-3 ${labelCls}`}>Token da API de Conversões
            <input name="token" type="password" required minLength={20} autoComplete="off" placeholder="Cole o token gerado no Gerenciador de Eventos da Meta" className={inputCls} />
            <span className="mt-1 block text-xs font-normal text-copy-muted">Guardado no cofre (Vault); nunca aparece de volta na tela.</span>
          </label>
          {offers.length > 0 ? (
            <label className={`mt-3 ${labelCls}`}>Oferta deste pixel
              <select name="offer_id" required defaultValue="" className={inputCls}>
                <option value="" disabled>Selecione a oferta…</option>
                {offers.map((o) => <option key={o.id} value={o.id}>{o.name}{o.hasPixel ? " · já tem pixel" : ""}</option>)}
              </select>
              <span className="mt-1 block text-xs font-normal text-copy-muted">Um pixel exclusivo por oferta: é assim que o gasto e as vendas caem na oferta certa.</span>
            </label>
          ) : (
            <p className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              Você ainda não tem oferta. Crie uma em <Link href="/ofertas" className="underline">Gerenciar ofertas</Link> e depois associe este pixel a ela.
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} className={ghostBtn}>Cancelar</button>
            <SubmitButton pendingText="Cadastrando…">Cadastrar pixel</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}

export type PixelOfferCode = { offerId: string; offerName: string };

/** Popup com o código da página. Abre sozinho logo após o cadastro (`defaultOpen`) e pode ser reaberto pelo card. */
export function PixelCodeDialog({
  pixelName, externalPixelId, offers, appUrl, defaultOpen = false,
}: { pixelName: string; externalPixelId: string; offers: PixelOfferCode[]; appUrl: string; defaultOpen?: boolean }) {
  const router = useRouter();
  const { ref, open, close, backdropClose } = useDialog(defaultOpen);
  const snippet = (offerId: string) => `<script src="${appUrl}/t.js" data-offer="${offerId}" data-pixel="${externalPixelId}" async></script>`;
  return (
    <>
      <button type="button" onClick={open} className="rounded-md bg-surface-hover px-2.5 py-1 text-xs font-medium text-copy ring-1 ring-input-border hover:bg-surface">
        Ver código
      </button>
      <dialog ref={ref} onClick={backdropClose} onClose={() => { if (defaultOpen) router.replace("/pixels"); }} className={dialogCls}>
        <div className="p-5">
          <h3 className="text-base font-semibold">Código do pixel · {pixelName}</h3>
          {offers.length === 0 ? (
            <p className="mt-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
              Este pixel ainda não está associado a nenhuma oferta. Associe-o no campo <b>Ofertas</b> do card e reabra este código.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-copy">
                Cole <b>uma linha</b> no <code className="rounded bg-app-bg px-1 text-xs">&lt;head&gt;</code> (topo) de <b>todas as páginas do funil</b>. Ela carrega o pixel da Meta, registra PageView e InitiateCheckout e leva as UTMs até o checkout.
              </p>
              <div className="mt-3 space-y-3">
                {offers.map((o) => (
                  <div key={o.offerId}>
                    {offers.length > 1 && <div className="mb-1 text-xs font-semibold text-copy">{o.offerName}</div>}
                    <CodeBlock code={snippet(o.offerId)} />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-copy-muted">
                Não instale outro código do pixel da Meta nem o da UTMify na mesma página: os eventos dobram.
              </p>
            </>
          )}
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={close} className={ghostBtn}>Fechar</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Botão "Excluir" com confirmação: remove o pixel, os vínculos com ofertas e o histórico de envio. */
export function DeletePixelDialog({
  pixelId, pixelName, externalPixelId, offerCount, dispatchCount,
}: { pixelId: string; pixelName: string; externalPixelId: string; offerCount: number; dispatchCount: number }) {
  const { ref, open, close, backdropClose } = useDialog();
  return (
    <>
      <button type="button" onClick={open} className="rounded-md bg-rose-400/10 px-2.5 py-1 text-xs font-medium text-rose-300 ring-1 ring-rose-400/30 hover:bg-rose-400/15">
        Excluir
      </button>
      <dialog ref={ref} onClick={backdropClose} className={dialogCls}>
        <form action={deletePixel} className="p-5">
          <input type="hidden" name="pixel_id" value={pixelId} />
          <h3 className="text-base font-semibold">Excluir este pixel?</h3>
          <p className="mt-2 text-sm leading-relaxed text-copy">
            <b>{pixelName}</b> ({externalPixelId}) será removido do UTMFY junto com {offerCount} vínculo(s) de oferta, {dispatchCount} evento(s) do histórico de envio e o token salvo.
            Pedidos e gasto da Meta não são afetados, e o pixel continua existindo na Meta.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={close} className={ghostBtn}>Cancelar</button>
            <SubmitButton variant="danger" pendingText="Excluindo…">Excluir pixel</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
