"use client";

import { useState } from "react";

export const PERIOD_PRESETS: [string, string][] = [
  ["today", "Hoje"], ["yesterday", "Ontem"], ["7d", "Últimos 7 dias"], ["14d", "Últimos 14 dias"],
  ["30d", "Últimos 30 dias"], ["month", "Este mês"], ["last_month", "Mês passado"],
];

/**
 * Select de período com opção "Personalizado" sempre visível: ao escolher, mostra
 * os dois campos de data no lugar (sem precisar abrir "Mais filtros" pra achar).
 */
export function PeriodControl({ preset, from, to, selectClassName, inputClassName, labelClassName }: {
  preset: string;
  from: string;
  to: string;
  selectClassName: string;
  inputClassName: string;
  labelClassName: string;
}) {
  const [custom, setCustom] = useState(preset === "custom");
  return (
    <>
      <label className={labelClassName}>
        Período
        <select
          name="preset"
          value={custom ? "custom" : preset}
          onChange={(e) => setCustom(e.target.value === "custom")}
          className={selectClassName}
        >
          {PERIOD_PRESETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          <option value="custom">Personalizado…</option>
        </select>
      </label>
      {custom && (
        <>
          <label className={labelClassName}>
            De
            <input type="date" name="from" defaultValue={from} required className={inputClassName} />
          </label>
          <label className={labelClassName}>
            Até
            <input type="date" name="to" defaultValue={to} required className={inputClassName} />
          </label>
        </>
      )}
    </>
  );
}
