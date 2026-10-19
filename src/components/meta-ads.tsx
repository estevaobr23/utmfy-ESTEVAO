import Link from "next/link";
import { RefreshButton } from "@/components/refresh-button";

import { MetaTable } from "@/components/meta/meta-table";
import { timeAgo } from "@/lib/core/dates";
import { aggregateLevel, LEVELS, type Level, type LevelRow } from "@/lib/core/meta-levels";
import { META_METRICS, latestBudgetChanges, type MetaColumnId, type MetaTableRow } from "@/lib/core/meta-metrics";
import type { ReportNode } from "@/lib/core/report";
import { buildAdvancedIndex, scopeFromSpend } from "@/lib/core/meta-advanced";
import { catalogOnlyRows, type CatalogEntry } from "@/lib/core/meta-catalog-rows";
import { derive, emptySums } from "@/lib/core/metrics";
import { listAccounts, listOfferAccounts, loadMetaAdvanced, loadReport, parseFilters } from "@/lib/queries";
import { loadPixelDerivation } from "@/lib/services/offer-auto-link";
import type { Workspace } from "@/lib/session";
import type { Db } from "@/lib/supabase/types";
import { timed } from "@/lib/perf";

const PRESETS: [string, string][] = [
  ["today", "Hoje"], ["yesterday", "Ontem"], ["7d", "7 dias"], ["14d", "14 dias"], ["30d", "30 dias"], ["month", "Este mês"],
];
const LEVEL_ICON: Record<Level, string> = { contas: "▣", campanhas: "◫", conjuntos: "⊞", anuncios: "▯" };
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const ID = /^[0-9]{1,30}$/;

type CatalogRow = CatalogEntry;

function statusOf(level: MetaTableRow["level"], id: string, ads: CatalogRow[]) {
  const key = level === "account" ? "account_id" : level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id";
  const statuses = ads.filter((ad) => ad[key] === id).map((ad) => ad.effective_status).filter((status): status is string => !!status);
  if (!statuses.length) return null;
  return statuses.includes("ACTIVE") ? "ACTIVE" : statuses[0];
}

function managerUrl(level: MetaTableRow["level"], row: { id: string; accountId: string | null }) {
  if (!row.accountId || row.id.startsWith("__") || level === "account") return null;
  const tab = level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads";
  const selected = level === "campaign" ? `&selected_campaign_ids=${row.id}` : level === "adset" ? `&selected_adset_ids=${row.id}` : `&selected_ad_ids=${row.id}`;
  return `https://adsmanager.facebook.com/adsmanager/manage/${tab}?act=${row.accountId}${selected}`;
}

function findNode(tree: ReportNode[], level: ReportNode["level"], id: string): ReportNode | null {
  for (const node of tree) {
    if (node.level === level && node.id === id) return node;
    const nested = findNode(node.children, level, id);
    if (nested) return nested;
  }
  return null;
}

export async function MetaAdsView({ sb, ws, sp, offerId, path, canWrite }: {
  sb: Db;
  ws: Workspace;
  sp: Record<string, string | string[] | undefined>;
  offerId?: string;
  path: string;
  canWrite: boolean;
}) {
  return timed("meta_ads.view", { offerScoped: !!offerId }, async () => {
  const level = (LEVELS.find(([key]) => key === one(sp.nivel))?.[0] ?? "campanhas") as Level;
  const campaign = ID.test(one(sp.campaign)) ? one(sp.campaign) : null;
  const adset = ID.test(one(sp.adset)) ? one(sp.adset) : null;
  const name = one(sp.q).slice(0, 80);
  const f = parseFilters({ ...sp, campaign: undefined, adset: undefined, ad: undefined }, ws.timezone, offerId);
  const [report, accounts, adsResult, advancedData, pixelScope, budgetLogs] = await Promise.all([
    loadReport(sb, ws, f),
    offerId ? listOfferAccounts(sb, offerId) : listAccounts(sb, ws.id),
    sb.from("meta_ads").select("account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, effective_status").eq("workspace_id", ws.id).limit(5000),
    loadMetaAdvanced(sb, ws, f),
    offerId ? loadPixelDerivation(sb, ws.id) : Promise.resolve(null),
    sb.from("integration_logs").select("created_at, context").eq("workspace_id", ws.id).eq("code", "META_BUDGET_UPDATED").order("created_at", { ascending: false }).limit(500),
  ]);
  const budgetChanges = latestBudgetChanges((budgetLogs.data ?? []) as { created_at: string; context: Record<string, unknown> | null }[]);
  const changeOf = (lvl: MetaTableRow["level"], id: string) => (lvl === "campaign" || lvl === "adset" ? budgetChanges.get(id) ?? null : null);
  const advanced = buildAdvancedIndex(advancedData, scopeFromSpend(report.spendRows), { offerScoped: !!offerId, fx: advancedData.fx });
  if (adsResult.error) throw new Error(`meta_ads: ${adsResult.error.message}`);
  const catalog = (adsResult.data ?? []) as CatalogRow[];
  const accountName = new Map(accounts.map((account) => [account.account_id, account.account_name ?? `act_${account.account_id}`]));
  const syncOf = new Map(accounts.map((account) => [account.account_id, account.last_sync_at as string | null]));
  const accountOfCampaign = new Map<string, string>();
  for (const row of catalog) accountOfCampaign.set(row.campaign_id, row.account_id);
  for (const row of report.spendRows) accountOfCampaign.set(row.campaign_id, row.account_id);
  const lastSync = accounts.map((account) => account.last_sync_at as string | null).filter((value): value is string => !!value).sort().pop() ?? null;

  const link = (patch: Record<string, string | null>) => {
    const query = new URLSearchParams();
    const base: Record<string, string | null> = {
      nivel: level,
      campaign,
      adset,
      q: name || null,
      preset: f.preset === "custom" ? null : f.preset,
      from: f.preset === "custom" ? f.from : null,
      to: f.preset === "custom" ? f.to : null,
      account: f.account,
      meta_status: one(sp.meta_status) || null,
      sort: one(sp.sort) || null,
      dir: one(sp.dir) || null,
      page_size: one(sp.page_size) || null,
    };
    for (const [key, value] of Object.entries({ ...base, ...patch })) if (value) query.set(key, value);
    return `${path}?${query.toString()}`;
  };

  const drill = (row: LevelRow) =>
    level === "contas" ? link({ nivel: "campanhas", account: row.id, campaign: null, adset: null, page: null })
      : level === "campanhas" ? link({ nivel: "conjuntos", campaign: row.id, adset: null, page: null })
        : level === "conjuntos" ? link({ nivel: "anuncios", campaign: row.campaignId, adset: row.id, page: null })
          : null;

  const makeTreeRow = (node: ReportNode, accountId: string | null, campaignId: string | null, adsetId: string | null): MetaTableRow => {
    const nodeLevel = node.level === "campaign" ? "campaign" : node.level === "adset" ? "adset" : "ad";
    const currentCampaign = nodeLevel === "campaign" ? node.id : campaignId;
    const currentAdset = nodeLevel === "adset" ? node.id : adsetId;
    const acc = accountId ?? (currentCampaign ? accountOfCampaign.get(currentCampaign) ?? null : null);
    const row = { id: node.id, accountId: acc };
    const drillUrl = nodeLevel === "campaign"
      ? link({ nivel: "conjuntos", campaign: node.id, adset: null, page: null })
      : nodeLevel === "adset"
        ? link({ nivel: "anuncios", campaign: currentCampaign, adset: node.id, page: null })
        : null;
    return {
      id: node.id,
      level: nodeLevel,
      name: node.name,
      accountId: acc,
      campaignId: currentCampaign,
      adsetId: currentAdset,
      status: statusOf(nodeLevel, node.id, catalog),
      lastSync: acc ? syncOf.get(acc) ?? null : null,
      ...advanced.extras(nodeLevel, node.id),
      budgetChange: changeOf(nodeLevel, node.id),
      metrics: node.metrics,
      drillUrl,
      managerUrl: managerUrl(nodeLevel, row),
      children: node.children.map((child) => makeTreeRow(child, acc, currentCampaign, currentAdset)),
    };
  };

  const aggregated = aggregateLevel(level, report.spendRows, report.orderRows, { campaign, adset });
  const levelRows: MetaTableRow[] = aggregated.rows.map((row) => {
    const mappedLevel: MetaTableRow["level"] = level === "contas" ? "account" : level === "campanhas" ? "campaign" : level === "conjuntos" ? "adset" : "ad";
    const accountId = level === "contas" ? row.id : row.accountId ?? (row.campaignId ? accountOfCampaign.get(row.campaignId) ?? null : null);
    const treeLevel = mappedLevel === "campaign" ? "campaign" : mappedLevel === "adset" ? "adset" : "ad";
    const treeNode = mappedLevel === "account" ? null : findNode(report.tree, treeLevel, row.id);
    const base = treeNode
      ? makeTreeRow(treeNode, accountId, row.campaignId, row.adsetId)
      : {
          id: row.id,
          level: mappedLevel,
          name: level === "contas" ? accountName.get(row.id) ?? row.name : row.name,
          accountId,
          campaignId: row.campaignId,
          adsetId: row.adsetId,
          status: statusOf(mappedLevel, row.id, catalog),
          lastSync: accountId ? syncOf.get(accountId) ?? null : null,
          ...advanced.extras(mappedLevel, row.id),
          budgetChange: changeOf(mappedLevel, row.id),
          metrics: row.metrics,
          drillUrl: drill(row),
          managerUrl: managerUrl(mappedLevel, { id: row.id, accountId }),
          children: [],
        };
    return { ...base, metrics: row.metrics, name: level === "contas" ? accountName.get(row.id) ?? base.name : base.name, drillUrl: drill(row) };
  });

  // Campanha/conjunto/anúncio no ar que ainda não gastou nem vendeu no período (ex.: agendado) aparece zerado,
  // senão o painel parece não enxergar a campanha nova. Na visão de uma oferta, só os conjuntos do pixel dela.
  if (level !== "contas") {
    const adsetIds = offerId ? new Set((pixelScope?.bindings ?? []).filter((b) => b.offerId === offerId).map((b) => b.objectId)) : null;
    const mappedLevel: MetaTableRow["level"] = level === "campanhas" ? "campaign" : level === "conjuntos" ? "adset" : "ad";
    const waiting = catalogOnlyRows(level, catalog, new Set(levelRows.map((row) => row.id)), { account: f.account, campaign, adset, adsetIds, name });
    for (const row of waiting) {
      levelRows.push({
        id: row.id,
        level: mappedLevel,
        name: row.name,
        accountId: row.accountId,
        campaignId: row.campaignId,
        adsetId: row.adsetId,
        status: row.status,
        lastSync: syncOf.get(row.accountId) ?? null,
        ...advanced.extras(mappedLevel, row.id),
        budgetChange: changeOf(mappedLevel, row.id),
        metrics: derive(emptySums()),
        drillUrl: level === "campanhas" ? link({ nivel: "conjuntos", campaign: row.id, adset: null, page: null }) : level === "conjuntos" ? link({ nivel: "anuncios", campaign: row.campaignId, adset: row.id, page: null }) : null,
        managerUrl: managerUrl(mappedLevel, { id: row.id, accountId: row.accountId }),
        children: [],
      });
    }
  }

  const parentCampaign = campaign ? aggregateLevel("campanhas", report.spendRows, report.orderRows, { campaign }).rows[0]?.name : null;
  const parentAdset = adset ? aggregateLevel("conjuntos", report.spendRows, report.orderRows, { adset }).rows[0]?.name : null;
  const sortCandidate = one(sp.sort) as MetaColumnId;
  const sort = META_METRICS.some((metric) => metric.id === sortCandidate && metric.sortable) ? sortCandidate : "spend";
  const direction = one(sp.dir) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  const requestedSize = Number.parseInt(one(sp.page_size), 10);
  const pageSize = [10, 25, 50].includes(requestedSize) ? requestedSize : 25;

  return (
    <div className="overflow-hidden rounded-md bg-surface text-copy">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider bg-surface px-5 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 font-semibold ${report.spendStatus.reliable ? "bg-success text-white" : "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30"}`}>
            {report.spendStatus.reliable ? "✓ Dados financeiros completos" : "⚠ Qualidade de dados pendente"}
          </span>
          <span className="text-copy-muted">Dados da Meta (orçamento pelo lápis · selecione linhas para ativar, desativar ou excluir) · última sincronização {lastSync ? timeAgo(lastSync) : "nunca"}</span>
        </div>
        {canWrite && (
          <RefreshButton />
        )}
      </div>

      <form method="get" action={path} className="flex flex-wrap items-end gap-2 border-b border-divider bg-surface px-5 py-3">
        <input type="hidden" name="nivel" value={level} />
        {campaign && <input type="hidden" name="campaign" value={campaign} />}
        {adset && <input type="hidden" name="adset" value={adset} />}
        <label className="text-[11px] text-copy">Período<select name="preset" defaultValue={f.preset === "custom" ? "" : f.preset} className="mt-1 block h-[34px] rounded border border-input-border bg-transparent px-3 text-sm text-white">{f.preset === "custom" && <option value="">{f.from} → {f.to}</option>}{PRESETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-[11px] text-copy">Conta de anúncio<select name="account" defaultValue={f.account ?? ""} className="mt-1 block h-[34px] max-w-56 rounded border border-input-border bg-transparent px-3 text-sm text-white"><option value="">Qualquer</option>{accounts.map((account) => <option key={account.account_id} value={account.account_id}>{account.account_name ?? account.account_id}</option>)}</select></label>
        <label className="text-[11px] text-copy">Fonte<select disabled className="mt-1 block h-[34px] rounded border border-input-border bg-transparent px-3 text-sm text-copy-muted"><option>Meta Ads</option></select></label>
        <label className="text-[11px] text-copy">Produto<select disabled className="mt-1 block h-[34px] max-w-48 rounded border border-input-border bg-transparent px-3 text-sm text-copy-muted"><option>Oferta selecionada</option></select></label>
        <button className="h-[34px] rounded bg-primary px-4 text-sm font-semibold text-white hover:bg-[var(--primary-hover)]">Filtrar</button>
      </form>

      <nav className="grid grid-cols-2 gap-3 bg-app-bg pt-3 sm:grid-cols-4">
        {LEVELS.map(([key, label]) => (
          <Link key={key} href={link({ nivel: key, campaign: key === "conjuntos" || key === "anuncios" ? campaign : null, adset: key === "anuncios" ? adset : null, page: null })} className={`rounded-t-md px-5 py-3 text-left text-sm font-semibold ${key === level ? "bg-surface text-[var(--link)] shadow-[inset_0_-2px_0_var(--primary)]" : "bg-surface/75 text-copy hover:bg-surface-hover"}`}>
            <span className="mr-2 text-base" aria-hidden>{LEVEL_ICON[key]}</span>{label}
          </Link>
        ))}
      </nav>

      {(advancedData.errors.length > 0 || f.preset === "custom") && (
        <div className="border-b border-divider bg-app-bg px-4 py-2 text-xs text-copy-muted">
          {advancedData.errors.length > 0
            ? "ⓘ Orçamento, lance, vídeo e frequência ainda não estão disponíveis (dados avançados não sincronizados). Gasto e vendas não são afetados."
            : "ⓘ Alcance e frequência exatos só existem nos períodos predefinidos (o alcance não pode ser somado entre dias). Em período personalizado eles aparecem como N/D."}
        </div>
      )}
      {(campaign || adset || !report.spendStatus.reliable) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-divider bg-app-bg px-4 py-2 text-xs">
          {campaign && <Link href={link({ nivel: "campanhas", campaign: null, adset: null, page: null })} className="rounded-full bg-surface-hover px-2 py-1 text-copy">Campanha: {parentCampaign ?? campaign} ×</Link>}
          {adset && <Link href={link({ nivel: "conjuntos", adset: null, page: null })} className="rounded-full bg-surface-hover px-2 py-1 text-copy">Conjunto: {parentAdset ?? adset} ×</Link>}
          {!report.spendStatus.reliable && <span className="text-amber-200">⚠ {report.spendStatus.message}</span>}
        </div>
      )}

      <MetaTable
        rows={levelRows}
        level={level}
        currency={ws.currency}
        path={path}
        spendReliable={report.spendStatus.reliable}
        totalReach={advanced.totalReach({ campaign, adset, accountIds: [...new Set(levelRows.map((row) => row.accountId).filter((id): id is string => !!id))] })}
        initial={{ query: name, status: one(sp.meta_status), sort, direction, page, pageSize }}
        canWrite={canWrite}
        periodLabel={f.preset === "custom" ? `${f.from} → ${f.to}` : PRESETS.find(([key]) => key === f.preset)?.[1] ?? null}
      />
    </div>
  );
  });
}
