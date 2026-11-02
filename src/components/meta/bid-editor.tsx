"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { updateMetaBid } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { BID_CAP_STRATEGY, MAX_BUDGET_INCREASE } from "@/lib/core/meta-advanced";
import type { MetaTableRow } from "@/lib/core/meta-metrics";
import { formatMoney } from "@/lib/core/money";

/** Pode editar quando a estratégia é "limite de lance" (bid cap); campanha com valores diferentes entre conjuntos também ("Vários"). */
export const canEditBid = (row: MetaTableRow) =>
  (row.level === "campaign" || row.level === "adset") && row.bidCap?.strategy === BID_CAP_STRATEGY && (row.bidCap.amount != null || row.bidCap.note === "Vários");

/** Lápis do bid cap: digita em reais, revisa e só então grava na Meta (mesmo fluxo do orçamento: 1º Enter revisa, 2º aplica). */
export function BidEditor({ row, back, currency }: { row: MetaTableRow; back: string; currency: string }) {
  const bid = row.bidCap;
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [value, setValue] = useState("");
  const close = () => { setOpen(false); setReview(false); setValue(""); };
  // Valor novo chegou do servidor (mudança aplicada): fecha o diálogo.
  const amount = bid?.amount ?? null;
  const [seenAmount, setSeenAmount] = useState(amount);
  if (seenAmount !== amount) {
    setSeenAmount(amount);
    if (open) close();
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setReview(false); setValue(""); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!bid || !canEditBid(row)) return null;

  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  const limit = amount != null ? amount * MAX_BUDGET_INCREASE : null;
  const valid = Number.isFinite(parsed) && parsed > 0 && (limit == null || parsed <= limit);
  const unchanged = valid && amount != null && Math.abs(parsed - amount) < 0.005;
  const source = bid.source;
  const inAccountCurrency = source && valid ? parsed / source.rate : null;
  const pct = valid && amount != null ? (parsed / amount - 1) * 100 : null;
  const canReview = valid && !unchanged;
  const up = amount != null && parsed >= amount;
  const scope = row.level === "campaign" ? "todos os conjuntos desta campanha que usam bid cap" : "este conjunto";

  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Bid cap" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <form
        action={updateMetaBid}
        onSubmit={(e) => { if (!review || !canReview) e.preventDefault(); }}
        className="w-full max-w-md whitespace-normal rounded-lg bg-surface text-left text-[13px] font-normal normal-case tracking-normal text-copy"
      >
        <input type="hidden" name="level" value={row.level} />
        <input type="hidden" name="object_id" value={row.id} />
        <input type="hidden" name="back" value={back} />

        <header className="flex items-start justify-between gap-3 border-b border-divider px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white">Bid cap (limite de lance)</h3>
            <p className="mt-0.5 break-words text-xs text-copy-muted">{row.level === "campaign" ? "Campanha" : "Conjunto"} · <span className="text-copy">{row.name}</span></p>
          </div>
          <button type="button" onClick={close} aria-label="Fechar" className="-mr-1 rounded p-1 text-copy-muted hover:bg-surface-hover hover:text-white">✕</button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg bg-app-bg px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-copy-muted">Bid cap atual</div>
            <div className="mt-0.5 text-lg font-semibold text-white">{amount != null ? formatMoney(amount, currency) : "Valores diferentes entre os conjuntos"}</div>
            {source && <div className="mt-0.5 text-xs text-copy-muted">{formatMoney(source.amount, source.currency)} na conta · câmbio {source.rate.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</div>}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-copy">Novo bid cap</span>
            <span className="mt-1 flex items-center rounded-md border border-input-border bg-app-bg focus-within:border-primary">
              <span className="pl-3 text-sm text-copy-muted">{currency === "BRL" ? "R$" : currency}</span>
              <input
                name="amount" inputMode="decimal" autoFocus required autoComplete="off" value={value} placeholder="ex.: 25,00"
                onChange={(e) => { setValue(e.target.value); setReview(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!canReview) return; if (review) e.currentTarget.form?.requestSubmit(); else setReview(true); } }}
                className="w-full bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-copy-muted"
              />
            </span>
            <span className="mt-1 block text-[11px] text-copy-muted">Vale para {scope}.{limit != null ? ` Até ${MAX_BUDGET_INCREASE}× o valor atual por mudança.` : ""}</span>
          </label>

          {value && !valid && <p className="rounded-md bg-amber-400/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-400/25">Informe um valor maior que zero{limit != null ? ` e até ${MAX_BUDGET_INCREASE}× o atual (${formatMoney(limit, currency)})` : ""}.</p>}
          {unchanged && <p className="rounded-md bg-app-bg px-3 py-2 text-xs text-copy">Esse já é o bid cap atual.</p>}

          {review && canReview && (
            <div className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--link)]">Confira antes de aplicar</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {amount != null && <><span className="text-sm text-copy line-through decoration-copy-muted">{formatMoney(amount, currency)}</span><span className="text-copy-muted">→</span></>}
                <span className="text-lg font-semibold text-white">{formatMoney(parsed, currency)}</span>
                {pct != null && <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${up ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{up ? "+" : ""}{pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</span>}
              </div>
              {source && inAccountCurrency != null && <div className="mt-1 text-xs text-copy-muted">≈ {formatMoney(inAccountCurrency, source.currency)} na conta</div>}
              <p className="mt-2 text-xs text-copy">Aperte <b>Enter</b> de novo para aplicar. A mudança vale na Meta na hora e pode reiniciar a fase de aprendizado.</p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-divider px-5 py-3">
          <button type="button" onClick={close} className="rounded-md px-3 py-1.5 text-sm text-copy hover:text-white">Cancelar</button>
          {review && canReview
            ? <SubmitButton pendingText="Aplicando na Meta...">Confirmar e aplicar</SubmitButton>
            : <button type="button" disabled={!canReview} onClick={() => setReview(true)} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">Revisar</button>}
        </footer>
      </form>
    </div>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Editar bid cap de ${row.name}`} title="Editar bid cap" className="ml-1.5 text-copy-muted hover:text-white">✎</button>
      {open && createPortal(dialog, document.body)}
    </>
  );
}
