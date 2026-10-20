import type { Filters } from "@/lib/queries";
import { PeriodControl } from "./period-control";
import { inputCls } from "./ui";

type Opt = { id: string; name: string };
export const STATUS_OPTIONS: [string, string][] = [["paid", "Pago"], ["pending", "Aguardando"], ["refunded", "Reembolsado"], ["chargedback", "Chargeback"], ["refund_requested", "Reembolso solicitado"], ["refused", "Recusado"], ["canceled", "Cancelado"], ["disputed", "Em disputa"]];

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="min-w-36 flex-1 text-[11px] font-medium text-copy">{label}{children}</label>;
}

export function FilterBar({ f, offers, accounts, catalog, hideOffer, extra, action }: {
  f: Filters;
  offers?: Opt[];
  accounts?: { account_id: string; account_name: string | null }[];
  catalog?: { campaigns: Opt[]; adsets: Opt[]; ads: Opt[] };
  hideOffer?: boolean;
  extra?: React.ReactNode;
  action?: string;
}) {
  const select = (name: string, value: string | null, options: Opt[], all: string) => <select name={name} defaultValue={value ?? ""} className={`${inputCls} mt-1 block w-full min-w-36`}><option value="">{all}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>;
  return (
    <form method="get" action={action} className="mb-4 rounded-md bg-surface p-5">
      <div className="flex flex-wrap items-end gap-2">
        <PeriodControl
          preset={f.preset}
          from={f.from}
          to={f.to}
          labelClassName="min-w-36 flex-1 text-[11px] font-medium text-copy"
          selectClassName={`${inputCls} mt-1 block w-full`}
          inputClassName={`${inputCls} mt-1 block w-full`}
        />
        {!hideOffer && offers && <Control label="Oferta">{select("offer", f.offer, offers, "Todas as ofertas")}</Control>}
        {accounts && <Control label="Conta de anúncio">{select("account", f.account, accounts.map((account) => ({ id: account.account_id, name: account.account_name ?? account.account_id })), "Qualquer")}</Control>}
        <Control label="Fonte de tráfego"><input name="source" defaultValue={f.source ?? ""} placeholder="Qualquer" className={`${inputCls} mt-1 block w-full`} /></Control>
        <Control label="Plataforma"><select disabled className={`${inputCls} mt-1 block w-full text-copy-muted`}><option>Meta Ads</option></select></Control>
        {hideOffer && <Control label="Produto"><select disabled className={`${inputCls} mt-1 block w-full text-copy-muted`}><option>Oferta selecionada</option></select></Control>}
        <button className="h-[34px] rounded bg-primary px-4 text-sm font-semibold text-white hover:bg-[var(--primary-hover)]">Filtrar</button>
      </div>
      <details className="mt-3 border-t border-divider pt-2">
        <summary className="flex cursor-pointer items-center justify-end gap-1 text-right text-xs font-medium text-copy"><span>Mais filtros</span><svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.75]"><path d="m4 6 4 4 4-4" /></svg></summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {catalog && <Control label="Campanha">{select("campaign", f.campaign, catalog.campaigns, "Qualquer")}</Control>}
          {catalog && <Control label="Conjunto">{select("adset", f.adset, catalog.adsets, "Qualquer")}</Control>}
          {catalog && <Control label="Anúncio">{select("ad", f.ad, catalog.ads, "Qualquer")}</Control>}
          <Control label="Status do pedido">{select("status", f.status, STATUS_OPTIONS.map(([id, name]) => ({ id, name })), "Qualquer")}</Control>
          {extra}
        </div>
      </details>
    </form>
  );
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  if (!ok && !error) return null;
  return <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${error ? "border-rose-400/30 bg-rose-400/10 text-rose-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"}`}>{error ?? ok}</div>;
}
