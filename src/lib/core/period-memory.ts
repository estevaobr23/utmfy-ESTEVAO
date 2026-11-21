// Período (filtro de datas) lembrado entre telas, ofertas e reaberturas do navegador.
// Só o período viaja; os demais filtros (campanha, conta, status…) continuam presos à URL da tela.
// Módulo puro: usado no servidor (leitura do cookie) e no cliente (gravação ao enviar o filtro).

export const PERIOD_COOKIE = "utmfy_period";
export const PERIOD_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const PRESETS = new Set(["today", "yesterday", "7d", "14d", "30d", "month", "last_month"]);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export type SavedPeriod = { preset: string } | { from: string; to: string };

/** "7d" ou "2026-11-01_2026-11-20". Valor inválido → null (não grava lixo). */
export function encodePeriod(p: { preset?: string | null; from?: string | null; to?: string | null }): string | null {
  if (p.from && p.to && ISO.test(p.from) && ISO.test(p.to) && p.from <= p.to && (p.preset === "custom" || !p.preset)) return `${p.from}_${p.to}`;
  if (p.preset && PRESETS.has(p.preset)) return p.preset;
  return null;
}

export function decodePeriod(value: string | null | undefined): SavedPeriod | null {
  const v = (value ?? "").trim();
  if (PRESETS.has(v)) return { preset: v };
  const m = v.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (m && m[1] <= m[2]) return { from: m[1], to: m[2] };
  return null;
}

/** A URL já escolheu um período? (preset ou intervalo De/Até) */
export const urlHasPeriod = (sp: SP) => !!(first(sp.preset) || (first(sp.from) && first(sp.to)));

/** Parâmetros da tela + período lembrado quando a URL não traz período. A URL sempre vence. */
export function withPeriod(sp: SP, cookieValue: string | null | undefined): SP {
  if (urlHasPeriod(sp)) return sp;
  const saved = decodePeriod(cookieValue);
  if (!saved) return sp;
  return "preset" in saved ? { ...sp, preset: saved.preset } : { ...sp, preset: "custom", from: saved.from, to: saved.to };
}
