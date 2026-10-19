"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  META_COLUMN_PRESETS,
  META_METRICS,
  metaMetricValue,
  totalMetaRows,
  totalVideoRows,
  type BudgetChange,
  type MetaColumnId,
  type MetaMetricDefinition,
  type MetaTableRow,
} from "@/lib/core/meta-metrics";
import { formatMoney, formatNumber, formatPct } from "@/lib/core/money";
import { formatBudgetPeriod } from "@/lib/core/meta-advanced";
import { BudgetEditor } from "@/components/meta/budget-editor";
import { bulkMetaStatus } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { isRemovedStatus, removedLabel, STATUS_OPS, type StatusLevel, type StatusOp } from "@/lib/core/meta-status";

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
  /** Nome do período em tela (Hoje, 7 dias…): vai junto da foto de lucro/ROI de cada mudança de orçamento. */
  periodLabel?: string | null;
};

/** Larguras padrão (px) e limites do redimensionamento por arrasto. */
const DEFAULT_WIDTH = 112;
const COLUMN_WIDTH: Partial<Record<MetaColumnId, number>> = { select: 40, status: 64, name: 280, last_sync: 300, budget: 150 };
const FIXED_COLUMNS = new Set<MetaColumnId>(["select", "status"]);
const MIN_WIDTH = 72;
const MAX_WIDTH = 640;
const WIDTHS_KEY = "utmfy:v1:meta-col-widths";

const SPEND_DEPENDENT = new Set<MetaColumnId>(["spend", "cpa", "profit", "roas", "margin", "roi", "cpc", "cpm", "cpv", "cpi"]);
const STICKY: Partial<Record<MetaColumnId, string>> = {
  select: "sticky left-0 z-20 bg-inherit",
  status: "sticky left-10 z-20 bg-inherit",
  name: "sticky left-[6.5rem] z-20 bg-inherit shadow-[5px_0_8px_rgba(7,12,25,0.18)]",
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

/** ROAS/ROI em verde quando dão retorno, vermelho quando perdem (mesmas cores do Lucro); sem gasto, sem cor. */
function returnTone(row: MetaTableRow, id: "roas" | "roi", spendReliable: boolean) {
  const value = id === "roas" ? row.metrics.roas : row.metrics.roi;
  if (!spendReliable || value == null || !Number.isFinite(value) || !row.metrics.spend) return "";
  const breakEven = id === "roas" ? 1 : 0;
  return value > breakEven ? "text-success" : value < breakEven ? "text-danger-accessible" : "";
}

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
  if (!status) return <span className="text-copy-muted">—</span>;
  const removed = removedLabel(status);
  if (removed) return <span title={`Meta: ${status} · a Meta não lista mais este item`} className="inline-block rounded bg-surface-hover px-1 py-0.5 text-[9px] font-semibold leading-tight text-copy-muted">{removed}</span>;
  const active = status === "ACTIVE";
  return (
    <span
      role="img"
      aria-label={`Status Meta: ${status}. Somente leitura.`}
      title={`Meta: ${status} · somente leitura`}
      className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 ${active ? "justify-end bg-primary" : "justify-start bg-input-border"}`}
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

function flattenExpanded(rows: MetaTableRow[], expanded: Set<string>, showRemoved: boolean, depth = 0): { row: MetaTableRow; depth: number }[] {
  const output: { row: MetaTableRow; depth: number }[] = [];
  for (const row of rows) {
    if (!showRemoved && isRemovedStatus(row.status)) continue;
    output.push({ row, depth });
    if (row.children.length && expanded.has(`${row.level}:${row.id}`)) output.push(...flattenExpanded(row.children, expanded, showRemoved, depth + 1));
  }
  return output;
}

const formatChangeDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
};

const budgetChangeTitle = (c: BudgetChange) => {
  const s = c.snapshot;
  const snap = s ? ` · No momento${s.period ? ` (${s.period})` : ""}: ${[s.profit != null ? `lucro ${formatMoney(s.profit, c.currency)}` : null, s.roi != null ? `ROI ${formatNumber(s.roi, 2)}` : null, s.roas != null ? `ROAS ${formatNumber(s.roas, 2)}` : null, s.spend != null ? `gasto ${formatMoney(s.spend, c.currency)}` : null, s.sales != null ? `${s.sales} venda(s)` : null].filter(Boolean).join(" · ")}` : "";
  return `Orçamento diário alterado por aqui em ${formatChangeDate(c.at)}: ${formatMoney(c.before, c.currency)} → ${formatMoney(c.after, c.currency)}${snap}`;
};

const gainTone = (value: number | null, breakEven: number) => (value == null ? "text-copy" : value > breakEven ? "text-success" : value < breakEven ? "text-danger-accessible" : "text-copy");

/** Pílula "rótulo valor" da foto da mudança; nunca quebra por dentro, quebra de linha só entre pílulas. */
function Pill({ label, children, tone = "text-copy" }: { label: string; children: React.ReactNode; tone?: string }) {
  return <span className="inline-flex items-baseline gap-1 whitespace-nowrap rounded bg-surface-hover px-1.5 py-0.5 text-[11px] leading-tight"><span className="text-copy-muted">{label}</span><b className={`font-semibold ${tone}`}>{children}</b></span>;
}

/**
 * Data da sincronização + (se houve) a última mudança de orçamento com a foto do lucro/ROI/ROAS daquele momento.
 * Tudo numa fila que quebra por pílula: coluna larga = tudo em uma linha, estreita = empilha, sem cortar palavra.
 */
function LastUpdateCell({ row, synced }: { row: MetaTableRow; synced: string }) {
  const c = row.budgetChange;
  const snap = c?.snapshot ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="whitespace-nowrap">{synced}</span>
      {c && (
        <>
          <Pill label="Orçamento"><span className="font-normal text-copy">{formatMoney(c.before, c.currency)}</span><span className="font-normal text-copy-muted"> → </span><span className={c.after >= c.before ? "text-success" : "text-warning"}>{formatMoney(c.after, c.currency)}</span></Pill>
          {snap?.profit != null && <Pill label="Lucro" tone={gainTone(snap.profit, 0)}>{formatMoney(snap.profit, c.currency)}</Pill>}
          {snap?.roi != null && <Pill label="ROI" tone={gainTone(snap.roi, 0)}>{formatNumber(snap.roi, 2)}</Pill>}
          {snap?.roas != null && <Pill label="ROAS" tone={gainTone(snap.roas, 1)}>{formatNumber(snap.roas, 2)}</Pill>}
          {snap?.sales != null && <Pill label="Vendas">{snap.sales}</Pill>}
          <span className="whitespace-nowrap text-[11px] text-copy-muted">alterado em {formatChangeDate(c.at)}{snap?.period ? ` · ${snap.period}` : ""}</span>
        </>
      )}
    </div>
  );
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

export function MetaTable({ rows, level, currency, path, spendReliable, totalReach, initial, canWrite = false, periodLabel = null }: Props) {
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
  // Seleção (só linhas do nível da tabela): id → nome. Some ao trocar de nível e depois de cada ação aplicada.
  const selectableLevel: StatusLevel | null = level === "campanhas" ? "campaign" : level === "conjuntos" ? "adset" : level === "anuncios" ? "ad" : null;
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [onlySelected, setOnlySelected] = useState(false);
  const [pendingOp, setPendingOp] = useState<StatusOp | null>(null);
  const [copied, setCopied] = useState(false);
  const [seenLevel, setSeenLevel] = useState(level);
  const flash = searchParams.get("ok") ?? searchParams.get("error") ?? "";
  const [seenFlash, setSeenFlash] = useState(flash);
  if (seenLevel !== level || seenFlash !== flash) {
    setSeenLevel(level);
    setSeenFlash(flash);
    setSelected(new Map());
    setOnlySelected(false);
    setPendingOp(null);
  }
  const [widths, setWidths] = useState<Partial<Record<MetaColumnId, number>>>({});
  const widthsRef = useRef(widths);
  useEffect(() => { widthsRef.current = widths; }, [widths]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(WIDTHS_KEY) ?? "{}") as Record<string, number>;
      const timer = window.setTimeout(() => setWidths(saved), 0);
      return () => window.clearTimeout(timer);
    } catch {
      /* sem armazenamento: usa as larguras padrão */
    }
  }, []);

  const widthOf = (id: MetaColumnId) => {
    const w = widths[id];
    return typeof w === "number" ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)) : COLUMN_WIDTH[id] ?? DEFAULT_WIDTH;
  };
  const persistWidths = (next: Partial<Record<MetaColumnId, number>>) => {
    try { window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(next)); } catch { /* ignora */ }
  };
  /** Arrastar a borda direita do cabeçalho muda a largura da coluna; duplo clique volta ao padrão. */
  const startResize = (id: MetaColumnId, event: React.PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = widthOf(id);
    const move = (e: PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(startWidth + e.clientX - startX)));
      setWidths((current) => ({ ...current, [id]: next }));
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      persistWidths(widthsRef.current);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };
  const resetWidth = (id: MetaColumnId) => {
    const next = { ...widthsRef.current };
    delete next[id];
    setWidths(next);
    persistWidths(next);
  };

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
      const removed = isRemovedStatus(row.status);
      // Arquivada/excluída na Meta não é listada (some do Gerenciador); só aparece se o filtro de status pedir.
      if (removed && status !== "REMOVED") return false;
      const statusMatches = !status || (status === "ACTIVE" ? row.status === "ACTIVE" : status === "PAUSED" ? row.status?.includes("PAUSED") : status === "REMOVED" ? removed : !!row.status && row.status !== "ACTIVE" && !row.status.includes("PAUSED") && !removed);
      return nameMatches && statusMatches && (!onlySelected || selected.has(row.id));
    });
    return [...list].sort((a, b) => {
      const av = rowValue(a, sort);
      const bv = rowValue(b, sort);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const order = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "pt-BR");
      if (order === 0 && sort === "sales") return b.metrics.spend - a.metrics.spend; // mesmas vendas: quem gastou mais primeiro
      return direction === "asc" ? order : -order;
    });
  }, [direction, onlySelected, query, rows, selected, sort, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const visibleRows = flattenExpanded(pageRows, expanded, status === "REMOVED");
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
  const isSelectable = (row: MetaTableRow, depth: number) => depth === 0 && !!selectableLevel && row.level !== "account" && !row.id.startsWith("__") && !isRemovedStatus(row.status);
  const selectedIds = rows.filter((row) => selected.has(row.id)).map((row) => row.id);
  const pageSelectable = pageRows.filter((row) => isSelectable(row, 0));
  const allPageSelected = pageSelectable.length > 0 && pageSelectable.every((row) => selected.has(row.id));
  const toggleSelected = (row: MetaTableRow) => setSelected((current) => {
    const next = new Map(current);
    if (next.has(row.id)) next.delete(row.id); else next.set(row.id, row.name);
    return next;
  });
  const togglePage = () => setSelected((current) => {
    const next = new Map(current);
    for (const row of pageSelectable) { if (allPageSelected) next.delete(row.id); else next.set(row.id, row.name); }
    return next;
  });
  const clearSelection = () => { setSelected(new Map()); setOnlySelected(false); setPendingOp(null); };
  const copyIds = async () => {
    try { await navigator.clipboard.writeText(selectedIds.join("\n")); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* sem permissão de área de transferência */ }
  };
  const noun = level === "campanhas" ? "campanha(s)" : level === "conjuntos" ? "conjunto(s)" : "anúncio(s)";
  const expandableKeys = pageRows.flatMap((row) => [row, ...row.children]).filter((row) => row.children.length).map((row) => `${row.level}:${row.id}`);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 border-b border-divider bg-surface px-5 py-3">
        <label className="min-w-48 flex-1 text-[11px] text-copy">
          Nome
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Filtrar por nome" className="mt-1 block h-[34px] w-full max-w-xs rounded border border-input-border bg-transparent px-3 text-sm text-white outline-none placeholder:text-copy-muted focus:border-primary" />
        </label>
        <label className="text-[11px] text-copy">
          Status
          <select value={status} onChange={(event) => { const value = event.target.value; setStatus(value); setPage(1); updateQuery(router, new URLSearchParams(searchParams.toString()), path, { meta_status: value || null, page: null }); }} className="mt-1 block h-[34px] rounded border border-input-border bg-transparent px-3 text-sm text-white">
            <option value="">Qualquer</option><option value="ACTIVE">Ativo</option><option value="PAUSED">Pausado</option><option value="RESTRICTED">Com restrições</option><option value="REMOVED">Arquivado/excluído</option>
          </select>
        </label>
        {expandableKeys.length > 0 && (
          <button type="button" onClick={() => setExpanded(expanded.size ? new Set() : new Set(expandableKeys))} className="h-[34px] rounded border border-input-border bg-surface-hover px-3 text-xs font-medium text-copy hover:bg-app-bg">
            {expanded.size ? "Recolher tudo" : "Expandir tudo"}
          </button>
        )}
        <details className="relative">
          <summary className="grid h-[34px] cursor-pointer list-none place-items-center rounded border border-input-border bg-surface-hover px-3 text-xs font-medium text-copy hover:bg-app-bg">Personalizar colunas</summary>
          <div className="absolute right-0 z-40 mt-1 w-80 rounded-md border border-divider bg-surface p-3 shadow-2xl shadow-black/40">
            <input value={columnSearch} onChange={(event) => setColumnSearch(event.target.value)} placeholder="Buscar métrica" className="mb-2 h-[34px] w-full rounded border border-input-border bg-app-bg px-2 text-sm text-white outline-none" />
            <div className="mb-2 flex gap-1">
              <button type="button" onClick={() => setPreset("essential")} className="rounded bg-surface-hover px-2 py-1 text-xs">Essencial</button>
              <button type="button" onClick={() => setPreset("complete")} className="rounded bg-surface-hover px-2 py-1 text-xs">Completo</button>
              <button type="button" onClick={() => setPreset("creative")} className="rounded bg-surface-hover px-2 py-1 text-xs">Criativos</button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {configurable.map((metric) => (
                <label key={metric.id} className="flex items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-hover" title={`${metric.source}${metric.formula ? ` · ${metric.formula}` : ""}`}>
                  <input type="checkbox" checked={columns.includes(metric.id)} onChange={() => toggleColumn(metric.id)} className="mt-0.5" />
                  <span className="flex-1"><span className="block text-copy-strong">{metric.label}</span><span className={metric.availability === "unavailable" ? "text-amber-300" : metric.availability === "partial" ? "text-blue-300" : "text-copy-muted"}>{metric.availability === "unavailable" ? "Indisponível" : metric.availability === "partial" ? "Fonte parcial" : metric.source}</span></span>
                </label>
              ))}
            </div>
          </div>
        </details>
      </div>

      {selectedIds.length > 0 && (
        <div className="border-b border-divider bg-primary/10 px-5 py-2.5 text-xs text-copy">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-white">{selectedIds.length} {noun} selecionada(s)</b>
            <button type="button" onClick={copyIds} className="rounded border border-input-border bg-surface-hover px-2.5 py-1 font-medium text-copy hover:bg-app-bg">{copied ? "IDs copiados ✓" : "Copiar IDs"}</button>
            <button type="button" onClick={() => setOnlySelected((v) => !v)} className="rounded border border-input-border bg-surface-hover px-2.5 py-1 font-medium text-copy hover:bg-app-bg">{onlySelected ? "Mostrar todas" : "Filtrar selecionadas"}</button>
            {canWrite && selectableLevel && (["activate", "pause", "delete"] as const).map((op) => (
              <button key={op} type="button" onClick={() => setPendingOp(pendingOp === op ? null : op)} aria-pressed={pendingOp === op} className={`rounded border px-2.5 py-1 font-medium ${op === "delete" ? "border-rose-400/40 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20" : "border-input-border bg-surface-hover text-copy hover:bg-app-bg"} ${pendingOp === op ? "ring-1 ring-primary" : ""}`}>{STATUS_OPS[op].label}</button>
            ))}
            <button type="button" onClick={clearSelection} className="ml-auto rounded px-2 py-1 text-copy-muted hover:text-white">Limpar seleção</button>
          </div>
          {pendingOp && canWrite && selectableLevel && (
            <form action={bulkMetaStatus} className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-divider bg-app-bg px-3 py-2">
              <input type="hidden" name="level" value={selectableLevel} />
              <input type="hidden" name="op" value={pendingOp} />
              <input type="hidden" name="ids" value={selectedIds.join(",")} />
              <input type="hidden" name="back" value={backUrl} />
              <p className="min-w-0 flex-1 break-words text-[12px]">
                <b className="text-white">{STATUS_OPS[pendingOp].label} {selectedIds.length} {noun}?</b>{" "}
                {STATUS_OPS[pendingOp].confirm}{" "}
                <span className="text-copy-muted">{selectedIds.slice(0, 4).map((id) => selected.get(id)).join(" · ")}{selectedIds.length > 4 ? ` · +${selectedIds.length - 4}` : ""}</span>
              </p>
              <button type="button" onClick={() => setPendingOp(null)} className="rounded-md px-3 py-1.5 text-sm text-copy hover:text-white">Cancelar</button>
              <SubmitButton variant={pendingOp === "delete" ? "danger" : "primary"} pendingText="Aplicando na Meta...">{pendingOp === "delete" ? "Excluir definitivamente" : `Confirmar: ${STATUS_OPS[pendingOp].label.toLowerCase()}`}</SubmitButton>
            </form>
          )}
        </div>
      )}

      <div className="max-h-[68vh] overflow-auto">
        <table className="border-separate border-spacing-0 text-[12px] text-copy" style={{ tableLayout: "fixed", width: visibleColumns.reduce((sum, metric) => sum + widthOf(metric.id), 0) }}>
          <colgroup>
            {visibleColumns.map((metric) => <col key={metric.id} style={{ width: widthOf(metric.id) }} />)}
          </colgroup>
          <thead className="sticky top-0 z-30">
            <tr className="bg-app-bg">
              {visibleColumns.map((metric) => (
                <th key={metric.id} className={`h-11 overflow-hidden text-ellipsis whitespace-nowrap border-b border-divider px-3 py-2 text-left text-xs font-semibold text-copy ${STICKY[metric.id] ?? "relative"} ${metric.format !== "text" && metric.id !== "status" && metric.id !== "last_sync" ? "text-right" : ""}`} title={`${metric.source}${metric.formula ? ` · ${metric.formula}` : ""}`}>
                  {metric.id === "select" ? (selectableLevel ? <input type="checkbox" aria-label="Selecionar todas desta página" checked={allPageSelected} onChange={togglePage} disabled={!pageSelectable.length} /> : null) : metric.sortable ? <button type="button" onClick={() => changeSort(metric.id)} className="whitespace-nowrap hover:text-white">{metric.label} {sort === metric.id ? (direction === "desc" ? "↓" : "↑") : ""}</button> : metric.label}
                  {!FIXED_COLUMNS.has(metric.id) && (
                    <span role="separator" aria-orientation="vertical" aria-label={`Ajustar largura de ${metric.label}`} title="Arraste para ajustar a largura · duplo clique restaura" onPointerDown={(event) => startResize(metric.id, event)} onDoubleClick={() => resetWidth(metric.id)} className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary/60 active:bg-primary" />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ row, depth }) => (
              <tr key={`${row.level}:${row.id}`} className="bg-surface hover:bg-surface-hover">
                {visibleColumns.map((metric) => {
                  const base = `h-11 overflow-hidden text-ellipsis border-b border-divider px-3 py-2 ${STICKY[metric.id] ?? ""}`;
                  if (metric.id === "select") return <td key={metric.id} className={base}>{isSelectable(row, depth) ? <input type="checkbox" aria-label={`Selecionar ${row.name}`} checked={selected.has(row.id)} onChange={() => toggleSelected(row)} /> : null}</td>;
                  if (metric.id === "status") return <td key={metric.id} className={`${base} text-center`}><StatusIndicator status={row.status} /></td>;
                  if (metric.id === "name") return (
                    <td key={metric.id} className={base}>
                      <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 16 }}>
                        {row.children.length ? <button type="button" onClick={() => toggleExpanded(row)} aria-expanded={expanded.has(`${row.level}:${row.id}`)} className="w-4 shrink-0 text-copy-muted hover:text-white">{expanded.has(`${row.level}:${row.id}`) ? "▾" : "▸"}</button> : <span className="w-4 shrink-0" />}
                        {row.drillUrl ? <Link href={row.drillUrl} className="min-w-0 truncate font-semibold text-white hover:text-[var(--link)]" title={row.name}>{row.name}</Link> : <span className="min-w-0 truncate font-semibold" title={row.name}>{row.name}</span>}
                        {row.managerUrl && <a href={row.managerUrl} target="_blank" rel="noreferrer" aria-label="Abrir no Gerenciador da Meta" className="text-copy-muted hover:text-[var(--link)]">↗</a>}
                      </div>
                    </td>
                  );
                  if (metric.id === "last_sync") return (
                    <td key={metric.id} className={`${base} tabular-nums`} title={row.budgetChange ? budgetChangeTitle(row.budgetChange) : undefined}>
                      <LastUpdateCell row={row} synced={displayValue(row, metric, currency, spendReliable)} />
                    </td>
                  );
                  const value = displayValue(row, metric, currency, spendReliable);
                  const tone = metric.id === "profit" ? (row.metrics.profit > 0 ? "text-success" : row.metrics.profit < 0 ? "text-danger-accessible" : "") : metric.id === "roas" || metric.id === "roi" ? returnTone(row, metric.id, spendReliable) : metric.availability === "unavailable" || value === "N/D" ? "text-copy-muted" : "";
                  const badge = metric.format === "budget" && row.budget?.amount != null
                    ? <span className="mr-1.5 rounded bg-surface-hover px-1 py-0.5 text-[9px] font-semibold text-copy">{row.budget.mode}</span>
                    : null;
                  const editable = canWrite && metric.format === "budget" && row.budget?.amount != null && row.budget.period === "daily";
                  return <td key={metric.id} title={cellTitle(row, metric)} className={`${base} whitespace-nowrap text-right tabular-nums ${tone}`}>{badge}{value}{editable && <BudgetEditor row={row} back={backUrl} currency={currency} spendReliable={spendReliable} periodLabel={periodLabel} />}</td>;
                })}
              </tr>
            ))}
            {!visibleRows.length && <tr><td colSpan={visibleColumns.length} className="bg-surface px-6 py-12 text-center text-sm text-copy-muted">Nenhum resultado para os filtros atuais.</td></tr>}
          </tbody>
          {filtered.length > 0 && (
            <tfoot className="sticky bottom-0 z-30">
              <tr className="bg-app-bg font-semibold text-white">
                {visibleColumns.map((metric) => {
                  const base = `h-11 border-t border-divider px-3 py-2 ${STICKY[metric.id] ?? ""}`;
                  if (metric.id === "select" || metric.id === "status") return <td key={metric.id} className={base}>—</td>;
                  if (metric.id === "name") return <td key={metric.id} className={base}>{filtered.length} resultado(s)</td>;
                  return <td key={metric.id} className={`${base} whitespace-nowrap text-right tabular-nums ${metric.id === "roas" || metric.id === "roi" ? returnTone(totalRow, metric.id, spendReliable) : ""}`}>{displayValue(totalRow, metric, currency, spendReliable)}</td>;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider bg-app-bg px-4 py-3 text-xs text-copy">
        <span>{filtered.length ? `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filtered.length)} de ${filtered.length} resultados` : "0 resultados"} · totais de todos os resultados filtrados</span>
        <div className="flex items-center gap-2">
          <label>Por página <select value={pageSize} onChange={(event) => { const value = Number(event.target.value); setPageSize(value); setPage(1); updateQuery(router, new URLSearchParams(searchParams.toString()), path, { page_size: String(value), page: null }); }} className="ml-1 rounded border border-input-border bg-surface px-2 py-1"><option>10</option><option>25</option><option>50</option></select></label>
          <button type="button" disabled={safePage <= 1} onClick={() => changePage(safePage - 1)} className="rounded border border-input-border px-2 py-1 disabled:opacity-40">Anterior</button>
          <span>{safePage}/{pageCount}</span>
          <button type="button" disabled={safePage >= pageCount} onClick={() => changePage(safePage + 1)} className="rounded border border-input-border px-2 py-1 disabled:opacity-40">Próxima</button>
        </div>
      </div>
    </div>
  );
}
