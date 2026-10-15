"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { updateMetaBudget } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { MAX_BUDGET_INCREASE } from "@/lib/core/meta-advanced";
import type { MetaTableRow } from "@/lib/core/meta-metrics";
import { formatMoney } from "@/lib/core/money";

/** Lápis do orçamento diário: digita em reais, revisa e só então grava na Meta. */
export function BudgetEditor({ row, back, currency }: { row: MetaTableRow; back: string; currency: string }) {
  const budget = row.budget;
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [value, setValue] = useState("");
  const close = () => { setOpen(false); setReview(false); setValue(""); };
  // Orçamento novo chegou do servidor (mudança aplicada): fecha o diálogo.
  const amount = budget?.amount ?? null;
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

  if (!budget || budget.amount == null || (row.level !== "campaign" && row.level !== "adset")) return null;

  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= budget.amount * MAX_BUDGET_INCREASE;
  const unchanged = valid && Math.abs(parsed - budget.amount) < 0.005;
  const source = budget.source;
  const inAccountCurrency = source && valid ? parsed / source.rate : null;
  const pct = valid ? (parsed / budget.amount - 1) * 100 : null;
  const canReview = valid && !unchanged;
  const up = parsed >= budget.amount;

  const dialog = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Orçamento diário" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <form
        action={updateMetaBudget}
        onSubmit={(e) => { if (!review || !canReview) e.preventDefault(); }}
        className="w-full max-w-md whitespace-normal rounded-lg bg-surface text-left text-[13px] font-normal normal-case tracking-normal text-copy"
      >
        <input type="hidden" name="level" value={row.level} />
        <input type="hidden" name="object_id" value={row.id} />
        <input type="hidden" name="back" value={back} />

        <header className="flex items-start justify-between gap-3 border-b border-divider px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-white">Orçamento diário</h3>
            <p className="mt-0.5 break-words text-xs text-copy-muted">{budget.mode === "CBO" ? "Campanha (CBO)" : "Conjunto (ABO)"} · <span className="text-copy">{row.name}</span></p>
          </div>
          <button type="button" onClick={close} aria-label="Fechar" className="-mr-1 rounded p-1 text-copy-muted hover:bg-surface-hover hover:text-white">✕</button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg bg-app-bg px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-copy-muted">Orçamento atual</div>
            <div className="mt-0.5 text-lg font-semibold text-white">{formatMoney(budget.amount, currency)}<span className="text-xs font-normal text-copy-muted"> /dia</span></div>
            {source && <div className="mt-0.5 text-xs text-copy-muted">{formatMoney(source.amount, source.currency)} na conta · câmbio {source.rate.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</div>}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-copy">Novo orçamento diário</span>
            <span className="mt-1 flex items-center rounded-md border border-input-border bg-app-bg focus-within:border-primary">
              <span className="pl-3 text-sm text-copy-muted">{currency === "BRL" ? "R$" : currency}</span>
              <input
                name="amount" inputMode="decimal" autoFocus required autoComplete="off" value={value} placeholder="ex.: 120,00"
                onChange={(e) => { setValue(e.target.value); setReview(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (canReview && !review) setReview(true); } }}
                className="w-full bg-transparent px-2 py-2 text-sm text-white outline-none placeholder:text-copy-muted"
              />
            </span>
            <span className="mt-1 block text-[11px] text-copy-muted">Até {MAX_BUDGET_INCREASE}× o valor atual por mudança.</span>
          </label>

          {value && !valid && <p className="rounded-md bg-amber-400/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-400/25">Informe um valor maior que zero e até {MAX_BUDGET_INCREASE}× o atual ({formatMoney(budget.amount * MAX_BUDGET_INCREASE, currency)}).</p>}
          {unchanged && <p className="rounded-md bg-app-bg px-3 py-2 text-xs text-copy">Esse já é o orçamento atual.</p>}

          {review && canReview && pct != null && (
            <div className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--link)]">Confira antes de aplicar</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm text-copy line-through decoration-copy-muted">{formatMoney(budget.amount, currency)}</span>
                <span className="text-copy-muted">→</span>
                <span className="text-lg font-semibold text-white">{formatMoney(parsed, currency)}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${up ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{up ? "+" : ""}{pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</span>
              </div>
              {source && inAccountCurrency != null && <div className="mt-1 text-xs text-copy-muted">≈ {formatMoney(inAccountCurrency, source.currency)} por dia na conta</div>}
              <p className="mt-2 text-xs text-copy">A alteração vale na Meta imediatamente e fica registrada na coluna “Últ. atualização”.</p>
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
      <button type="button" onClick={() => setOpen(true)} aria-label={`Editar orçamento de ${row.name}`} title="Editar orçamento diário" className="ml-1.5 text-copy-muted hover:text-white">✎</button>
      {/* Fora da célula da tabela: senão herda nowrap/alinhamento à direita e fica preso ao overflow dela. */}
      {open && createPortal(dialog, document.body)}
    </>
  );
}
