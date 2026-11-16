// Gasto por hora ESTIMADO para o dia corrente. A Meta só libera o detalhamento por hora (hourly_stats_*) depois que o dia
// da conta termina: durante o dia ela devolve vazio e o gráfico "Lucro por horário" ficava sem gasto. Aqui o gasto diário
// já sincronizado vira horas: a diferença entre o gasto do dia e o que já foi lançado em horas é espalhada, por igual,
// nas horas desde o último lançamento até a hora atual. Quando a Meta libera as horas reais, elas substituem a estimativa.
// Função pura (testável).

export type HourKey = { date: string; hour: number };
export type DailyAdset = { adset_id: string; campaign_id: string; campaign_name: string | null; spend: number; clicks: number; impressions: number; currency: string | null };
export type HourRow = HourKey & { adset_id: string; spend: number; clicks: number; impressions: number; imported_at?: string | null };
export type EstimatedRow = HourKey & { account_id: string; adset_id: string; campaign_id: string; campaign_name: string | null; spend: number; clicks: number; impressions: number; currency: string | null };

const key = (k: HourKey) => `${k.date}|${k.hour}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Divide `total` em `n` partes que somam exatamente `total` (dinheiro em centavos ou inteiros). */
function split(total: number, n: number, cents: boolean): number[] {
  const unit = cents ? 100 : 1;
  const whole = Math.round(total * unit);
  const base = Math.floor(whole / n);
  const out = Array.from({ length: n }, () => base);
  out[n - 1] += whole - base * n;
  return out.map((v) => v / unit);
}

/**
 * @param hours  as horas (fuso do workspace) do dia da conta, do início do dia até a hora ATUAL inclusive, em ordem.
 * @param daily  gasto do dia da conta, por conjunto.
 * @param existing  linhas já gravadas nessas horas (estimadas antes ou reais), por conjunto.
 * @param lastFill  por conjunto, a hora (índice em `hours`) do último lançamento; ausente = nunca lançado hoje.
 */
export function estimateHourlyFill(accountId: string, hours: HourKey[], daily: DailyAdset[], existing: HourRow[], lastFill: Map<string, number>): EstimatedRow[] {
  if (!hours.length) return [];
  const pos = new Map(hours.map((h, i) => [key(h), i]));
  const out: EstimatedRow[] = [];
  for (const d of daily) {
    const mine = existing.filter((r) => r.adset_id === d.adset_id && pos.has(key(r)));
    const sum = (f: "spend" | "clicks" | "impressions") => mine.reduce((a, r) => a + Number(r[f] ?? 0), 0);
    const dSpend = round2(d.spend - sum("spend"));
    const dClicks = Math.max(0, Math.round(d.clicks - sum("clicks")));
    const dImpr = Math.max(0, Math.round(d.impressions - sum("impressions")));
    if (dSpend < 0.01 && !dClicks && !dImpr) continue;
    const from = Math.min(hours.length - 1, (lastFill.get(d.adset_id) ?? -1) + 1);
    const span = hours.slice(from);
    const s = split(Math.max(0, dSpend), span.length, true);
    const c = split(dClicks, span.length, false);
    const im = split(dImpr, span.length, false);
    span.forEach((h, i) => {
      const prev = mine.find((r) => r.date === h.date && r.hour === h.hour);
      out.push({
        date: h.date, hour: h.hour, account_id: accountId, adset_id: d.adset_id, campaign_id: d.campaign_id, campaign_name: d.campaign_name, currency: d.currency,
        spend: round2(Number(prev?.spend ?? 0) + s[i]),
        clicks: Number(prev?.clicks ?? 0) + c[i],
        impressions: Number(prev?.impressions ?? 0) + im[i],
      });
    });
  }
  return out;
}
