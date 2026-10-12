"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  META_COLUMN_PRESETS,
  META_METRICS,
  metaMetricValue,
  totalMetaRows,
  totalVideoRows,
  type MetaColumnId,
  type MetaMetricDefinition,
  type MetaTableRow,
} from "@/lib/core/meta-metrics";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";
import { formatBudgetPeriod } from "@/lib/core/meta-advanced";
import { BudgetEditor } from "@/components/meta/budget-editor";

type Props = {
  rows: MetaTableRow[];
  level: string;
  currency: string;
  path: string;
  spendReliable: boolean;
  /** Alcance/frequência exatos do conjunto inteiro (válidos só sem filtro de nome/status). */
  totalReach: { reach: number | null; frequency: number | null };
  initial: { query: string; status: string; sort: MetaColumnId; direction: "asc" | "desc"; page: number; pageSize: number };
  /** Mostra o lápis de orçamento (grava na Meta). */
  canWrite?: boolean;
};

const SPEND_DEPENDENT = new Set<MetaColumnId>(["spend", "cpa", "profit", "roas", "margin", "roi", "cpc", "cpm", "cpv", "cpi"]);
const STICKY: Partial<Record<MetaColumnId, string>> = {
  select: "sticky left-0 z-20 w-10 min-w-10 bg-inherit",
  status: "sticky left-10 z-20 w-16 min-w-16 bg-inherit",
  name: "sticky left-[6.5rem] z-20 min-w-64 max-w-80 bg-inherit shadow-[5px_0_8px_rgba(7,12,25,0.18)]",
};

function updateQuery(router: ReturnType<typeof useRouter>, current: URLSearchParams, path: string, patch: Record<string, string | null>) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  router.replace(`${path}?${next.toString()}`, { scroll: false });
}

const ND_WHEN_EMPTY = new Set<MetaColumnId>([
  "reach", "frequency", "hook_rate", "play_rate", "body_retention", "retention_25", "retention_50",
  "retention_75", "retention_100", "thruplays", "plays_3s", "video_plays", "avg_watch",
  "page_views", "checkouts", "cpv", "cpi",
]);

function displayValue(row: MetaTableRow, metric: MetaMetricDefinition, currency: string, spendReliable: boolean) {
  if (metric.availability === "unavailable") return "N/D";
  if (!spendReliable && SPEND_DEPENDENT.has(metric.id)) return "—";
  if (metric.format === "budget") {
    const b = row.budget;
    if (!b) return row.level === "ad" || row.level === "account" || row.id === "__total" ? "—" : "N/D";
    if (b.amount == null) return b.note ?? "N/D";
    return `${formatMoney(b.amount, b.currency ?? currency)}${formatBudgetPeriod(b)}`;
  }
  if (metric.format === "bid") {
    const b = row.bidCap;
    if (!b) return row.level === "ad" || row.level === "account" || row.id === "__total" ? "—" : "N/D";
    if (b.amount == null) return b.note ?? "—";
    return formatMoney(b.amount, b.currency ?? currency);
  }
  const value = metaMetricValue(row, metric.id);
  if (value == null || value === "") return ND_WHEN_EMPTY.has(metric.id) ? "N/D" : "—";
  if (metric.format === "seconds") return `${formatNumber(Number(value), 1)} s`;
  if (metric.format === "currency") return formatMoney(Number(value), currency);
  if (metric.format === "integer") return formatNumber(Number(value));
  if (metric.format === "percent") return formatPct(Number(value), 2);
  if (metric.format === "ratio") return formatNumber(Number(value), 2);
  if (metric.format === "datetime") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }
  return String(value);
}

function statusRank(status: string | null) {
  if (status === "ACTIVE") return 3;
  if (status?.includes("PAUSED")) return 2;
  if (status) return 1;
  return 0;
}

function StatusIndicator({ status }: { status: string | null }) {
  if (!status) return <span className="text-[#7f8ca4]">—</span>;
  const active = status === "ACTIVE";
  return (
    <span
      role="img"
      aria-label={`Status Meta: ${status}. Somente leitura.`}
      title={`Meta: ${status} · somente leitura`}
      className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 ${active ? "justify-end bg-[#0874f9]" : "justify-start bg-[#536079]"}`}
    >
      <span className="h-4 w-4 rounded-full bg-white" />
    </span>
  );
}

function rowValue(row: MetaTableRow, column: MetaColumnId) {
  if (column === "status") return statusRank(row.status);
  if (column === "last_sync") return row.lastSync ? new Date(row.lastSync).getTime() : null;
  return metaMetricValue(row, column);
}

function flattenExpanded(rows: MetaTableRow[], expanded: Set<string>, depth = 0): { row: MetaTableRow; depth: number }[] {
  const output: { row: MetaTableRow; depth: number }[] = [];
  for (const row of rows) {
    output.push({ row, depth });
    if (row.children.length && expanded.has(`${row.level}:${row.id}`)) output.push(...flattenExpanded(row.children, expanded, depth + 1));
  }
  return output;
}

function cellTitle(row: MetaTableRow, metric: MetaMetricDefinition) {
  if (metric.format === "budget" && row.budget) {
    const mode = row.budget.mode === "CBO" ? "CBO — orçamento na campanha" : "ABO — orçamento no conjunto";
    const period = row.budget.period === "lifetime" ? " · vitalício" : row.budget.period === "daily" ? " · diário" : "";
    return `${mode}${period} · configuração atual, não é gasto`;
  }
  if (metric.format === "bid" && row.bidCap) return `Estratégia de lance: ${row.bidCap.strategy ?? "desconhecida"}`;
  return undefined;
}

export function MetaTable({ rows, level, currency, path, spendReliable, totalReach, initial, canWrite = false }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const backUrl = (() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("ok");
    params.delete("error");
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  })();
  const queryInUrl = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initial.query);
  const [status, setStatus] = useState(initial.status);
  const [sort, setSort] = useState<MetaColumnId>(initial.sort);
  const [direction, setDirection] = useState<"asc" | "desc">(initial.direction);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [columns, setColumns] = useState<MetaColumnId[]>(META_COLUMN_PRESETS.complete);
  const [columnSearch, setColumnSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const storageKey = `utmfy:v3:meta-columns:${level}`;
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as MetaColumnId[];
      const valid = parsed.filter((id) => META_METRICS.some((metric) => metric.id === id));
      if (!valid.includes("name")) return;
      const timer = window.setTimeout(() => setColumns(valid), 0);
      return () => window.clearTimeout(timer);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [level]);

  useEffect(() => {
    if (query === queryInUrl) return;
    const timer = window.setTimeout(() => {
      updateQuery(router, new URLSearchParams(searchParams.toString()), path, { q: query || null, page: null });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [path, query, queryInUrl, router, searchParams]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    const list = rows.filter((row) => {
      const nameMatches = !normalized || row.name.toLocaleLowerCase("pt-BR").includes(normalized);
      const statusMatches = !status || (status === "ACTIVE" ? row.status === "ACTIVE" : status === "PAUSED" ? row.status?.includes("PAUSED") : !!row.status && row.status !== "ACTIVE" && !row.status.includes("PAUSED"));
      return nameMatches && statusMatches;
    });
    return [...list].sort((a, b) => {
      const av = rowValue(a, sort);
      const bv = rowValue(b, sort);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const order = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "pt-BR");
      return direction === "asc" ? order : -order;
    });
  }, [direction, query, rows, sort, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const visibleRows = flattenExpanded(pageRows, expanded);
  const totals = totalMetaRows(filtered);
  const totalRow: MetaTableRow = { id: "__total", level: "campaign", name: `${filtered.length} resultados`, accountId: null, campaignId: null, adsetId: null, status: null, lastSync: null, budget: null, bidCap: null, reach: filtered.length === rows.length ? totalReach.reach : null, frequency: filtered.length === rows.length ? totalReach.frequency : null, video: totalVideoRows(filtered), metrics: totals, drillUrl: null, managerUrl: null, children: [] };
  const visibleColumns = META_METRICS.filter((metric) => columns.includes(metric.id));
  const configurable = META_METRICS.filter((metric) => !["select", "status", "name"].includes(metric.id) && metric.label.toLocaleLowerCase("pt-BR").includes(columnSearch.toLocaleLowerCase("pt-BR")));

  const saveColumns = (next: MetaColumnId[]) => {
    setColumns(next);
    window.localStorage.setItem(`utmfy:v3:meta-columns:${level}`, JSON.stringify(next));
  };
  const toggleColumn = (id: MetaColumnId) => saveColumns(columns.includes(id) ? columns.filter((column) => column !== id) : META_METRICS.map((metric) => metric.id).filter((column) => columns.includes(column) || column === id));
  const setPreset = (preset: keyof typeof META_COLUMN_PRESETS) => saveColumns(META_COLUMN_PRESETS[preset]);
  const changeSort = (column: MetaColumnId) => {
    const nextDirection = sort === column && direction === "desc" ? "asc" : "desc";
    setSort(column);
    setDirection(nextDirection);
    setPage(1);
    updateQuery(router, new URLSearchParams(searchParams.toString()), path, { sort: column, dir: nextDirection, page: null });
  };
  const changePage = (nextPage: number) => {
    setPage(nextPage);
    updateQuery(router, new URLSearchParams(searchParams.toString()), path, { page: nextPage > 1 ? String(nextPage) : null });
  };
  const toggleExpanded = (row: MetaTableRow) => {
    const key = `${row.level}:${row.id}`;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const expandableKeys = pageRows.flatMap((row) => [row, ...row.children]).filter((row) => row.children.length).map((row) => `${row.level}:${row.id}`);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 border-b border-[#394761] bg-[#222e47] px-4 py-3">
        <label className="min-w-48 flex-1 text-[11px] text-[#9aa6bb]">
          Nome
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Filtrar por nome" className="mt-1 block w-full max-w-xs rounded border border-[#46546e] bg-[#1b263d] px-3 py-2 text-sm text-white outline-none placeholder:text-[#718098] focus:border-[#0874f9]" />
        </label>
        <label className="text-[11px] text-[#9aa6bb]">
          Status
          <select value={status} onChange={(event) => { const value = event.target.value; setStatus(value); setPage(1); updateQuery(router, new URLSearchParams(searchParams.toString()), path, { meta_status: value || null, page: null }); }} className="mt-1 block rounded border border-[#46546e] bg-[#1b263d] px-3 py-2 text-sm text-white">
            <option value="">Qualquer</option><option value="ACTIVE">Ativo</option><option value="PAUSED">Pausado</option><option value="RESTRICTED">Com restrições</option>
          </select>
        </label>
        {expandableKeys.length > 0 && (
          <button type="button" onClick={() => setExpanded(expanded.size ? new Set() : new Set(expandableKeys))} className="rounded border border-[#46546e] bg-[#2d3a56] px-3 py-2 text-xs font-medium text-[#dce2ec] hover:bg-[#344461]">
            {expanded.size ? "Recolher tudo" : "Expandir tudo"}
          </button>
        )}
        <details className="relative">
          <summary className="cursor-pointer list-none rounded border border-[#46546e] bg-[#2d3a56] px-3 py-2 text-xs font-medium text-[#dce2ec] hover:bg-[#344461]">Personalizar colunas</summary>
          <div className="absolute right-0 z-40 mt-1 w-80 rounded-md border border-[#46546e] bg-[#202c45] p-3 shadow-2xl shadow-black/40">
            <input value={columnSearch} onChange={(event) => setColumnSearch(event.target.value)} placeholder="Buscar métrica" className="mb-2 w-full rounded border border-[#46546e] bg-[#172137] px-2 py-1.5 text-sm text-white outline-none" />
            <div className="mb-2 flex gap-1">
              <button type="button" onClick={() => setPreset("essential")} className="rounded bg-[#34415e] px-2 py-1 text-xs">Essencial</button>
              <button type="button" onClick={() => setPreset("complete")} className="rounded bg-[#34415e] px-2 py-1 text-xs">Completo</button>
              <button type="button" onClick={() => setPreset("creative")} className="rounded bg-[#34415e] px-2 py-1 text-xs">Criativos</button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {configurable.map((metric) => (
                <label key={metric.id} className="flex items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-[#2d3a56]" title={`${metric.source}${metric.formula ? ` · ${metric.formula}` : ""}`}>
                  <input type="checkbox" checked={columns.includes(metric.id)} onChange={() => toggleColumn(metric.id)} className="mt-0.5" />
                  <span className="flex-1"><span className="block text-[#e2e7ef]">{metric.label}</span><span className={metric.availability === "unavailable" ? "text-amber-300" : metric.availability === "partial" ? "text-blue-300" : "text-[#7f8ca4]"}>{metric.availability === "unavailable" ? "Indisponível" : metric.availability === "partial" ? "Fonte parcial" : metric.source}</span></span>
                </label>
              ))}
            </div>
          </div>
        </details>
      </div>

      <div className="max-h-[68vh] overflow-auto">
        <table className="min-w-max border-separate border-spacing-0 text-[12px] text-[#e6ebf3]">
          <thead className="sticky top-0 z-30">
            <tr className="bg-[#35425f]">
              {visibleColumns.map((metric) => (
                <th key={metric.id} className={`border-b border-r border-[#46536d] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#d4dbe7] ${STICKY[metric.id] ?? "min-w-24"} ${metric.format !== "text" && metric.id !== "status" ? "text-right" : ""}`} title={`${metric.source}${metric.formula ? ` · ${metric.formula}` : ""}`}>
                  {metric.sortable ? <button type="button" onClick={() => changeSort(metric.id)} className="whitespace-nowrap hover:text-white">{metric.label} {sort === metric.id ? (direction === "desc" ? "↓" : "↑") : ""}</button> : metric.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, depth }) => (
              <tr key={`${row.level}:${row.id}`} className={`${depth ? "bg-[#222e47]" : "bg-[#27334d]"} hover:bg-[#2d3a56]`}>
                {visibleColumns.map((metric) => {
                  const base = `border-b border-r border-[#394761] px-3 py-2 ${STICKY[metric.id] ?? ""}`;
                  if (metric.id === "select") return <td key={metric.id} className={base}><input type="checkbox" aria-label={`Selecionar ${row.name}`} /></td>;
                  if (metric.id === "status") return <td key={metric.id} className={`${base} text-center`}><StatusIndicator status={row.status} /></td>;
                  if (metric.id === "name") return (
                    <td key={metric.id} className={base}>
                      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
                        {row.children.length ? <button type="button" onClick={() => toggleExpanded(row)} aria-expanded={expanded.has(`${row.level}:${row.id}`)} className="w-4 shrink-0 text-[#8fa1bb] hover:text-white">{expanded.has(`${row.level}:${row.id}`) ? "▾" : "▸"}</button> : <span className="w-4 shrink-0" />}
                        {row.drillUrl ? <Link href={row.drillUrl} className="max-w-56 truncate font-semibold text-white hover:text-[#54a8ff]" title={row.name}>{row.name}</Link> : <span className="max-w-56 truncate font-semibold" title={row.name}>{row.name}</span>}
                        {row.managerUrl && <a href={row.managerUrl} target="_blank" rel="noreferrer" aria-label="Abrir no Gerenciador da Meta" className="text-[#7f91aa] hover:text-[#54a8ff]">↗</a>}
                      </div>
                    </td>
                  );
                  const value = displayValue(row, metric, currency, spendReliable);
                  const tone = metric.id === "profit" ? (row.metrics.profit > 0 ? "text-[#25d17f]" : row.metrics.profit < 0 ? "text-[#ff5b6b]" : "") : metric.availability === "unavailable" || value === "N/D" ? "text-[#758299]" : "";
                  const badge = metric.format === "budget" && row.budget?.amount != null
                    ? <span className="mr-1.5 rounded bg-[#34415e] px-1 py-0.5 text-[9px] font-semibold text-[#9fb3d1]">{row.budget.mode}</span>
                    : null;
                  const editable = canWrite && metric.format === "budget" && row.budget?.amount != null && row.budget.period === "daily";
                  return <td key={metric.id} title={cellTitle(row, metric)} className={`${base} whitespace-nowrap text-right tabular-nums ${tone}`}>{badge}{value}{editable && <BudgetEditor row={row} back={backUrl} currency={currency} />}</td>;
                })}
              </tr>
            ))}
            {!visibleRows.length && <tr><td colSpan={visibleColumns.length} className="bg-[#27334d] px-6 py-12 text-center text-sm text-[#8f9bb1]">Nenhum resultado para os filtros atuais.</td></tr>}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="sticky bottom-0 z-30">
              <tr className="bg-[#3a4865] font-semibold text-white">
                {visibleColumns.map((metric) => {
                  const base = `border-t border-r border-[#53617c] px-3 py-2 ${STICKY[metric.id] ?? ""}`;
                  if (metric.id === "select" || metric.id === "status") return <td key={metric.id} className={base}>—</td>;
                  if (metric.id === "name") return <td key={metric.id} className={base}>{filtered.length} resultado(s)</td>;
                  return <td key={metric.id} className={`${base} whitespace-nowrap text-right tabular-nums`}>{displayValue(totalRow, metric, currency, spendReliable)}</td>;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#394761] bg-[#202b43] px-4 py-3 text-xs text-[#aab4c6]">
        <span>{filtered.length ? `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)} de ${filtered.length} resultados` : "0 resultados"} · totais de todos os resultados filtrados</span>
        <div className="flex items-center gap-2">
          <label>Por página <select value={pageSize} onChange={(event) => { const value = Number(event.target.value); setPageSize(value); setPage(1); updateQuery(router, new URLSearchParams(searchParams.toString()), path, { page_size: String(value), page: null }); }} className="ml-1 rounded border border-[#46546e] bg-[#27334d] px-2 py-1"><option>10</option><option>25</option><option>50</option></select></label>
          <button type="button" disabled={safePage <= 1} onClick={() => changePage(safePage - 1)} className="rounded border border-[#46546e] px-2 py-1 disabled:opacity-40">Anterior</button>
          <span>{safePage}/{pageCount}</span>
          <button type="button" disabled={safePage >= pageCount} onClick={() => changePage(safePage + 1)} className="rounded border border-[#46546e] px-2 py-1 disabled:opacity-40">Próxima</button>
        </div>
      </div>
    </div>
  );
}
