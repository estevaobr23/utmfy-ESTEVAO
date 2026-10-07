// Datas "de calendário" num fuso específico (padrão America/Sao_Paulo).

export const DEFAULT_TZ = "America/Sao_Paulo";

export function todayIn(tz = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}

export type DatePreset = "today" | "yesterday" | "7d" | "14d" | "30d" | "month" | "custom";

export function resolveRange(
  params: { preset?: string; from?: string; to?: string },
  tz = DEFAULT_TZ,
  now = new Date(),
): { from: string; to: string; preset: DatePreset } {
  const today = todayIn(tz, now);
  if (isIsoDate(params.from) && isIsoDate(params.to) && params.from <= params.to) {
    return { from: params.from, to: params.to, preset: "custom" };
  }
  switch (params.preset) {
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1), preset: "yesterday" };
    case "7d": return { from: addDays(today, -6), to: today, preset: "7d" };
    case "14d": return { from: addDays(today, -13), to: today, preset: "14d" };
    case "30d": return { from: addDays(today, -29), to: today, preset: "30d" };
    case "month": return { from: `${today.slice(0, 8)}01`, to: today, preset: "month" };
    default: return { from: today, to: today, preset: "today" };
  }
}

export function formatDateTime(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(d);
}

export function timeAgo(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "nunca";
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `há ${Math.max(s, 0)} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}

/** Deslocamento (ms) do fuso tz no instante d: local − UTC. */
function tzOffsetMs(d: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Instante UTC da meia-noite local de `iso` no fuso tz. */
export function startOfDayUtc(iso: string, tz = DEFAULT_TZ): Date {
  const guess = new Date(`${iso}T00:00:00Z`);
  let t = guess.getTime() - tzOffsetMs(guess, tz);
  t = guess.getTime() - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** [início, fim) em UTC para os dias from..to (inclusive) no fuso tz. */
export function dayRangeUtc(from: string, to: string, tz = DEFAULT_TZ): { start: string; end: string } {
  return { start: startOfDayUtc(from, tz).toISOString(), end: startOfDayUtc(addDays(to, 1), tz).toISOString() };
}
