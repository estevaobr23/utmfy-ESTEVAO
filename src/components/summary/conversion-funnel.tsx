import type { ConversionFunnel as FunnelData } from "@/lib/core/summary";
import { funnelPath, funnelRatios } from "@/lib/core/funnel-shape";
import { formatNumber, formatPct } from "@/lib/core/money";

// Cores e posições medidas na referência, em degradê contínuo da esquerda para a direita.
const COLORS = [
  [0, "#0259e2"],
  [14, "#1953d3"],
  [33, "#3d4bbe"],
  [52, "#6142a9"],
  [65, "#5e387f"],
  [77, "#6e3576"],
  [100, "#8a2d65"],
] as const;
const W = 1000;
const H = 248;

export function ConversionFunnel({ data }: { data: FunnelData }) {
  const n = data.stages.length;
  const ratios = funnelRatios(data.stages);
  const hasData = data.stages.some((stage) => stage.fromStart != null);
  const stops = COLORS.map(([offset, color]) => <stop key={color} offset={`${offset}%`} stopColor={color} />);
  return (
    <section className="overflow-hidden rounded-md bg-surface">
      <header className="flex min-h-[49px] flex-wrap items-center justify-between gap-2 border-b border-divider px-5 py-2">
        <div><h2 className="text-[15.5px] font-semibold text-copy-strong">Funil de Conversão (Meta Ads)</h2><p className="mt-0.5 text-xs text-copy-muted">Percentual sobre cliques e conversão entre etapas</p></div>
        <div className="flex items-center gap-2">
          {data.state === "partial" && <span className="rounded bg-amber-400/10 px-2 py-1 text-xs text-amber-200 ring-1 ring-amber-400/25">Dados parciais</span>}
          <span className="grid h-[13px] w-[13px] place-items-center rounded-full border border-copy text-[9px] leading-none text-copy" aria-label="Informações do funil">i</span>
        </div>
      </header>
      <div className="overflow-x-auto px-5 py-2">
        <div className="relative min-w-[760px]">
          <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden>
            {data.stages.map((stage, index) => <div key={stage.key} className={index > 0 ? "border-l border-[#9896dc]" : ""} />)}
          </div>
          <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {data.stages.map((stage) => (
              <div key={`t-${stage.key}`} className="px-2 pb-1.5 text-center text-[15px] font-bold text-white">{stage.label}</div>
            ))}
          </div>
          <div className="relative" style={{ height: H }}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="funnel-reveal absolute inset-0 h-full w-full" role="img" aria-label="Funil de conversão" style={{ opacity: hasData ? 1 : 0.45 }}>
              <defs><linearGradient id="funnel-flow" x1="0" x2="1" y1="0" y2="0">{stops}</linearGradient></defs>
              <path d={funnelPath(ratios, W, H)} fill="url(#funnel-flow)" />
            </svg>
            <div className="funnel-percentages absolute inset-0 grid items-center" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {data.stages.map((stage) => (
                <div key={`p-${stage.key}`} className="text-center text-[18px] font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.35)]">
                  {stage.fromStart == null ? "N/D" : formatPct(stage.fromStart, 1)}
                </div>
              ))}
            </div>
          </div>
          <div className="relative grid pt-1.5" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {data.stages.map((stage, index) => (
              <div key={`v-${stage.key}`} className="px-2 text-center">
                <div className="text-sm font-semibold text-white">{stage.value == null ? "N/D" : formatNumber(stage.value)}</div>
                <div className="mt-0.5 h-4 text-[11px] text-copy-muted">{index === 0 ? "Base do funil" : stage.fromPrevious == null ? "conversão N/D" : `${formatPct(stage.fromPrevious, 1)} da etapa anterior`}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {data.note && <p className="border-t border-divider bg-amber-400/5 px-5 py-1.5 text-xs text-amber-200">⚠ {data.note}</p>}
    </section>
  );
}
