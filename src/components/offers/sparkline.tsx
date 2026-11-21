/** Mini gráfico de lucro por dia: barra verde acima de zero, vermelha abaixo. SVG próprio (sem biblioteca). */
export function ProfitSparkline({ points, currencyFormat }: { points: { day: string; profit: number }[]; currencyFormat: (v: number) => string }) {
  if (points.length < 2) return null;
  const W = 240;
  const H = 40;
  const max = Math.max(...points.map((p) => Math.abs(p.profit)), 1);
  const hasNeg = points.some((p) => p.profit < 0);
  const hasPos = points.some((p) => p.profit > 0);
  // Linha do zero: no meio se há dias positivos e negativos; senão encostada na borda.
  const zero = hasNeg && hasPos ? H / 2 : hasNeg ? 2 : H - 2;
  const span = hasNeg && hasPos ? H / 2 - 2 : H - 4;
  const step = W / points.length;
  const bar = Math.max(1, step * 0.7);
  const best = points.reduce((a, b) => (b.profit > a.profit ? b : a));
  const worst = points.reduce((a, b) => (b.profit < a.profit ? b : a));
  const label = `Lucro por dia: melhor ${best.day.slice(8)}/${best.day.slice(5, 7)} (${currencyFormat(best.profit)}), pior ${worst.day.slice(8)}/${worst.day.slice(5, 7)} (${currencyFormat(worst.profit)})`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 h-10 w-full" role="img" aria-label={label}>
      <line x1={0} x2={W} y1={zero} y2={zero} stroke="var(--divider)" strokeWidth={1} />
      {points.map((p, i) => {
        const h = Math.max(p.profit === 0 ? 0 : 1.5, (Math.abs(p.profit) / max) * span);
        const y = p.profit >= 0 ? zero - h : zero;
        return (
          <rect key={p.day} x={i * step + (step - bar) / 2} y={y} width={bar} height={h} rx={1} fill={p.profit >= 0 ? "var(--success)" : "var(--danger)"}>
            <title>{`${p.day.slice(8)}/${p.day.slice(5, 7)}: ${currencyFormat(p.profit)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
