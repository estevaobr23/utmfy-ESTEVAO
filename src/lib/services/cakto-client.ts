import "server-only";
import { env } from "../env";

// Cliente da API pública da Cakto (https://docs.cakto.com.br/authentication).
//  * OAuth2 client_credentials em POST /public_api/token/ (form-urlencoded)
//  * token dura ~10 h → reutilizado até 60 s antes de expirar
//  * limite de emissão: 20/min por IP → nunca pedimos token por chamada
//  * 429 → respeita Retry-After; 5xx/timeout → backoff exponencial
//  * paginação: page (1..n) + limit (pedidos: teto 500), envelope {count,next,results}

type TokenCache = { token: string; expiresAt: number } | null;
let cache: TokenCache = null;
let inflight: Promise<string> | null = null;

export class CaktoApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function caktoConfigured() {
  return !!env.caktoClientId && !!env.caktoClientSecret;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function issueToken(): Promise<string> {
  if (!caktoConfigured()) throw new CaktoApiError(0, "not_configured", "CAKTO_CLIENT_ID/CAKTO_CLIENT_SECRET ausentes");
  const res = await fetchWithTimeout(`${env.caktoApiBase}/public_api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.caktoClientId, client_secret: env.caktoClientSecret }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new CaktoApiError(res.status, json.error ?? "token_failed", `Falha ao obter token Cakto (HTTP ${res.status}${json.error ? `: ${json.error}` : ""})`);
  }
  cache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 36000) * 1000 };
  return json.access_token;
}

export async function getToken(force = false): Promise<string> {
  if (!force && cache && cache.expiresAt - 60_000 > Date.now()) return cache.token;
  inflight ??= issueToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function caktoGet<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${env.caktoApiBase}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  let attempt = 0;
  let refreshed = false;
  for (;;) {
    attempt++;
    const token = await getToken();
    let res: Response;
    try {
      res = await fetchWithTimeout(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    } catch (e) {
      if (attempt >= 4) throw new CaktoApiError(0, "network", `Erro de rede na Cakto: ${(e as Error).message}`);
      await sleep(2 ** attempt * 500);
      continue;
    }
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      cache = null;
      continue;
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? 0);
      if (attempt >= 4 || retry > 120) throw new CaktoApiError(429, "rate_limited", `Rate limit da Cakto (retry-after ${retry}s)`);
      await sleep(Math.max(retry, 2 ** attempt) * 1000);
      continue;
    }
    if (res.status >= 500) {
      if (attempt >= 4) throw new CaktoApiError(res.status, "server_error", `Cakto respondeu HTTP ${res.status}`);
      await sleep(2 ** attempt * 500);
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = (json as { detail?: string } | null)?.detail ?? `HTTP ${res.status}`;
      throw new CaktoApiError(res.status, res.status === 403 ? "forbidden" : "request_failed", `Cakto: ${detail}`.slice(0, 300));
    }
    return json as T;
  }
}

type Page<T> = { count: number; next: string | null; results: T[] };

/** Percorre todas as páginas (com teto de segurança). */
export async function caktoListAll<T>(path: string, query: Record<string, string | number | undefined>, opts: { limit?: number; maxPages?: number } = {}) {
  const limit = opts.limit ?? 100;
  const maxPages = opts.maxPages ?? 200;
  const out: T[] = [];
  let page = 1;
  let total = 0;
  for (; page <= maxPages; page++) {
    const r = await caktoGet<Page<T>>(path, { ...query, page, limit });
    total = r.count ?? total;
    out.push(...(r.results ?? []));
    if (!r.next || (r.results ?? []).length === 0) break;
  }
  return { items: out, total, truncated: page > maxPages };
}

export type CaktoProduct = { id: string; name: string; status?: string; short_id?: string };
export type CaktoOffer = { id: string; name: string; price?: number; product?: string | { id: string }; status?: string };

export type CaktoWebhook = {
  id: number;
  name: string;
  url: string | null;
  status?: string;
  products?: ({ id: string; name?: string } | string)[];
  fields?: { secret?: string } | null;
};

export const caktoApi = {
  listWebhooks: () => caktoListAll<CaktoWebhook>("/public_api/webhook/", {}, { limit: 100, maxPages: 10 }),
  listOrders: (q: Record<string, string | number | undefined>) => caktoListAll<Record<string, unknown>>("/public_api/orders/", q, { limit: 100 }),
  getOrder: (id: string) => caktoGet<Record<string, unknown>>(`/public_api/orders/${encodeURIComponent(id)}/`),
  listProducts: () => caktoListAll<CaktoProduct>("/public_api/products/", {}, { limit: 100, maxPages: 20 }),
  listOffers: (productId?: string) => caktoListAll<CaktoOffer>("/public_api/offers/", { product: productId }, { limit: 100, maxPages: 20 }),
};

/** Só para testes. */
export function __resetCaktoTokenCache() {
  cache = null;
  inflight = null;
}
