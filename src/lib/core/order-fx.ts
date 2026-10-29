// Converte pedidos em outra moeda (ex.: USD) para a moeda do workspace (BRL), com a mesma regra de
// utmfy.fx_for usada no SQL: cotação PTAX do dia do pagamento (ou do último dia útil, até 7 dias antes).
// Sem cotação, o pedido fica de fora da soma (igual ao relatório principal).

export type FxRate = { currency: string; date: string; rate: number };

export type ConvertibleOrder = {
  currency?: string | null;
  gross_amount: number | string | null;
  base_amount: number | string | null;
  paid_at: string | null;
  provider_created_at: string | null;
};

const dayIn = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Fator para converter `currency` em `target` na data (YYYY-MM-DD); 1 = mesma moeda; null = sem cotação. */
export function fxFactor(currency: string | null | undefined, date: string, target: string, rates: FxRate[]): number | null {
  if (!currency || currency === target) return 1;
  if (target !== "BRL") return null;
  const min = shift(date, -7);
  let best: FxRate | null = null;
  for (const r of rates) {
    if (r.currency !== currency || r.date > date || r.date < min || !(r.rate > 0)) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best ? best.rate : null;
}

/** Devolve os pedidos com gross/base já na moeda alvo; descarta os sem cotação. */
export function convertOrders<T extends ConvertibleOrder>(orders: T[], target: string, rates: FxRate[], tz: string): T[] {
  const out: T[] = [];
  for (const o of orders) {
    const stamp = o.paid_at ?? o.provider_created_at;
    const f = fxFactor(o.currency, stamp ? dayIn(stamp, tz) : "9999-12-31", target, rates);
    if (f == null) continue;
    if (f === 1) { out.push(o); continue; }
    const conv = (v: number | string | null) => (v == null ? null : Math.round(Number(v) * f * 100) / 100);
    out.push({ ...o, gross_amount: conv(o.gross_amount), base_amount: conv(o.base_amount) });
  }
  return out;
}
