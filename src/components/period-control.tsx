"use client";

import { useEffect, useRef, useState } from "react";
import { PERIOD_COOKIE, PERIOD_COOKIE_MAX_AGE, encodePeriod } from "@/lib/core/period-memory";
import { PERIOD_PRESETS } from "@/lib/core/period-presets";

/**
 * Select de período com opção "Personalizado" sempre visível: ao escolher, mostra
 * os dois campos de data no lugar (sem precisar abrir "Mais filtros" pra achar).
 *
 * Ao ENVIAR o formulário, o período escolhido é lembrado (cookie `utmfy_period`, 30 dias): trocar de oferta, de aba
 * ou reabrir o navegador mantém o período em vez de voltar para "Hoje". Quem usa este controle deve remontá-lo
 * quando o filtro aplicado muda (`key`), para o select nunca mostrar um valor diferente do filtro.
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
  const anchor = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const remember = () => {
      const data = new FormData(form);
      const value = encodePeriod({ preset: String(data.get("preset") ?? ""), from: String(data.get("from") ?? ""), to: String(data.get("to") ?? "") });
      if (!value) return;
      try {
        document.cookie = `${PERIOD_COOKIE}=${value}; path=/; max-age=${PERIOD_COOKIE_MAX_AGE}; SameSite=Lax`;
      } catch { /* cookie bloqueado: o período continua valendo pela URL */ }
    };
    form.addEventListener("submit", remember);
    return () => form.removeEventListener("submit", remember);
  }, []);

  return (
    <>
      <label ref={anchor} className={labelClassName}>
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
