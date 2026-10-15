import type { ConversionFunnel as FunnelData } from "@/lib/core/summary";
import { funnelPath, funnelRatios } from "@/lib/core/funnel-shape";
import { formatNumber, formatPct } from "@/lib/core/money";

// Cores da faixa (azul → magenta), em degradê contínuo da esquerda para a direita.
const COLORS = ["#0874f9", "#3157d5", "#6b46c1", "#a33b9d", "#cf347d"];
const W = 1000;
const H = 250;

export function ConversionFunnel({ data }: { data: FunnelData }) {
  const n = data.stages.length;
  const ratios = funnelRatios(data.stages);
  const hasData = data.stages.some((stage) => stage.fromStart != null);
  const stops = COLORS.map((color, i) => <stop key={color} offset={`${(i / (COLORS.length - 1)) * 100}%`} stopColor={color} />);
  return (
    <section className="rounded-md border border-[#384662] bg-[#27334d] shadow-[0_8px_24px_rgba(4,9,20,0.1)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a4762] px-4 py-3">
        <div><h2 className="text-sm font-semibold text-[#e2e7ef]">Funil de Conversão (Meta Ads)</h2><p className="mt-0.5 text-xs text-[#8f9bb1]">Percentual sobre cliques e conversão entre etapas</p></div>
        {data.state === "partial" && <span className="rounded bg-amber-400/10 px-2 py-1 text-xs text-amber-200 ring-1 ring-amber-400/25">Dados parciais</span>}
      </header>
      <div className="overflow-x-auto p-4">
        <div className="relative min-w-[760px]">
          {/* divisórias verticais entre as etapas, de ponta a ponta */}
          <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden>
            {data.stages.map((stage, index) => <div key={stage.key} className={index > 0 ? "border-l border-[#7c6fe0]/40" : ""} />)}
          </div>
          <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {data.stages.map((stage) => (
              <div key={`t-${stage.key}`} className="px-2 pb-3 text-center text-sm font-semibold text-[#dce2ec]">{stage.label}</div>
            ))}
          </div>
          <div className="relative" style={{ height: H }}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label="Funil de conversão" style={{ opacity: hasData ? 1 : 0.45 }}>
              <defs><linearGradient id="funnel-flow" x1="0" x2="1" y1="0" y2="0">{stops}</linearGradient></defs>
              <path d={funnelPath(ratios, W, H)} fill="url(#funnel-flow)" />
            </svg>
            <div className="absolute inset-0 grid items-center" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {data.stages.map((stage) => (
                <div key={`p-${stage.key}`} className="text-center text-lg font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.45)]">
                  {stage.fromStart == null ? "N/D" : formatPct(stage.fromStart, 1)}
                </div>
              ))}
            </div>
          </div>
          <div className="relative grid pt-3" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
            {data.stages.map((stage, index) => (
              <div key={`v-${stage.key}`} className="px-2 text-center">
                <div className="text-sm font-semibold text-[#dce2ec]">{stage.value == null ? "N/D" : formatNumber(stage.value)}</div>
                <div className="mt-0.5 h-4 text-[11px] text-[#9aa6bb]">{index === 0 ? "Base do funil" : stage.fromPrevious == null ? "conversão N/D" : `${formatPct(stage.fromPrevious, 1)} da etapa anterior`}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {data.note && <p className="border-t border-[#3a4762] bg-amber-400/5 px-4 py-2 text-xs text-amber-200">⚠ {data.note}</p>}
    </section>
  );
}
