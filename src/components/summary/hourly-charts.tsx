"use client";

import { useState } from "react";
import { cumulative, hasHourlySpend, hourLabel, hourlyTotals, niceScale, profitOf, revenueOf, type RevenueMode } from "@/lib/core/hourly-chart";
import { formatMoney, formatNumber } from "@/lib/core/money";
import type { HourlyPoint, MetricDatum } from "@/lib/core/summary";
import { ChartCard, EmptyChart, Unavailable } from "./chart-card";
import { SegmentedControl } from "./segmented";

// SVG puro (sem biblioteca de gráfico). Tudo em coordenadas do viewBox; o SVG escala com a largura do cartão.
const W = 960;
const H = 270;
const M = { left: 66, right: 14, top: 14, bottom: 28 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const SLOT = PLOT_W / 24;

const MODES = [{ id: "net", label: "Líquido" }, { id: "gross", label: "Bruto" }] as const;

const compact = (value: number, currency: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);

function Axes({ scale, currency, y }: { scale: ReturnType<typeof niceScale>; currency: string; y: (value: number) => number }) {
  return (
    <>
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--divider)" strokeWidth={tick === 0 ? 1.4 : 0.6} strokeDasharray={tick === 0 ? undefined : "3 4"} />
          <text x={M.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={11} fill="var(--muted)">{compact(tick, currency)}</text>
        </g>
      ))}
      {Array.from({ length: 12 }, (_, index) => index * 2).map((hour) => (
        <text key={hour} x={M.left + SLOT * (hour + 0.5)} y={H - 9} textAnchor="middle" fontSize={11} fill="var(--muted)">{String(hour).padStart(2, "0")}h</text>
      ))}
    </>
  );
}

function Totals({ points, mode, currency }: { points: HourlyPoint[]; mode: RevenueMode; currency: string }) {
  const totals = hourlyTotals(points, mode);
  const item = (label: string, value: number | null, tone = "text-copy-strong") => (
    <div><span className="text-[11px] text-copy-muted">{label}</span><b className={`block text-sm tabular-nums ${tone}`}>{value == null ? "—" : formatMoney(value, currency)}</b></div>
  );
  return (
    <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2">
      {item("Faturamento", totals.revenue)}
      {item("Investimento", totals.investment)}
      {totals.profit != null && item("Lucro", totals.profit, totals.profit < 0 ? "text-danger-accessible" : "text-success")}
    </div>
  );
}

function Caption({ point, mode, currency, withSpend }: { point: HourlyPoint | null; mode: RevenueMode; currency: string; withSpend: boolean }) {
  if (!point) return <p className="mt-2 min-h-4 text-[11px] text-copy-muted">Passe o mouse (ou toque) em uma hora para ver os valores.</p>;
  const profit = profitOf(point, mode);
  return (
    <p className="mt-2 min-h-4 text-[11px] text-copy">
      <b className="text-copy-strong">{hourLabel(point.hour)}</b> · {formatNumber(point.sales)} {point.sales === 1 ? "venda" : "vendas"} · faturamento {formatMoney(revenueOf(point, mode), currency)}
      {withSpend && <> · investimento {formatMoney(point.investment, currency)} · lucro <b className={(profit ?? 0) < 0 ? "text-danger-accessible" : "text-success"}>{formatMoney(profit, currency)}</b></>}
    </p>
  );
}

function ChartBody({ datum, children }: { datum: MetricDatum<HourlyPoint[]>; children: (points: HourlyPoint[], withSpend: boolean) => React.ReactNode }) {
  if (!datum.value) return <Unavailable note={datum.note} />;
  if (datum.state === "no_activity") return <EmptyChart />;
  const withSpend = hasHourlySpend(datum.value);
  return (
    <>
      {datum.note && <p className="mb-3 rounded bg-amber-400/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-400/25">{datum.note}</p>}
      {children(datum.value, withSpend)}
    </>
  );
}

export function HourlyProfitCard({ datum, currency }: { datum: MetricDatum<HourlyPoint[]>; currency: string }) {
  const [mode, setMode] = useState<RevenueMode>("net");
  const [active, setActive] = useState<number | null>(null);
  return (
    <ChartCard title="Lucro por horário" subtitle="Soma do período por hora do dia · fuso do workspace" actions={<SegmentedControl value={mode} onChange={setMode} options={MODES} label="Bruto ou líquido" />}>
      <ChartBody datum={datum}>
        {(points, withSpend) => {
          const values = points.map((point) => (withSpend ? profitOf(point, mode) ?? 0 : revenueOf(point, mode)));
          const scale = niceScale(Math.min(...values), Math.max(...values));
          const y = (value: number) => M.top + PLOT_H * (1 - (value - scale.lo) / (scale.hi - scale.lo));
          return (
            <>
              <Totals points={points} mode={mode} currency={currency} />
              {!withSpend && <p className="mb-2 text-[11px] text-copy-muted">Barras = faturamento por hora (o lucro aparece quando houver gasto por hora).</p>}
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={withSpend ? "Lucro por hora do dia" : "Faturamento por hora do dia"} onMouseLeave={() => setActive(null)}>
                <Axes scale={scale} currency={currency} y={y} />
                {points.map((point, index) => {
                  const value = values[index];
                  const top = y(Math.max(value, 0));
                  const bottom = y(Math.min(value, 0));
                  const x = M.left + SLOT * index;
                  return (
                    <g key={point.hour} tabIndex={0} onMouseEnter={() => setActive(point.hour)} onFocus={() => setActive(point.hour)} onClick={() => setActive(point.hour)} className="outline-none">
                      <rect x={x} y={M.top} width={SLOT} height={PLOT_H} fill={active === point.hour ? "var(--surface-hover)" : "transparent"} />
                      {value !== 0 && <rect x={x + SLOT * 0.2} y={top} width={SLOT * 0.6} height={Math.max(bottom - top, 1.5)} rx={2} fill={value < 0 ? "var(--danger)" : "var(--primary)"} />}
                      <title>{`${hourLabel(point.hour)}: ${formatMoney(value, currency)}`}</title>
                    </g>
                  );
                })}
              </svg>
              <Caption point={active == null ? null : points[active]} mode={mode} currency={currency} withSpend={withSpend} />
            </>
          );
        }}
      </ChartBody>
    </ChartCard>
  );
}

const SERIES = [
  { id: "investment", label: "Investimento", color: "var(--warning)" },
  { id: "revenue", label: "Faturamento", color: "var(--primary)" },
  { id: "profit", label: "Lucro", color: "var(--success)" },
] as const;

export function HourlyFinancialCard({ datum, currency }: { datum: MetricDatum<HourlyPoint[]>; currency: string }) {
  const [mode, setMode] = useState<RevenueMode>("net");
  const [active, setActive] = useState<number | null>(null);
  return (
    <ChartCard title="Faturamento × Investimento × Lucro por hora" subtitle="Séries acumuladas ao longo do dia · soma do período" actions={<SegmentedControl value={mode} onChange={setMode} options={MODES} label="Bruto ou líquido" />}>
      <ChartBody datum={datum}>
        {(points, withSpend) => {
          const revenue = cumulative(points.map((point) => revenueOf(point, mode)));
          const investment = withSpend ? cumulative(points.map((point) => point.investment ?? 0)) : null;
          const profit = investment ? revenue.map((value, index) => value - investment[index]) : null;
          const series = { revenue, investment, profit };
          const shown = SERIES.filter((item) => series[item.id] != null);
          const all = shown.flatMap((item) => series[item.id] as number[]);
          const scale = niceScale(Math.min(...all), Math.max(...all));
          const y = (value: number) => M.top + PLOT_H * (1 - (value - scale.lo) / (scale.hi - scale.lo));
          const xAt = (index: number) => M.left + SLOT * (index + 0.5);
          const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${xAt(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
          return (
            <>
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
                {shown.map((item) => <span key={item.id} className="flex items-center gap-1.5 text-[11px] font-semibold text-copy"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />{item.label}</span>)}
              </div>
              {!withSpend && <p className="mb-2 text-[11px] text-copy-muted">Só o faturamento acumulado: investimento e lucro aparecem quando houver gasto por hora.</p>}
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Faturamento, investimento e lucro acumulados por hora" onMouseLeave={() => setActive(null)}>
                <Axes scale={scale} currency={currency} y={y} />
                <path d={`${path(revenue)} L${xAt(23).toFixed(1)} ${y(0).toFixed(1)} L${xAt(0).toFixed(1)} ${y(0).toFixed(1)} Z`} fill="var(--primary)" opacity={0.12} />
                {shown.map((item) => (
                  <path key={item.id} d={path(series[item.id] as number[])} fill="none" stroke={item.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {active != null && <line x1={xAt(active)} x2={xAt(active)} y1={M.top} y2={M.top + PLOT_H} stroke="var(--muted)" strokeWidth={0.8} />}
                {active != null && shown.map((item) => <circle key={item.id} cx={xAt(active)} cy={y((series[item.id] as number[])[active])} r={3.6} fill={item.color} />)}
                {points.map((point, index) => (
                  <rect key={point.hour} x={M.left + SLOT * index} y={M.top} width={SLOT} height={PLOT_H} fill="transparent" tabIndex={0} className="outline-none" onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)}>
                    <title>{`${hourLabel(point.hour)} · acumulado ${formatMoney(revenue[index], currency)}`}</title>
                  </rect>
                ))}
              </svg>
              <p className="mt-2 min-h-4 text-[11px] text-copy">
                {active == null
                  ? <span className="text-copy-muted">Passe o mouse (ou toque) em uma hora para ver o acumulado até ela.</span>
                  : <><b className="text-copy-strong">até {hourLabel(active)}</b> · faturamento {formatMoney(revenue[active], currency)}{investment && profit && <> · investimento {formatMoney(investment[active], currency)} · lucro <b className={profit[active] < 0 ? "text-danger-accessible" : "text-success"}>{formatMoney(profit[active], currency)}</b></>}</>}
              </p>
            </>
          );
        }}
      </ChartBody>
    </ChartCard>
  );
}
