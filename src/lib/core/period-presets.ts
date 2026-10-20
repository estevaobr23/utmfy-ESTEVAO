// Sem "use client": precisa ser importável tanto por Server Components (ex.: meta-ads.tsx,
// que faz PERIOD_PRESETS.find(...) no servidor) quanto pelo client component PeriodControl.
// Reexportar uma const de um módulo "use client" para o lado do servidor quebra a
// serialização RSC (virou "t.find is not a function" em produção — bug real já visto aqui).
export const PERIOD_PRESETS: [string, string][] = [
  ["today", "Hoje"], ["yesterday", "Ontem"], ["7d", "Últimos 7 dias"], ["14d", "Últimos 14 dias"],
  ["30d", "Últimos 30 dias"], ["month", "Este mês"], ["last_month", "Mês passado"],
];
