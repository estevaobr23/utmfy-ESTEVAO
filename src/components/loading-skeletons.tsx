function Pulse({ className }: { className: string }) {
  return <div className={`skeleton-shimmer rounded ${className}`} />;
}

function KpiSkeleton() {
  return <div className="min-h-[100px] rounded-md bg-surface p-5"><Pulse className="h-3 w-28" /><Pulse className="mt-3 h-6 w-36" /><Pulse className="mt-2 h-2.5 w-24" /></div>;
}

export function OfferHeaderSkeleton() {
  return (
    <div className="mb-[26px] min-h-[57px] rounded-md bg-surface px-5 py-3" aria-hidden="true">
      <div className="flex items-center gap-3"><Pulse className="h-3 w-20" /><Pulse className="h-5 w-60 max-w-[55vw]" /><Pulse className="h-5 w-14" /></div>
      <div className="mt-2 flex gap-6"><Pulse className="h-3 w-44" /><Pulse className="h-3 w-40" /></div>
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Carregando resumo da oferta" className="space-y-[19px]">
      <span className="sr-only">Carregando resumo da oferta…</span>
      <div className="min-h-[158px] rounded-md bg-surface p-5"><div className="flex items-center justify-between border-b border-divider pb-4"><Pulse className="h-5 w-28" /><Pulse className="h-[34px] w-[126px]" /></div><div className="mt-4 flex flex-wrap gap-3"><Pulse className="h-[34px] min-w-40 flex-1" /><Pulse className="h-[34px] min-w-40 flex-1" /><Pulse className="h-[34px] min-w-40 flex-1" /><Pulse className="h-[34px] w-24" /></div></div>
      <div className="kpi-grid">{Array.from({ length: 11 }, (_, index) => index === 8 ? <div key={index} className="xl:col-start-2"><KpiSkeleton /></div> : <KpiSkeleton key={index} />)}</div>
      <div className="h-[395px] rounded-md bg-surface p-5"><Pulse className="h-4 w-56" /><Pulse className="mt-5 h-[310px] w-full" /></div>
      <div className="grid gap-[19px] xl:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="rounded-md bg-surface p-5"><Pulse className="h-4 w-44" /><Pulse className="mt-5 h-44 w-full" /></div>)}</div>
    </div>
  );
}

export function MetaAdsSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Carregando Meta Ads" className="space-y-[19px]">
      <span className="sr-only">Carregando Meta Ads…</span>
      <div className="grid grid-cols-2 gap-[19px] lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Pulse key={index} className="h-[85px]" />)}</div>
      <div className="rounded-md bg-surface p-5"><div className="flex flex-wrap gap-3"><Pulse className="h-[34px] min-w-40 flex-1" /><Pulse className="h-[34px] min-w-40 flex-1" /><Pulse className="h-[34px] min-w-40 flex-1" /><Pulse className="h-[34px] w-24" /></div></div>
      <div className="overflow-hidden rounded-md bg-surface">{Array.from({ length: 8 }, (_, index) => <div key={index} className="flex min-h-11 gap-3 border-b border-divider p-3"><Pulse className="h-4 w-8" /><Pulse className="h-4 flex-[2]" /><Pulse className="h-4 flex-1" /><Pulse className="h-4 flex-1" /><Pulse className="h-4 flex-1" /></div>)}</div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Carregando página" className="space-y-4">
      <span className="sr-only">Carregando página…</span>
      <Pulse className="h-7 w-56" />
      <div className="rounded-md bg-surface p-5"><Pulse className="h-5 w-48" /><Pulse className="mt-4 h-28 w-full" /></div>
    </div>
  );
}
