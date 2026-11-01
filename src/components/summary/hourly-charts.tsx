"use client";

import { useEffect, useRef, useState } from "react";
import { cumulative, hasHourlySpend, hourLabel, hourlyTotals, niceScale, profitOf, revenueOf, type RevenueMode } from "@/lib/core/hourly-chart";
import { formatMoney, formatNumber } from "@/lib/core/money";
import type { HourlyPoint, MetricDatum } from "@/lib/core/summary";
import { ChartCard, EmptyChart, Unavailable } from "./chart-card";
import { SegmentedControl } from "./segmented";

// SVG puro (sem biblioteca de gráfico). O viewBox usa a largura REAL do cartão (medida), então o texto fica
// sempre no tamanho certo: cartão largo mostra as 24 horas e o valor de cada barra; estreito, menos rótulos.
const H = 280;
const M = { left: 62, right: 12, top: 26, bottom: 30 };
const MODES = [{ id: "net", label: "Líquido" }, { id: "gross", label: "Bruto" }] as const;

const compact = (value: number, currency: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
const short = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);

/** Largura do elemento (px), atualizada quando o cartão muda de tamanho. 960 até medir (render do servidor). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(960);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

type Geometry = { W: number; plotW: number; plotH: number; slot: number };
const geometry = (width: number): Geometry => {
  const plotW = width - M.left - M.right;
  return { W: width, plotW, plotH: H - M.top - M.bottom, slot: plotW / 24 };
};

function Axes({ g, scale, currency, y }: { g: Geometry; scale: ReturnType<typeof niceScale>; currency: string; y: (value: number) => number }) {
  const every = g.slot >= 40 ? 1 : g.slot >= 22 ? 2 : 3;
  return (
    <>
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line x1={M.left} x2={g.W - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--divider)" strokeWidth={tick === 0 ? 1.3 : 0.6} strokeDasharray={tick === 0 ? undefined : "3 4"} />
          <text x={M.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--muted)">{compact(tick, currency)}</text>
        </g>
      ))}
      {Array.from({ length: 24 }, (_, hour) => hour).filter((hour) => hour % every === 0).map((hour) => (
        <text key={hour} x={M.left + g.slot * (hour + 0.5)} y={H - 10} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--text)">{every === 1 ? hourLabel(hour) : `${String(hour).padStart(2, "0")}h`}</text>
      ))}
    </>
  );
}

/** Caixinha flutuante sobre o gráfico (posição em % da largura, para acompanhar o redimensionamento). */
function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x / width, 0.12), 0.88) * 100;
  return (
    <div role="status" className="tooltip-panel pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-full rounded-md border border-divider bg-[var(--tooltip)] px-3 py-2 text-[11.5px] leading-relaxed text-copy shadow-lg shadow-black/30" style={{ left: `${left}%`, top: Math.max(y - 8, 8) }}>
      {children}
    </div>
  );
}

const Row = ({ color, label, value, tone = "text-copy-strong" }: { color?: string; label: string; value: string; tone?: string }) => (
  <div className="flex items-center justify-between gap-4 whitespace-nowrap">
    <span className="flex items-center gap-1.5">{color && <i className="h-2 w-2 rounded-full" style={{ background: color }} />}{label}</span>
    <b className={`tabular-nums ${tone}`}>{value}</b>
  </div>
);

function Totals({ points, mode, currency }: { points: HourlyPoint[]; mode: RevenueMode; currency: string }) {
  const totals = hourlyTotals(points, mode);
  const item = (label: string, value: number | null, tone = "text-copy-strong") => (
    <div><span className="text-[11px] text-copy-muted">{label}</span><b className={`block text-sm tabular-nums ${tone}`}>{value == null ? "—" : formatMoney(value, currency)}</b></div>
  );
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      {item("Faturamento", totals.revenue)}
      {item("Investimento", totals.investment)}
      {totals.profit != null && item("Lucro", totals.profit, totals.profit < 0 ? "text-danger-accessible" : "text-success")}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
      {items.map((item) => <span key={item.label} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-copy"><i className="h-3 w-3 rounded-[3px]" style={{ background: item.color }} />{item.label}</span>)}
    </div>
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
  const [ref, width] = useWidth<HTMLDivElement>();
  const g = geometry(width);
  return (
    <ChartCard title="Lucro por horário" subtitle="Soma do período por hora do dia · fuso do workspace" actions={<SegmentedControl value={mode} onChange={setMode} options={MODES} label="Bruto ou líquido" />}>
      <ChartBody datum={datum}>
        {(points, withSpend) => {
          const values = points.map((point) => (withSpend ? profitOf(point, mode) ?? 0 : revenueOf(point, mode)));
          const scale = niceScale(Math.min(...values), Math.max(...values));
          const y = (value: number) => M.top + g.plotH * (1 - (value - scale.lo) / (scale.hi - scale.lo));
          const labels = g.slot >= 52 ? "full" : g.slot >= 26 ? "short" : "none";
          const activePoint = active == null ? null : points[active];
          const activeValue = active == null ? 0 : values[active];
          return (
            <>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <Totals points={points} mode={mode} currency={currency} />
                <Legend items={withSpend ? [{ label: "Lucro +", color: "var(--primary)" }, { label: "Prejuízo −", color: "var(--danger)" }] : [{ label: "Faturamento", color: "var(--primary)" }]} />
              </div>
              {!withSpend && <p className="mb-2 text-[11px] text-copy-muted">Barras = faturamento por hora (o lucro aparece quando houver gasto por hora).</p>}
              <div ref={ref} className="relative" onMouseLeave={() => setActive(null)}>
                <svg viewBox={`0 0 ${g.W} ${H}`} width="100%" height={H} className="block" role="img" aria-label={withSpend ? "Lucro e prejuízo por hora do dia" : "Faturamento por hora do dia"}>
                  <Axes g={g} scale={scale} currency={currency} y={y} />
                  {points.map((point, index) => {
                    const value = values[index];
                    const top = y(Math.max(value, 0));
                    const bottom = y(Math.min(value, 0));
                    const x = M.left + g.slot * index;
                    const empty = value === 0 && point.sales === 0 && !(point.investment ?? 0);
                    const negative = value < 0;
                    return (
                      <g key={point.hour} tabIndex={0} className="cursor-pointer outline-none" onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)}>
                        <rect x={x} y={M.top} width={g.slot} height={g.plotH} fill={active === index ? "rgb(255 255 255 / 5%)" : "transparent"} />
                        {!empty && <rect x={x + g.slot * 0.2} y={top} width={g.slot * 0.6} height={Math.max(bottom - top, 2)} rx={2} fill={negative ? "var(--danger)" : "var(--primary)"} opacity={active == null || active === index ? 1 : 0.55} />}
                        {!empty && labels !== "none" && (
                          <text x={x + g.slot / 2} y={negative ? Math.min(top, y(0)) - 5 : top - 5} textAnchor="middle" fontSize={labels === "full" ? 10.5 : 9.5} fill="var(--muted)" className="tabular-nums">
                            {labels === "full" ? formatMoney(value, currency) : short(value)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                {activePoint && (
                  <Tooltip x={M.left + g.slot * (active! + 0.5)} y={y(Math.max(activeValue, 0))} width={g.W}>
                    <div className="mb-1 font-semibold text-copy-strong">{hourLabel(activePoint.hour)}</div>
                    {withSpend && <Row color={activeValue < 0 ? "var(--danger)" : "var(--primary)"} label={activeValue < 0 ? "Prejuízo na hora" : "Lucro na hora"} value={formatMoney(activeValue, currency)} tone={activeValue < 0 ? "text-danger-accessible" : "text-success"} />}
                    <Row label="Faturamento" value={formatMoney(revenueOf(activePoint, mode), currency)} />
                    {withSpend && <Row label="Investimento" value={formatMoney(activePoint.investment, currency)} />}
                    <Row label="Vendas" value={formatNumber(activePoint.sales)} />
                  </Tooltip>
                )}
              </div>
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
  const [ref, width] = useWidth<HTMLDivElement>();
  const g = geometry(width);
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
          const y = (value: number) => M.top + g.plotH * (1 - (value - scale.lo) / (scale.hi - scale.lo));
          const xAt = (index: number) => M.left + g.slot * (index + 0.5);
          const path = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${xAt(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
          const area = (values: number[]) => `${path(values)} L${xAt(23).toFixed(1)} ${y(0).toFixed(1)} L${xAt(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
          return (
            <>
              <div className="mb-2"><Legend items={shown.map((item) => ({ label: item.label, color: item.color }))} /></div>
              {!withSpend && <p className="mb-2 text-center text-[11px] text-copy-muted">Só o faturamento acumulado: investimento e lucro aparecem quando houver gasto por hora.</p>}
              <div ref={ref} className="relative" onMouseLeave={() => setActive(null)}>
                <svg viewBox={`0 0 ${g.W} ${H}`} width="100%" height={H} className="block" role="img" aria-label="Faturamento, investimento e lucro acumulados por hora">
                  <Axes g={g} scale={scale} currency={currency} y={y} />
                  {shown.map((item) => <path key={`a-${item.id}`} d={area(series[item.id] as number[])} fill={item.color} opacity={0.1} />)}
                  {shown.map((item) => <path key={item.id} d={path(series[item.id] as number[])} fill="none" stroke={item.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
                  {g.slot >= 18 && shown.map((item) => (series[item.id] as number[]).map((value, index) => <circle key={`${item.id}-${index}`} cx={xAt(index)} cy={y(value)} r={active === index ? 4.2 : 2.4} fill={item.color} />))}
                  {active != null && <line x1={xAt(active)} x2={xAt(active)} y1={M.top} y2={M.top + g.plotH} stroke="var(--muted)" strokeWidth={0.8} strokeDasharray="3 3" />}
                  {points.map((point, index) => (
                    <rect key={point.hour} x={M.left + g.slot * index} y={M.top} width={g.slot} height={g.plotH} fill="transparent" tabIndex={0} className="cursor-pointer outline-none" onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} />
                  ))}
                </svg>
                {active != null && (
                  <Tooltip x={xAt(active)} y={y(Math.max(...shown.map((item) => (series[item.id] as number[])[active])))} width={g.W}>
                    <div className="mb-1 font-semibold text-copy-strong">Até {hourLabel(active)}</div>
                    {shown.map((item) => {
                      const value = (series[item.id] as number[])[active];
                      return <Row key={item.id} color={item.color} label={item.label} value={formatMoney(value, currency)} tone={item.id === "profit" ? (value < 0 ? "text-danger-accessible" : "text-success") : "text-copy-strong"} />;
                    })}
                  </Tooltip>
                )}
              </div>
            </>
          );
        }}
      </ChartBody>
    </ChartCard>
  );
}
