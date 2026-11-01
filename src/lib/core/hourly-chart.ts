import type { HourlyPoint } from "./summary";

export type RevenueMode = "net" | "gross";

/** Eixo "bonito": degraus de 1, 2, 2,5, 5 × 10ⁿ cobrindo [min, max] e sempre incluindo o zero. */
export function niceScale(min: number, max: number, ticks = 4): { lo: number; hi: number; ticks: number[] } {
  const low = Math.min(min, 0);
  const high = Math.max(max, 0);
  const span = high - low || 1;
  const raw = span / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const lo = Math.floor(low / step + 1e-9) * step || 0;
  let hi = Math.ceil(high / step - 1e-9) * step || 0;
  if (hi <= lo) hi = lo + step; // tudo zero: eixo com altura, para a escala nunca dividir por zero
  const out: number[] = [];
  for (let value = lo; value <= hi + step / 2; value += step) out.push(Math.round(value * 1e6) / 1e6);
  return { lo, hi, ticks: out };
}

export function cumulative(values: number[]): number[] {
  let sum = 0;
  return values.map((value) => (sum += value));
}

export const revenueOf = (point: HourlyPoint, mode: RevenueMode) => (mode === "net" ? point.netRevenue : point.grossRevenue);
export const profitOf = (point: HourlyPoint, mode: RevenueMode) => (mode === "net" ? point.profitNet : point.profitGross);

export const hasHourlySpend = (points: HourlyPoint[]) => points.some((point) => point.investment != null);

export function hourlyTotals(points: HourlyPoint[], mode: RevenueMode) {
  const withSpend = hasHourlySpend(points);
  const revenue = points.reduce((sum, point) => sum + revenueOf(point, mode), 0);
  const investment = withSpend ? points.reduce((sum, point) => sum + (point.investment ?? 0), 0) : null;
  return { revenue, investment, profit: investment == null ? null : revenue - investment, sales: points.reduce((sum, point) => sum + point.sales, 0) };
}

export const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
