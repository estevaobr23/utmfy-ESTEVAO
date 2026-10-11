// Diz se o gasto Meta de um período é confiável. Sem isso, "gasto ausente"
// viraria R$ 0 e o lucro/ROAS/CPA pareceriam reais. Função pura (testável).
import { addDays } from "./dates";

export type SpendState = "ok" | "no_accounts" | "error" | "not_synced" | "fx_missing";

export type SpendStatus = { state: SpendState; reliable: boolean; message: string | null };

export type SpendStatusInput = {
  /** Contas que compõem o gasto deste relatório (monitoradas, ou as da oferta). */
  accounts: { account_id: string; last_error: string | null }[];
  /** Janelas [since, until] das sincronizações Meta concluídas (success/partial). */
  syncedWindows: { since: string; until: string }[];
  /** Gasto deixado de fora por falta de câmbio no período. */
  excluded: { account_id: string; currency: string; spend: number }[];
  from: string;
  to: string;
  today: string;
};

function missingDays(from: string, to: string, windows: SpendStatusInput["syncedWindows"]) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!windows.some((w) => w.since <= d && d <= w.until)) out.push(d);
  }
  return out;
}

export function spendStatus(i: SpendStatusInput): SpendStatus {
  if (!i.accounts.length) {
    return { state: "no_accounts", reliable: false, message: "Nenhuma conta Meta vinculada: o gasto é desconhecido, então lucro, ROAS e CPA não são calculados." };
  }
  const failing = i.accounts.filter((a) => a.last_error);
  if (failing.length) {
    return {
      state: "error",
      reliable: false,
      message: `Falha na sincronização da Meta (${failing.map((a) => `act_${a.account_id}`).join(", ")}): ${failing[0].last_error}`,
    };
  }
  const end = i.to < i.today ? i.to : i.today;
  const missing = i.from <= end ? missingDays(i.from, end, i.syncedWindows) : [];
  if (missing.length) {
    const sample = missing.length > 3 ? `${missing[0]} … ${missing[missing.length - 1]}` : missing.join(", ");
    return {
      state: "not_synced",
      reliable: false,
      message: `Gasto da Meta ainda não sincronizado em ${missing.length} dia(s) do período (${sample}).`,
    };
  }
  if (i.excluded.length) {
    return {
      state: "fx_missing",
      reliable: false,
      message: `Gasto em moeda estrangeira sem câmbio disponível: ${i.excluded.map((e) => `act_${e.account_id} ${e.currency} ${Number(e.spend).toFixed(2)}`).join(" · ")}.`,
    };
  }
  return { state: "ok", reliable: true, message: null };
}
