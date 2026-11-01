"use client";

import { useState, useTransition, type DragEvent, type ReactNode } from "react";
import { saveDashboardLayout } from "@/app/actions";
import {
  BLOCKS, DEFAULT_LAYOUT, moveBlock, sameLayout, setHidden, setSpan, shiftBlock,
  type BlockId, type DashboardLayout, type Span,
} from "@/lib/core/dashboard-layout";

// Classes literais (o Tailwind só gera o que aparece escrito no código).
const SPAN_CLASS: Record<Span, string> = {
  4: "md:col-span-6 xl:col-span-4",
  6: "md:col-span-6 xl:col-span-6",
  8: "md:col-span-12 xl:col-span-8",
  12: "md:col-span-12 xl:col-span-12",
};
const SPAN_OPTIONS: { span: Span; label: string; title: string }[] = [
  { span: 4, label: "⅓", title: "Um terço da largura" },
  { span: 6, label: "½", title: "Metade da largura" },
  { span: 8, label: "⅔", title: "Dois terços da largura" },
  { span: 12, label: "▭", title: "Largura inteira" },
];

/**
 * Grade do Resumo com modo edição: arrastar (mouse) ou setas (teclado/toque) para reordenar, largura em ⅓ ½ ⅔ inteira,
 * ocultar e reexibir blocos. Os blocos chegam prontos do servidor; aqui só muda a posição.
 * No celular todo bloco ocupa a largura inteira (na ordem salva); no tablet, até dois por linha.
 */
export function EditableDashboard({ blocks, initial, page = "resumo" }: { blocks: Partial<Record<BlockId, ReactNode>>; initial: DashboardLayout; page?: string }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [dragging, setDragging] = useState<BlockId | null>(null);
  const [over, setOver] = useState<BlockId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editing = draft != null;
  const layout = (draft ?? saved).filter((item) => blocks[item.id] != null);
  const hidden = layout.filter((item) => item.hidden);
  const visible = layout.filter((item) => !item.hidden);

  const update = (fn: (current: DashboardLayout) => DashboardLayout) => setDraft((current) => fn(current ?? saved));
  const save = () => {
    if (!draft) return;
    setError(null);
    startTransition(async () => {
      const result = await saveDashboardLayout(page, draft);
      if (!result.ok) { setError(result.error ?? "Erro ao salvar."); return; }
      setSaved(draft);
      setDraft(null);
    });
  };
  const onDrop = (event: DragEvent, target: BlockId) => {
    event.preventDefault();
    const id = (event.dataTransfer.getData("text/plain") || dragging) as BlockId | null;
    if (id && id !== target) update((current) => moveBlock(current, id, target));
    setDragging(null);
    setOver(null);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {editing ? (
          <>
            <span className="mr-auto text-xs text-copy-muted">Arraste pela alça <b className="text-copy">⠿</b> (ou use as setas), escolha a largura e oculte o que não usa.</span>
            {error && <span className="text-xs text-danger-accessible">{error}</span>}
            <button type="button" onClick={() => setDraft(DEFAULT_LAYOUT.map((item) => ({ ...item })))} className="h-[30px] rounded px-2.5 text-xs font-semibold text-copy hover:bg-surface-hover">Restaurar padrão</button>
            <button type="button" onClick={() => { setDraft(null); setError(null); }} className="h-[30px] rounded px-2.5 text-xs font-semibold text-copy ring-1 ring-input-border hover:bg-surface-hover">Cancelar</button>
            <button type="button" disabled={pending || sameLayout(draft, saved)} onClick={save} className="h-[30px] rounded bg-primary px-3 text-xs font-semibold text-white hover:bg-[var(--primary-hover)] disabled:opacity-50">{pending ? "Salvando..." : "Salvar layout"}</button>
          </>
        ) : (
          <button type="button" onClick={() => setDraft(saved.map((item) => ({ ...item })))} className="inline-flex h-[30px] items-center gap-1.5 rounded px-2.5 text-xs font-semibold text-copy ring-1 ring-input-border hover:bg-surface-hover">
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z" /></svg>
            Editar painel
          </button>
        )}
      </div>

      {editing && hidden.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-input-border px-3 py-2 text-xs">
          <span className="text-copy-muted">Ocultos:</span>
          {hidden.map((item) => (
            <button key={item.id} type="button" onClick={() => update((current) => setHidden(current, item.id, false))} className="rounded bg-surface-hover px-2 py-1 font-semibold text-copy hover:text-white">+ {BLOCKS[item.id]}</button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-[19px] md:grid-cols-12">
        {visible.map((item, index) => (
          <div
            key={item.id}
            className={`relative flex min-w-0 flex-col ${SPAN_CLASS[item.span]} ${editing ? "rounded-md outline-2 outline-dashed outline-offset-4" : ""} ${editing ? (over === item.id && dragging !== item.id ? "outline-primary" : "outline-input-border") : ""} ${dragging === item.id ? "opacity-50" : ""}`}
            onDragOver={editing ? (event) => { event.preventDefault(); setOver(item.id); } : undefined}
            onDragLeave={editing ? () => setOver((current) => (current === item.id ? null : current)) : undefined}
            onDrop={editing ? (event) => onDrop(event, item.id) : undefined}
          >
            {editing && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-app-bg px-2 py-1.5 text-xs">
                <span
                  draggable
                  onDragStart={(event) => { event.dataTransfer.setData("text/plain", item.id); event.dataTransfer.effectAllowed = "move"; setDragging(item.id); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  className="cursor-grab select-none rounded px-1.5 text-base leading-none text-copy hover:bg-surface-hover active:cursor-grabbing"
                  title="Arraste para mover" aria-hidden
                >⠿</span>
                <b className="mr-auto truncate text-copy-strong">{BLOCKS[item.id]}</b>
                <button type="button" disabled={index === 0} onClick={() => update((current) => shiftBlock(current, item.id, -1))} aria-label={`Subir ${BLOCKS[item.id]}`} className="rounded px-1.5 py-0.5 text-copy hover:bg-surface-hover disabled:opacity-30">↑</button>
                <button type="button" disabled={index === visible.length - 1} onClick={() => update((current) => shiftBlock(current, item.id, 1))} aria-label={`Descer ${BLOCKS[item.id]}`} className="rounded px-1.5 py-0.5 text-copy hover:bg-surface-hover disabled:opacity-30">↓</button>
                <span role="group" aria-label="Largura" className="hidden overflow-hidden rounded ring-1 ring-input-border xl:inline-flex">
                  {SPAN_OPTIONS.map((option) => (
                    <button key={option.span} type="button" title={option.title} aria-pressed={item.span === option.span} onClick={() => update((current) => setSpan(current, item.id, option.span))} className={`px-2 py-0.5 font-semibold ${item.span === option.span ? "bg-primary text-white" : "text-copy hover:bg-surface-hover"}`}>{option.label}</button>
                  ))}
                </span>
                <button type="button" onClick={() => update((current) => setHidden(current, item.id, true))} className="rounded px-1.5 py-0.5 text-copy hover:bg-surface-hover" title="Ocultar bloco">Ocultar</button>
              </div>
            )}
            <div className={`flex-1 [&>section]:h-full ${editing ? "pointer-events-none select-none" : ""}`}>{blocks[item.id]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
