"use client";

import { useState } from "react";
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
  if (!budget || budget.amount == null || (row.level !== "campaign" && row.level !== "adset")) return null;

  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= budget.amount * MAX_BUDGET_INCREASE;
  const source = budget.source;
  const inAccountCurrency = source && valid ? parsed / source.rate : null;
  const close = () => { setOpen(false); setReview(false); setValue(""); };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Editar orçamento de ${row.name}`} title="Editar orçamento diário" className="ml-1.5 text-[#8fa1bb] hover:text-white">✎</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <form action={updateMetaBudget} className="w-full max-w-sm rounded-lg border border-[#46536d] bg-[#202b43] p-5 text-left shadow-xl">
            <input type="hidden" name="level" value={row.level} />
            <input type="hidden" name="object_id" value={row.id} />
            <input type="hidden" name="back" value={back} />
            <h3 className="text-sm font-semibold text-white">Orçamento diário</h3>
            <p className="mt-1 truncate text-xs text-[#9aa6bb]" title={row.name}>{row.name} · {budget.mode === "CBO" ? "campanha (CBO)" : "conjunto (ABO)"}</p>
            <p className="mt-3 text-xs text-[#aab4c6]">
              Atual: <b className="text-white">{formatMoney(budget.amount, currency)}/dia</b>
              {source && <> · {formatMoney(source.amount, source.currency)} na conta, câmbio {source.rate.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</>}
            </p>
            <label className="mt-3 block text-xs text-[#aab4c6]">
              Novo orçamento ({currency})
              <input name="amount" inputMode="decimal" autoFocus required value={value} onChange={(e) => { setValue(e.target.value); setReview(false); }} placeholder="ex.: 25,00" className="mt-1 w-full rounded-md border border-[#46536d] bg-[#27334d] px-3 py-2 text-sm text-white outline-none focus:border-[#0874f9]" />
            </label>
            {value && !valid && <p className="mt-2 text-xs text-amber-300">Informe um valor maior que zero e até {MAX_BUDGET_INCREASE}× o atual.</p>}
            {review && valid && (
              <p className="mt-3 rounded-md bg-[#27334d] p-3 text-xs text-[#dce2ec]">
                Vai mudar de <b>{formatMoney(budget.amount, currency)}</b> para <b>{formatMoney(parsed, currency)}</b> por dia
                {source && inAccountCurrency != null && <> (≈ {formatMoney(inAccountCurrency, source.currency)} na conta)</>}. A alteração vale na Meta imediatamente.
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={close} className="rounded-md px-3 py-1.5 text-sm text-[#aab4c6] hover:text-white">Cancelar</button>
              {review && valid ? <SubmitButton pendingText="Aplicando na Meta...">Confirmar e aplicar</SubmitButton> : <button type="button" disabled={!valid} onClick={() => setReview(true)} className="rounded-md bg-[#0874f9] px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">Revisar</button>}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
