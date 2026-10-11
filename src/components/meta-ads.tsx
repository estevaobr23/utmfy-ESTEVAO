import Link from "next/link";
import { syncMetaNow } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { timeAgo } from "@/lib/core/dates";
import { aggregateLevel, LEVELS, type Level, type LevelRow } from "@/lib/core/meta-levels";
import type { Derived } from "@/lib/core/metrics";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";
import { listAccounts, loadReport, parseFilters } from "@/lib/queries";
import type { Workspace } from "@/lib/session";
import type { Db } from "@/lib/supabase/types";

const PRESETS: [string, string][] = [["today", "Hoje"], ["yesterday", "Ontem"], ["7d", "7 dias"], ["14d", "14 dias"], ["30d", "30 dias"], ["month", "Este mês"]];
const UNIT: Record<Level, [string, string]> = { contas: ["conta", "contas"], campanhas: ["campanha", "campanhas"], conjuntos: ["conjunto", "conjuntos"], anuncios: ["anúncio", "anúncios"] };
const LEVEL_ICON: Record<Level, string> = { contas: "▣", campanhas: "◫", conjuntos: "⊞", anuncios: "▯" };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const ID = /^[0-9]{1,30}$/;

/** Status do nível a partir dos anúncios: ativo se algum anúncio filho estiver ativo. */
function statusOf(level: Level, id: string, ads: { campaign_id: string; adset_id: string; ad_id: string; account_id: string; effective_status: string | null }[]) {
  const key = level === "contas" ? "account_id" : level === "campanhas" ? "campaign_id" : level === "conjuntos" ? "adset_id" : "ad_id";
  const st = ads.filter((a) => a[key] === id).map((a) => a.effective_status ?? "");
  if (!st.length) return null;
  return st.includes("ACTIVE") ? "ACTIVE" : st[0];
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-slate-500">—</span>;
  const on = status === "ACTIVE";
  return (
    <span title={`Meta: ${status} (somente leitura)`} className={`inline-flex h-5 w-9 items-center rounded-full px-0.5 ${on ? "justify-end bg-blue-600" : "justify-start bg-slate-600"}`}>
      <span className="h-4 w-4 rounded-full bg-white" />
    </span>
  );
}

export async function MetaAdsView({ sb, ws, sp, offerId, path, canWrite }: {
  sb: Db; ws: Workspace; sp: Record<string, string | string[] | undefined>; offerId?: string; path: string; canWrite: boolean;
}) {
  const level = (LEVELS.find(([k]) => k === one(sp.nivel))?.[0] ?? "campanhas") as Level;
  const campaign = ID.test(one(sp.campaign)) ? one(sp.campaign) : null;
  const adset = ID.test(one(sp.adset)) ? one(sp.adset) : null;
  const name = one(sp.q).slice(0, 80);
  const f = parseFilters({ ...sp, campaign: undefined, adset: undefined, ad: undefined }, ws.timezone, offerId);
  const [report, accounts, ads] = await Promise.all([
    loadReport(sb, ws, f),
    listAccounts(sb, ws.id),
    sb.from("meta_ads").select("account_id, campaign_id, adset_id, ad_id, effective_status").eq("workspace_id", ws.id).limit(5000),
  ]);
  const catalog = (ads.data ?? []) as { account_id: string; campaign_id: string; adset_id: string; ad_id: string; effective_status: string | null }[];
  const { rows, total } = aggregateLevel(level, report.spendRows, report.orderRows, { campaign, adset, name });
  const ok = report.spendStatus.reliable;
  const accountName = new Map(accounts.map((a) => [a.account_id, a.account_name ?? `act_${a.account_id}`]));
  const syncOf = new Map(accounts.map((a) => [a.account_id, a.last_sync_at as string | null]));
  const lastSync = accounts.map((a) => a.last_sync_at as string | null).filter(Boolean).sort().pop() ?? null;
  const parentCampaign = campaign ? aggregateLevel("campanhas", report.spendRows, report.orderRows, { campaign }).rows[0]?.name : null;
  const parentAdset = adset ? aggregateLevel("conjuntos", report.spendRows, report.orderRows, { adset }).rows[0]?.name : null;

  const link = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const base: Record<string, string | null> = {
      nivel: level, campaign, adset, q: name || null,
      preset: f.preset === "custom" ? null : f.preset, from: f.preset === "custom" ? f.from : null, to: f.preset === "custom" ? f.to : null,
      account: f.account,
    };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) q.set(k, v);
    return `${path}?${q.toString()}`;
  };
  const drill = (r: LevelRow) =>
    level === "contas" ? link({ nivel: "campanhas", account: r.id, campaign: null, adset: null })
    : level === "campanhas" ? link({ nivel: "conjuntos", campaign: r.id, adset: null })
    : level === "conjuntos" ? link({ nivel: "anuncios", campaign: r.campaignId, adset: r.id })
    : null;
  const manager = (r: LevelRow) => {
    const acc = r.accountId ?? f.account;
    if (!acc || r.id.startsWith("__")) return null;
    const tab = level === "campanhas" ? "campaigns" : level === "conjuntos" ? "adsets" : level === "anuncios" ? "ads" : "campaigns";
    const sel = level === "campanhas" ? `&selected_campaign_ids=${r.id}` : level === "conjuntos" ? `&selected_adset_ids=${r.id}` : level === "anuncios" ? `&selected_ad_ids=${r.id}` : "";
    return `https://adsmanager.facebook.com/adsmanager/manage/${tab}?act=${acc}${sel}`;
  };
  const money = (v: number | null) => formatMoney(v, ws.currency);
  const cells = (m: Derived) => [
    formatNumber(m.approved_count),
    ok ? money(m.cpa) : "—",
    money(m.spend),
    ok ? money(m.profit) : "—",
    money(m.net_revenue),
    ok && m.roas != null ? formatNumber(m.roas, 2) : "—",
    formatPct(m.ctr, 2),
    money(m.cpc),
  ];
  const profitCls = (m: Derived) => (!ok ? "text-slate-400" : m.profit > 0 ? "text-emerald-400" : m.profit < 0 ? "text-rose-400" : "text-slate-300");
  const COLS = ["Vendas", "CPA", "Gasto", "Lucro", "Faturamento", "ROAS", "CTR", "CPC"];
  const [u1, uN] = UNIT[level];

  return (
    <div className="overflow-hidden rounded-md border border-[#384662] bg-[#202b43] text-[#eef2f8] shadow-[0_14px_38px_rgba(4,9,20,0.18)]">
      <nav className="grid grid-cols-4 gap-3 bg-[#11192d]">
        {LEVELS.map(([k, label]) => (
          <Link
            key={k}
            href={link({ nivel: k, ...(k === "contas" || k === "campanhas" ? { campaign: null, adset: null } : k === "conjuntos" ? { adset: null } : {}) })}
            className={`rounded-t-md border border-b-0 px-5 py-4 text-left text-sm font-semibold transition ${k === level ? "border-[#3b4964] bg-[#27334d] text-[#1681ff] shadow-[inset_0_-2px_0_#0874f9]" : "border-[#303d57] bg-[#27334d]/75 text-[#b3bdcd] hover:bg-[#2d3a56]"}`}
          >
            <span className="mr-2 text-base" aria-hidden>{LEVEL_ICON[k]}</span>{label}
            {k === "conjuntos" && parentCampaign && level !== "campanhas" && <span className="ml-1 text-xs text-slate-400">de 1 campanha</span>}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-end gap-3 border-b border-[#394761] bg-[#27334d] px-4 py-4">
        <span className="mb-0.5 self-end rounded-full bg-[#19b972] px-2.5 py-1 text-[11px] font-semibold text-white">✓ Rastreio ativo</span>
        <form method="get" action={path} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="nivel" value={level} />
          {campaign && <input type="hidden" name="campaign" value={campaign} />}
          {adset && <input type="hidden" name="adset" value={adset} />}
          <label className="text-[11px] text-slate-400">
            Nome
            <input name="q" defaultValue={name} placeholder={`Filtrar ${uN}`} className="mt-0.5 block w-44 rounded border border-[#46546e] bg-[#27334d] px-3 py-2 text-sm text-[#eef2f8] outline-none placeholder:text-[#728097] focus:border-[#0874f9]" />
          </label>
          <label className="text-[11px] text-slate-400">
            Período
            <select name="preset" defaultValue={f.preset === "custom" ? "" : f.preset} className="mt-0.5 block rounded border border-[#46546e] bg-[#27334d] px-3 py-2 text-sm text-[#eef2f8] outline-none focus:border-[#0874f9]">
              {f.preset === "custom" && <option value="">{`${f.from} → ${f.to}`}</option>}
              {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-400">
            Conta de anúncio
            <select name="account" defaultValue={f.account ?? ""} className="mt-0.5 block max-w-52 rounded border border-[#46546e] bg-[#27334d] px-3 py-2 text-sm text-[#eef2f8] outline-none focus:border-[#0874f9]">
              <option value="">Qualquer</option>
              {accounts.map((a) => <option key={a.account_id} value={a.account_id}>{a.account_name ?? a.account_id}</option>)}
            </select>
          </label>
          <button className="rounded bg-[#0874f9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0865d8]">Filtrar</button>
        </form>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          <span>Atualizado {lastSync ? timeAgo(lastSync) : "— nunca sincronizado"}</span>
          {canWrite && (
            <form action={syncMetaNow}>
              <input type="hidden" name="back" value={link({})} />
              <SubmitButton pendingText="Atualizando...">Atualizar</SubmitButton>
            </form>
          )}
        </div>
      </div>

      {(campaign || adset || !ok) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#394761] bg-[#222e47] px-4 py-2 text-xs">
          {campaign && (
            <Link href={link({ nivel: "campanhas", campaign: null, adset: null })} className="rounded-full bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700">
              Campanha: {parentCampaign ?? campaign} ✕
            </Link>
          )}
          {adset && (
            <Link href={link({ nivel: "conjuntos", adset: null })} className="rounded-full bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700">
              Conjunto: {parentAdset ?? adset} ✕
            </Link>
          )}
          {!ok && <span className="text-amber-300">⚠ {report.spendStatus.message} Lucro, CPA e ROAS ocultos.</span>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-[13px]">
          <thead>
            <tr className="bg-[#35425f] text-[10px] uppercase tracking-wide text-[#d4dbe7]">
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">{u1 === "anúncio" ? "Anúncio" : u1[0].toUpperCase() + u1.slice(1)}</th>
              <th className="px-3 py-2 text-left font-semibold">Últ. atualização</th>
              {COLS.map((c) => <th key={c} className="px-3 py-2 text-right font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = drill(r);
              const mgr = manager(r);
              const label = level === "contas" ? accountName.get(r.id) ?? r.name : r.name;
              const synced = r.accountId ? syncOf.get(r.accountId) : null;
              return (
                <tr key={r.id} className="border-t border-[#394761] bg-[#27334d] hover:bg-[#2d3a56]">
                  <td className="px-3 py-2"><StatusPill status={statusOf(level, r.id, catalog)} /></td>
                  <td className="max-w-80 px-3 py-2">
                    <div className="flex items-center gap-2">
                      {href ? (
                        <Link href={href} title={`ID ${r.id}`} className="truncate font-medium text-slate-100 hover:text-blue-400">{label}</Link>
                      ) : (
                        <span title={`ID ${r.id}`} className="truncate font-medium">{label}</span>
                      )}
                      {mgr && <a href={mgr} target="_blank" rel="noreferrer" title="Abrir no Gerenciador de Anúncios" className="shrink-0 text-xs text-slate-500 hover:text-blue-400">↗</a>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{synced ? timeAgo(synced) : "—"}</td>
                  {cells(r.metrics).map((v, i) => (
                    <td key={i} className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${i === 3 ? profitCls(r.metrics) : "text-slate-200"}`}>{v}</td>
                  ))}
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={3 + COLS.length} className="px-4 py-10 text-center text-sm text-slate-400">
                  {offerId ? `Nenhum(a) ${u1} com gasto ou venda nesta oferta no período. Confira em Integrações se a conta Meta está vinculada.` : `Nenhum(a) ${u1} com gasto ou venda no período.`}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[#50607e] bg-[#35425f] text-xs font-semibold text-[#eef2f8]">
                <td className="px-3 py-2">—</td>
                <td className="px-3 py-2">{rows.length} {rows.length === 1 ? u1 : uN}</td>
                <td className="px-3 py-2">—</td>
                {cells(total).map((v, i) => (
                  <td key={i} className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${i === 3 ? profitCls(total) : ""}`}>{v}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
