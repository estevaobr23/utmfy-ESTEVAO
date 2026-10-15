// Forma do funil de conversão: uma faixa contínua cuja espessura em cada etapa é
// proporcional ao % sobre a primeira etapa, ligada por curvas suaves. Função pura.

/** Espessura relativa (0..1) de cada etapa. Sem dado (null) ou valor minúsculo usa `min`, para a faixa nunca sumir nem quebrar. */
export function funnelRatios(stages: { fromStart: number | null }[], min = 0.06): number[] {
  return stages.map((s) => (s.fromStart == null || !Number.isFinite(s.fromStart) ? min : Math.min(1, Math.max(min, s.fromStart))));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Caminho SVG fechado da faixa, centrada na vertical. Cada etapa ocupa 1/n da largura e mantém a
 * espessura no centro da sua coluna; entre colunas a borda faz uma curva em S (bezier), sem degraus.
 */
export function funnelPath(ratios: number[], width: number, height: number): string {
  const n = ratios.length;
  if (!n) return "";
  const cy = height / 2;
  const xs = ratios.map((_, i) => (width * (i + 0.5)) / n);
  const half = ratios.map((r) => (r * height) / 2);
  const edge = (sign: 1 | -1, order: number[]) => {
    const pts = order.map((i) => ({ x: xs[i], y: cy + sign * half[i] }));
    let d = "";
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const mid = (a.x + b.x) / 2;
      d += ` C ${r2(mid)} ${r2(a.y)} ${r2(mid)} ${r2(b.y)} ${r2(b.x)} ${r2(b.y)}`;
    }
    return d;
  };
  const idx = ratios.map((_, i) => i);
  const rev = [...idx].reverse();
  const top = `M 0 ${r2(cy - half[0])} L ${r2(xs[0])} ${r2(cy - half[0])}${edge(-1, idx)} L ${r2(width)} ${r2(cy - half[n - 1])}`;
  const bottom = ` L ${r2(width)} ${r2(cy + half[n - 1])} L ${r2(xs[n - 1])} ${r2(cy + half[n - 1])}${edge(1, rev)} L 0 ${r2(cy + half[0])} Z`;
  return top + bottom;
}
