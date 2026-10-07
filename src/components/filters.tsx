import type { Filters } from "@/lib/queries";
import { inputCls } from "./ui";

type Opt = { id: string; name: string };

const PRESETS: [string, string][] = [
  ["today", "Hoje"],
  ["yesterday", "Ontem"],
  ["7d", "7 dias"],
  ["14d", "14 dias"],
  ["30d", "30 dias"],
  ["month", "Este mês"],
];

export const STATUS_OPTIONS: [string, string][] = [
  ["paid", "Pago"],
  ["pending", "Aguardando"],
  ["refunded", "Reembolsado"],
  ["chargedback", "Chargeback"],
  ["refund_requested", "Reembolso solicitado"],
  ["refused", "Recusado"],
  ["canceled", "Cancelado"],
  ["disputed", "Em disputa"],
];

/** Barra de filtros (GET). Mudar qualquer filtro recarrega a página no servidor. */
export function FilterBar({
  f,
  offers,
  accounts,
  catalog,
  hideOffer,
  extra,
  action,
}: {
  f: Filters;
  offers?: Opt[];
  accounts?: { account_id: string; account_name: string | null }[];
  catalog?: { campaigns: Opt[]; adsets: Opt[]; ads: Opt[] };
  hideOffer?: boolean;
  extra?: React.ReactNode;
  action?: string;
}) {
  const sel = (name: string, value: string | null, opts: Opt[], all: string) => (
    <select name={name} defaultValue={value ?? ""} className={`${inputCls} max-w-52`}>
      <option value="">{all}</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <select name="preset" defaultValue={f.preset === "custom" ? "" : f.preset} className={inputCls}>
        {f.preset === "custom" && <option value="">Personalizado</option>}
        {PRESETS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <input type="date" name="from" defaultValue={f.preset === "custom" ? f.from : ""} className={inputCls} aria-label="De" />
      <input type="date" name="to" defaultValue={f.preset === "custom" ? f.to : ""} className={inputCls} aria-label="Até" />
      {!hideOffer && offers && sel("offer", f.offer, offers, "Todas as ofertas")}
      {accounts && sel("account", f.account, accounts.map((a) => ({ id: a.account_id, name: a.account_name ?? a.account_id })), "Todas as contas")}
      <input name="source" defaultValue={f.source ?? ""} placeholder="source" className={`${inputCls} w-24`} />
      {catalog && sel("campaign", f.campaign, catalog.campaigns, "Campanha")}
      {catalog && sel("adset", f.adset, catalog.adsets, "Conjunto")}
      {catalog && sel("ad", f.ad, catalog.ads, "Anúncio")}
      {sel("status", f.status, STATUS_OPTIONS.map(([id, name]) => ({ id, name })), "Status do pedido")}
      {extra}
      <button className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Filtrar</button>
    </form>
  );
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const err = typeof sp.error === "string" ? sp.error : null;
  if (!ok && !err) return null;
  return (
    <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${err ? "border-rose-200 bg-rose-50 text-rose-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
      {err ?? ok}
    </div>
  );
}
