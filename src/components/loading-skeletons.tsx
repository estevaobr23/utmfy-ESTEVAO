function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-[#34415e] ${className}`} />;
}

export function OfferHeaderSkeleton() {
  return (
    <div className="mb-5 rounded-md border border-[#34415d] bg-[#27334d] px-5 py-4" aria-hidden="true">
      <div className="flex items-center gap-3"><Pulse className="h-3 w-20" /><Pulse className="h-5 w-60 max-w-[55vw]" /><Pulse className="h-5 w-14" /></div>
      <div className="mt-3 flex gap-6"><Pulse className="h-3 w-44" /><Pulse className="h-3 w-40" /></div>
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Carregando resumo da oferta" className="space-y-4">
      <span className="sr-only">Carregando resumo da oferta…</span>
      <div className="rounded-md border border-[#384662] bg-[#27334d] p-4"><div className="flex flex-wrap gap-3"><Pulse className="h-9 min-w-40 flex-1" /><Pulse className="h-9 min-w-40 flex-1" /><Pulse className="h-9 min-w-40 flex-1" /><Pulse className="h-9 w-24" /></div></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="rounded-md border border-[#384662] bg-[#27334d] p-4"><Pulse className="h-3 w-28" /><Pulse className="mt-3 h-7 w-36" /></div>)}</div>
      <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="rounded-md border border-[#384662] bg-[#27334d] p-4"><Pulse className="h-4 w-44" /><Pulse className="mt-5 h-44 w-full" /></div>)}</div>
    </div>
  );
}

export function MetaAdsSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Carregando Meta Ads" className="space-y-3">
      <span className="sr-only">Carregando Meta Ads…</span>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Pulse key={index} className="h-12" />)}</div>
      <div className="rounded-md border border-[#384662] bg-[#27334d] p-4"><div className="flex flex-wrap gap-3"><Pulse className="h-9 min-w-40 flex-1" /><Pulse className="h-9 min-w-40 flex-1" /><Pulse className="h-9 min-w-40 flex-1" /><Pulse className="h-9 w-24" /></div></div>
      <div className="overflow-hidden rounded-md border border-[#384662] bg-[#27334d]">{Array.from({ length: 8 }, (_, index) => <div key={index} className="flex gap-3 border-b border-[#394761] p-3"><Pulse className="h-4 w-8" /><Pulse className="h-4 flex-[2]" /><Pulse className="h-4 flex-1" /><Pulse className="h-4 flex-1" /><Pulse className="h-4 flex-1" /></div>)}</div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Carregando página" className="space-y-4">
      <span className="sr-only">Carregando página…</span>
      <Pulse className="h-7 w-56" />
      <div className="rounded-md border border-[#384662] bg-[#27334d] p-4"><Pulse className="h-5 w-48" /><Pulse className="mt-4 h-28 w-full" /></div>
    </div>
  );
}
