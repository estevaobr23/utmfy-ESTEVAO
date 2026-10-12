import type { ConversionFunnel as FunnelData } from "@/lib/core/summary";
import { formatNumber, formatPct } from "@/lib/core/money";

const COLORS = ["#0874f9", "#3157d5", "#6b46c1", "#a33b9d", "#cf347d"];

export function ConversionFunnel({ data }: { data: FunnelData }) {
  return (
    <section className="rounded-md border border-[#384662] bg-[#27334d] shadow-[0_8px_24px_rgba(4,9,20,0.1)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#3a4762] px-4 py-3">
        <div><h2 className="text-sm font-semibold text-[#e2e7ef]">Funil de Conversão (Meta Ads)</h2><p className="mt-0.5 text-xs text-[#8f9bb1]">Percentual sobre cliques e conversão entre etapas</p></div>
        {data.state === "partial" && <span className="rounded bg-amber-400/10 px-2 py-1 text-xs text-amber-200 ring-1 ring-amber-400/25">Dados parciais</span>}
      </header>
      <div className="overflow-x-auto p-4">
        <div className="grid min-w-[760px] grid-cols-5">
          {data.stages.map((stage, index) => {
            const height = stage.fromStart == null ? 18 : Math.max(18, Math.round(stage.fromStart * 112));
            return (
              <div key={stage.key} className="relative flex min-h-52 flex-col items-center border-r border-[#4a5872] last:border-r-0">
                <div className="text-center"><div className="text-sm font-semibold text-[#dce2ec]">{stage.label}</div><div className="mt-1 text-xs text-[#8f9bb1]">{stage.value == null ? "N/D" : formatNumber(stage.value)}</div></div>
                <div className="flex flex-1 items-center self-stretch px-0">
                  <div className="flex w-full items-center justify-center text-sm font-bold text-white transition-[height]" style={{ height, background: stage.value == null ? "#3a465d" : COLORS[index], opacity: stage.value == null ? 0.55 : 1 }}>
                    {stage.fromStart == null ? "N/D" : formatPct(stage.fromStart, 1)}
                  </div>
                </div>
                <div className="h-8 text-center text-[11px] text-[#9aa6bb]">{index === 0 ? "Base do funil" : stage.fromPrevious == null ? "conversão N/D" : `${formatPct(stage.fromPrevious, 1)} da etapa anterior`}</div>
              </div>
            );
          })}
        </div>
      </div>
      {data.note && <p className="border-t border-[#3a4762] bg-amber-400/5 px-4 py-2 text-xs text-amber-200">⚠ {data.note}</p>}
    </section>
  );
}
