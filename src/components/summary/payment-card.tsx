"use client";

import { useState } from "react";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";
import { paymentByKey } from "@/lib/core/payment-methods";
import type { ApprovalItem, DistributionItem, MetricDatum } from "@/lib/core/summary";
import { ChartCard, EmptyChart } from "./chart-card";
import { PaymentLogo } from "./payment-logos";
import { SegmentedControl } from "./segmented";

type Basis = "count" | "amount";
const BASES = [{ id: "count", label: "Quantidade" }, { id: "amount", label: "Valor" }] as const;

const R = 54;
const STROKE = 18;
const C = 2 * Math.PI * R;

/** Rosca em SVG: cada fatia é um arco com a cor do meio; a fatia em foco engrossa e as outras esmaecem. */
function Donut({ items, basis, active, onActive, currency }: { items: DistributionItem[]; basis: Basis; active: string | null; onActive: (key: string | null) => void; currency: string }) {
  const total = items.reduce((sum, item) => sum + (basis === "count" ? item.count : item.amount), 0) || 1;
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const focus = active ? items.find((item) => item.key === active) : null;
  const slices = items.reduce<{ offset: number; out: { item: DistributionItem; length: number; offset: number }[] }>((acc, item) => {
    const length = ((basis === "count" ? item.count : item.amount) / total) * C;
    return { offset: acc.offset + length, out: [...acc.out, { item, length, offset: acc.offset }] };
  }, { offset: 0, out: [] }).out;
  return (
    <div className="relative h-44 w-44 shrink-0">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" role="img" aria-label="Distribuição das vendas por meio de pagamento">
        <circle cx={80} cy={80} r={R} fill="none" stroke="var(--app-bg)" strokeWidth={STROKE} />
        {slices.map(({ item, length, offset }) => {
          const on = active === item.key;
          return (
            <circle
              key={item.key} cx={80} cy={80} r={R} fill="none"
              stroke={paymentByKey(item.key).color} strokeWidth={on ? STROKE + 6 : STROKE}
              strokeDasharray={`${Math.max(length - (slices.length > 1 ? 1.2 : 0), 0.01)} ${C}`} strokeDashoffset={-offset}
              opacity={active && !on ? 0.35 : 1}
              className="cursor-pointer transition-[opacity,stroke-width] duration-150"
              onMouseEnter={() => onActive(item.key)} onMouseLeave={() => onActive(null)} onClick={() => onActive(on ? null : item.key)}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <b className="block text-2xl leading-tight text-white tabular-nums">{focus ? formatPct((basis === "count" ? focus.count : focus.amount) / total, 1) : formatNumber(totalCount)}</b>
          <span className="block text-[11px] text-copy-muted">{focus ? paymentByKey(focus.key).label : "vendas"}</span>
          <span className="block text-[11px] font-semibold tabular-nums text-copy">{formatMoney(focus ? focus.amount : totalAmount, currency)}</span>
        </div>
      </div>
    </div>
  );
}

export function PaymentCard({ data, currency }: { data: MetricDatum<DistributionItem[]>; currency: string }) {
  const [basis, setBasis] = useState<Basis>("count");
  const [active, setActive] = useState<string | null>(null);
  const items = [...(data.value ?? [])].sort((a, b) => (basis === "count" ? b.count - a.count || b.amount - a.amount : b.amount - a.amount));
  const total = items.reduce((sum, item) => sum + (basis === "count" ? item.count : item.amount), 0) || 1;
  return (
    <ChartCard title="Vendas por pagamento" subtitle="Pedidos principais aprovados" actions={<SegmentedControl value={basis} onChange={setBasis} options={BASES} label="Base do percentual" />}>
      {!items.length ? <EmptyChart /> : (
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <Donut items={items} basis={basis} active={active} onActive={setActive} currency={currency} />
          <ul className="w-full min-w-0 flex-1 divide-y divide-divider">
            {items.map((item) => {
              const info = paymentByKey(item.key);
              const share = (basis === "count" ? item.count : item.amount) / total;
              return (
                <li
                  key={item.key}
                  className={`flex items-center gap-3 px-1 py-2 transition-opacity ${active && active !== item.key ? "opacity-45" : ""}`}
                  onMouseEnter={() => setActive(item.key)} onMouseLeave={() => setActive(null)}
                  title={info.hint}
                >
                  <PaymentLogo methodKey={item.key} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-copy-strong">{info.label}</span>
                      <b className="shrink-0 text-[13px] tabular-nums text-white">{formatPct(share, 1)}</b>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-app-bg"><div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, 2)}%`, background: info.color }} /></div>
                    <div className="mt-1 flex justify-between gap-2 text-[11px] tabular-nums text-copy-muted">
                      <span>{formatNumber(item.count)} {item.count === 1 ? "venda" : "vendas"} · ticket {formatMoney(item.count ? item.amount / item.count : null, currency)}</span>
                      <span className="text-copy">{formatMoney(item.amount, currency)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

/** Taxa de aprovação por meio, com as mesmas logos e nomes do cartão de pagamentos. */
export function ApprovalCard({ data }: { data: MetricDatum<ApprovalItem[]> }) {
  const items = data.value ?? [];
  return (
    <ChartCard title="Taxa de aprovação" subtitle="Aprovações ÷ tentativas elegíveis">
      {!items.length ? <EmptyChart /> : (
        <ul className="space-y-3.5">
          {items.map((item) => {
            const info = paymentByKey(item.key);
            return (
              <li key={item.key} className="flex items-center gap-3">
                <PaymentLogo methodKey={item.key} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-copy">{info.label}</span>
                    <span className="shrink-0 tabular-nums text-copy-muted">{item.approved}/{item.attempts} · <b className="text-white">{item.rate == null ? "N/D" : formatPct(item.rate, 1)}</b></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-app-bg">
                    <div className="h-full rounded-full" style={{ width: item.rate == null ? "0%" : `${Math.max(item.rate * 100, item.rate > 0 ? 2 : 0)}%`, background: info.color }} />
                  </div>
                  {item.state === "partial" && <p className="mt-1 text-[10px] text-amber-200">Só chegaram aprovados para este meio; a taxa não é inferida.</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}
