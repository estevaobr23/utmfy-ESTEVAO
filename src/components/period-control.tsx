"use client";

import { useState } from "react";
import { PERIOD_PRESETS } from "@/lib/core/period-presets";

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
  // O valor do select precisa ser estado: preso à prop, ele voltava para "Hoje" e não deixava escolher outro período.
  const [selected, setSelected] = useState(preset);
  const custom = selected === "custom";
  return (
    <>
      <label className={labelClassName}>
        Período
        <select
          name="preset"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
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
