import "server-only";
import type { Db } from "../supabase/types";
import { addDays } from "../core/dates";

// Câmbio diário oficial: PTAX de fechamento (venda) do Banco Central, sem IOF.
// Fins de semana e feriados usam o último dia útil anterior (ver utmfy.fx_for).

const BCB = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";

type PtaxRow = { cotacaoVenda: number; dataHoraCotacao: string; tipoBoletim: string };

const bcbDate = (iso: string) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;

export async function fetchPtax(currency: string, from: string, to: string): Promise<{ date: string; rate: number }[]> {
  const fn =
    currency === "USD"
      ? `CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@dataInicial='${bcbDate(from)}'&@dataFinalCotacao='${bcbDate(to)}'`
      : `CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?@moeda='${currency}'&@dataInicial='${bcbDate(from)}'&@dataFinalCotacao='${bcbDate(to)}'`;
  const res = await fetch(`${BCB}/${fn}&$format=json&$top=10000`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`PTAX ${currency}: HTTP ${res.status}`);
  const json = (await res.json()) as { value?: (PtaxRow & { tipoBoletim?: string })[] };
  const out = new Map<string, number>();
  for (const r of json.value ?? []) {
    // CotacaoDolarPeriodo só traz o fechamento (sem tipoBoletim); a de moedas traz todos os boletins.
    if (r.tipoBoletim && r.tipoBoletim !== "Fechamento") continue;
    out.set(r.dataHoraCotacao.slice(0, 10), Number(r.cotacaoVenda));
  }
  return [...out.entries()].map(([date, rate]) => ({ date, rate })).filter((r) => r.rate > 0);
}

/** Garante cotações BRL para a moeda no período (com folga de 7 dias para trás). */
export async function ensureFxRates(db: Db, currency: string, from: string, to: string) {
  if (!/^[A-Z]{3}$/.test(currency) || currency === "BRL") return { fetched: 0 };
  const rows = await fetchPtax(currency, addDays(from, -7), to);
  if (!rows.length) return { fetched: 0 };
  const { error } = await db
    .from("fx_rates")
    .upsert(rows.map((r) => ({ currency, date: r.date, rate: r.rate, source: "bcb_ptax", fetched_at: new Date().toISOString() })), { onConflict: "currency,date" });
  if (error) throw new Error(`fx_rates: ${error.message}`);
  return { fetched: rows.length };
}
