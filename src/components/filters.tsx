import type { Filters } from "@/lib/queries";
import { inputCls } from "./ui";

type Opt = { id: string; name: string };
const PRESETS: [string, string][] = [["today", "Hoje"], ["yesterday", "Ontem"], ["7d", "Últimos 7 dias"], ["14d", "Últimos 14 dias"], ["30d", "Últimos 30 dias"], ["month", "Este mês"], ["last_month", "Mês passado"]];
export const STATUS_OPTIONS: [string, string][] = [["paid", "Pago"], ["pending", "Aguardando"], ["refunded", "Reembolsado"], ["chargedback", "Chargeback"], ["refund_requested", "Reembolso solicitado"], ["refused", "Recusado"], ["canceled", "Cancelado"], ["disputed", "Em disputa"]];

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="min-w-36 flex-1 text-[10px] font-medium uppercase tracking-wide text-[#9aa6bb]">{label}{children}</label>;
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
    <form method="get" action={action} className="mb-4 rounded-md border border-[#384662] bg-[#27334d] p-4 shadow-[0_8px_24px_rgba(4,9,20,0.08)]">
      <div className="flex flex-wrap items-end gap-2">
        <Control label="Período de visualização"><select name="preset" defaultValue={f.preset === "custom" ? "" : f.preset} className={`${inputCls} mt-1 block w-full`}>{f.preset === "custom" && <option value="">Personalizado</option>}{PRESETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Control>
        {!hideOffer && offers && <Control label="Oferta">{select("offer", f.offer, offers, "Todas as ofertas")}</Control>}
        {accounts && <Control label="Conta de anúncio">{select("account", f.account, accounts.map((account) => ({ id: account.account_id, name: account.account_name ?? account.account_id })), "Qualquer")}</Control>}
        <Control label="Fonte de tráfego"><input name="source" defaultValue={f.source ?? ""} placeholder="Qualquer" className={`${inputCls} mt-1 block w-full`} /></Control>
        <Control label="Plataforma"><select disabled className={`${inputCls} mt-1 block w-full text-[#9aa6bb]`}><option>Meta Ads</option></select></Control>
        {hideOffer && <Control label="Produto"><select disabled className={`${inputCls} mt-1 block w-full text-[#9aa6bb]`}><option>Oferta selecionada</option></select></Control>}
        <button className="rounded-md bg-[#0874f9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0865d8]">Filtrar</button>
      </div>
      <details className="mt-3 border-t border-[#394761] pt-2">
        <summary className="cursor-pointer text-right text-xs font-medium text-[#aab4c6]">Mais filtros</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Control label="Data inicial"><input type="date" name="from" defaultValue={f.preset === "custom" ? f.from : ""} className={`${inputCls} mt-1 block w-full`} /></Control>
          <Control label="Data final"><input type="date" name="to" defaultValue={f.preset === "custom" ? f.to : ""} className={`${inputCls} mt-1 block w-full`} /></Control>
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
