import "server-only";
import type { HotmartApiCommission, HotmartApiSale } from "../core/hotmart/api-order";

// Cliente da API pública da Hotmart (SÓ LEITURA de vendas). OAuth "client_credentials" com Client ID + Client Secret
// (Hotmart → Ferramentas → Credenciais → API Hotmart; sandbox DESLIGADO, senão as vendas vêm sem UTM).
// Os valores ficam só em variáveis de ambiente do servidor (HOTMART_CLIENT_ID / HOTMART_CLIENT_SECRET).

const TOKEN_URL = "https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials";
const API = "https://developers.hotmart.com/payments/api/v1/sales";

export const hotmartApiConfigured = () => !!(process.env.HOTMART_CLIENT_ID && process.env.HOTMART_CLIENT_SECRET);

export class HotmartApiError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const basic = Buffer.from(`${process.env.HOTMART_CLIENT_ID ?? ""}:${process.env.HOTMART_CLIENT_SECRET ?? ""}`).toString("base64");
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { Authorization: `Basic ${basic}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) throw new HotmartApiError(`token HTTP ${res.status}${j.error ? `: ${j.error}` : ""}`, res.status);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function list<T>(path: string, params: Record<string, string | number>, maxPages = 10): Promise<T[]> {
  const token = await accessToken();
  const out: T[] = [];
  let page = "";
  for (let i = 0; i < maxPages; i++) {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), max_results: "100" });
    if (page) q.set("page_token", page);
    const res = await fetch(`${API}/${path}?${q}`, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const j = (await res.json().catch(() => ({}))) as { items?: T[]; page_info?: { next_page_token?: string } };
    if (!res.ok) {
      if (res.status === 401) cached = null;
      throw new HotmartApiError(`${path} HTTP ${res.status}`, res.status);
    }
    out.push(...(j.items ?? []));
    page = j.page_info?.next_page_token ?? "";
    if (!page) break;
  }
  return out;
}

export const hotmartApi = {
  /** Histórico de vendas de uma janela (epoch ms). Sem `status`, a Hotmart devolve só as aprovadas/completas. */
  history: (fromMs: number, toMs: number, status?: string) =>
    list<HotmartApiSale>("history", { start_date: fromMs, end_date: toMs, ...(status ? { transaction_status: status } : {}) }),
  commissions: (fromMs: number, toMs: number) => list<HotmartApiCommission>("commissions", { start_date: fromMs, end_date: toMs }),
};
