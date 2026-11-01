// Layout editável do Resumo: ordem, largura (em 12 colunas) e visibilidade de cada bloco.
// Puro e testado; o servidor só guarda o JSON (utmfy.dashboard_layouts) e o navegador só reorganiza.

export const BLOCKS = {
  kpis: "Indicadores (KPIs)",
  funnel: "Funil de conversão",
  "hourly-profit": "Lucro por horário",
  payment: "Vendas por pagamento",
  product: "Vendas por produto",
  approval: "Taxa de aprovação",
  source: "Vendas por fonte",
  "hourly-financial": "Faturamento × Investimento × Lucro",
} as const;

export type BlockId = keyof typeof BLOCKS;
export const SPANS = [4, 6, 8, 12] as const;
export type Span = (typeof SPANS)[number];
export type LayoutItem = { id: BlockId; span: Span; hidden: boolean };
export type DashboardLayout = LayoutItem[];

/** Padrão no espírito da UTMify: KPIs, funil e lucro por hora em largura inteira; três cartões lado a lado; fonte e acumulado. */
export const DEFAULT_LAYOUT: DashboardLayout = [
  { id: "kpis", span: 12, hidden: false },
  { id: "funnel", span: 12, hidden: false },
  { id: "hourly-profit", span: 12, hidden: false },
  { id: "payment", span: 4, hidden: false },
  { id: "product", span: 4, hidden: false },
  { id: "approval", span: 4, hidden: false },
  { id: "source", span: 12, hidden: false },
  { id: "hourly-financial", span: 12, hidden: false },
];

const isBlock = (value: unknown): value is BlockId => typeof value === "string" && Object.hasOwn(BLOCKS, value);
const isSpan = (value: unknown): value is Span => SPANS.includes(value as Span);

/**
 * Aceita qualquer coisa vinda do banco ou do navegador e devolve um layout válido:
 * descarta bloco desconhecido ou repetido, corrige largura inválida e acrescenta (na posição padrão) bloco novo que o
 * layout salvo ainda não conhecia — assim um bloco criado depois aparece sozinho para quem já tinha salvo.
 */
export function normalizeLayout(raw: unknown): DashboardLayout {
  if (!Array.isArray(raw)) return DEFAULT_LAYOUT.map((item) => ({ ...item }));
  const seen = new Set<BlockId>();
  const out: DashboardLayout = [];
  for (const entry of raw.slice(0, 50)) {
    if (!entry || typeof entry !== "object") continue;
    const { id, span, hidden } = entry as Record<string, unknown>;
    if (!isBlock(id) || seen.has(id)) continue;
    seen.add(id);
    const fallback = DEFAULT_LAYOUT.find((item) => item.id === id)!;
    out.push({ id, span: isSpan(span) ? span : fallback.span, hidden: hidden === true });
  }
  DEFAULT_LAYOUT.forEach((item, index) => {
    if (seen.has(item.id)) return;
    out.splice(Math.min(index, out.length), 0, { ...item });
  });
  return out;
}

/** Move o bloco `id` para a posição de `targetId` (antes dele se vier de baixo, depois se vier de cima). */
export function moveBlock(layout: DashboardLayout, id: BlockId, targetId: BlockId): DashboardLayout {
  const from = layout.findIndex((item) => item.id === id);
  const to = layout.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return layout;
  const next = [...layout];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Sobe (-1) ou desce (+1) um bloco entre os visíveis (alternativa ao arrastar, para teclado e toque). */
export function shiftBlock(layout: DashboardLayout, id: BlockId, delta: -1 | 1): DashboardLayout {
  const visible = layout.filter((item) => !item.hidden);
  const index = visible.findIndex((item) => item.id === id);
  const target = visible[index + delta];
  return target ? moveBlock(layout, id, target.id) : layout;
}

export const setSpan = (layout: DashboardLayout, id: BlockId, span: Span): DashboardLayout =>
  layout.map((item) => (item.id === id ? { ...item, span } : item));

export const setHidden = (layout: DashboardLayout, id: BlockId, hidden: boolean): DashboardLayout =>
  layout.map((item) => (item.id === id ? { ...item, hidden } : item));

export const sameLayout = (a: DashboardLayout, b: DashboardLayout) => JSON.stringify(a) === JSON.stringify(b);
