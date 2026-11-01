"use client";

import { useState, type ReactNode } from "react";

/** Botões lado a lado no cabeçalho do cartão (Bruto/Líquido, Todos/Principais). */
export function SegmentedControl<T extends string>({ value, onChange, options, label }: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { id: T; label: string }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded border border-input-border text-[11px] font-semibold">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`px-2.5 py-1 ${value === option.id ? "bg-primary text-white" : "text-copy hover:bg-surface-hover"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Cartão com abas: o conteúdo de cada aba vem pronto do servidor; aqui só se escolhe qual mostrar. */
export function TabbedCard({ title, subtitle, tabs, footer }: {
  title: string;
  subtitle: string;
  tabs: readonly { id: string; label: string; subtitle?: string; content: ReactNode }[];
  footer?: ReactNode;
}) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <section className="min-h-72 min-w-0 rounded-md bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-divider px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-copy-strong">{title}</h3>
          <p className="mt-0.5 text-xs text-copy-muted">{current?.subtitle ?? subtitle}</p>
        </div>
        <SegmentedControl value={active} onChange={setActive} options={tabs.map((tab) => ({ id: tab.id, label: tab.label }))} label={title} />
      </header>
      <div className="p-5">
        {current?.content}
        {footer}
      </div>
    </section>
  );
}
