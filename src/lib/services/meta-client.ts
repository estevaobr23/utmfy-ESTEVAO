import "server-only";
import { createHmac } from "node:crypto";
import { classifyMetaError, type MetaErrorKind } from "../core/meta";
import { env } from "../env";

// Cliente READ-ONLY da Graph/Marketing API. Por design só expõe GET e a
// criação/leitura de relatórios assíncronos de insights (POST /insights, que
// NÃO altera campanhas). Não existe método para editar campanhas/anúncios.

export class MetaApiError extends Error {
  constructor(public kind: MetaErrorKind, public code: number | null, message: string, public status: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Throttle = { appPct: number | null; accPct: number | null; bucPct: number | null };

function parseThrottle(h: Headers): Throttle {
  const out: Throttle = { appPct: null, accPct: null, bucPct: null };
  try {
    const ins = h.get("x-fb-ads-insights-throttle");
    if (ins) {
      const j = JSON.parse(ins);
      out.appPct = Number(j.app_id_util_pct ?? null);
      out.accPct = Number(j.acc_id_util_pct ?? null);
    }
    const buc = h.get("x-business-use-case-usage");
    if (buc) {
      const j = JSON.parse(buc) as Record<string, { call_count?: number; total_time?: number; total_cputime?: number }[]>;
      const vals = Object.values(j).flat().map((x) => Math.max(x.call_count ?? 0, x.total_time ?? 0, x.total_cputime ?? 0));
      out.bucPct = vals.length ? Math.max(...vals) : null;
    }
  } catch {
    /* headers malformados não interrompem */
  }
  return out;
}

export class MetaClient {
  lastThrottle: Throttle = { appPct: null, accPct: null, bucPct: null };
  constructor(private token: string, private version = env.metaGraphVersion) {}

  private proof() {
    return env.metaAppSecret ? createHmac("sha256", env.metaAppSecret).update(this.token).digest("hex") : null;
  }

  private async request<T>(method: "GET" | "POST", path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const isAbs = path.startsWith("https://");
    const url = new URL(isAbs ? path : `https://graph.facebook.com/${this.version}/${path.replace(/^\//, "")}`);
    const body = new URLSearchParams();
    const target = method === "GET" ? url.searchParams : body;
    for (const [k, v] of Object.entries(params)) if (v !== undefined) target.set(k, String(v));
    if (!isAbs || !url.searchParams.has("access_token")) {
      // O token vai no corpo/query da própria requisição — nunca é logado.
      (method === "GET" ? url.searchParams : body).set("access_token", this.token);
      const p = this.proof();
      if (p) (method === "GET" ? url.searchParams : body).set("appsecret_proof", p);
    }

    for (let attempt = 1; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          method,
          body: method === "POST" ? body : undefined,
          signal: ctrl.signal,
          cache: "no-store",
        });
      } catch (e) {
        clearTimeout(timer);
        if (attempt >= 4) throw new MetaApiError("transient", null, `Erro de rede: ${(e as Error).message}`, 0);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      clearTimeout(timer);
      this.lastThrottle = parseThrottle(res.headers);
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json as T;
      const err = classifyMetaError(res.status, json);
      if ((err.kind === "rate_limited" || err.kind === "transient") && attempt < 4) {
        await sleep(err.kind === "rate_limited" ? 15000 * attempt : 1000 * 2 ** attempt);
        continue;
      }
      throw new MetaApiError(err.kind, err.code, err.message, res.status);
    }
  }

  get<T>(path: string, params: Record<string, string | number | undefined> = {}) {
    return this.request<T>("GET", path, params);
  }

  /** Escrita na Graph (ex.: orçamento). Só use a partir de ação explícita do usuário. */
  post<T>(path: string, params: Record<string, string | number | undefined> = {}) {
    return this.request<T>("POST", path, params);
  }

  /** Percorre `paging.next` (URLs absolutas da Graph) com teto de páginas. */
  async getAll<T>(path: string, params: Record<string, string | number | undefined>, maxPages = 100): Promise<T[]> {
    const out: T[] = [];
    let page = await this.get<{ data?: T[]; paging?: { next?: string } }>(path, params);
    out.push(...(page.data ?? []));
    for (let i = 1; i < maxPages && page.paging?.next; i++) {
      page = await this.get(page.paging.next);
      out.push(...(page.data ?? []));
    }
    return out;
  }

  /** Relatório assíncrono (recomendado pela Meta para períodos/volumes grandes). */
  async insightsAsync<T>(accountId: string, params: Record<string, string | number | undefined>, maxWaitMs = 240000): Promise<T[]> {
    const run = await this.request<{ report_run_id?: string }>("POST", `act_${accountId}/insights`, params);
    if (!run.report_run_id) throw new MetaApiError("unknown", null, "report_run_id ausente", 0);
    const started = Date.now();
    for (let i = 0; ; i++) {
      await sleep(Math.min(2000 + i * 1000, 10000));
      const st = await this.get<{ async_status?: string; async_percent_completion?: number }>(run.report_run_id, { fields: "async_status,async_percent_completion" });
      if (st.async_status === "Job Completed") break;
      if (st.async_status === "Job Failed" || st.async_status === "Job Skipped") {
        throw new MetaApiError("transient", null, `Relatório assíncrono: ${st.async_status}`, 0);
      }
      if (Date.now() - started > maxWaitMs) throw new MetaApiError("transient", null, "Relatório assíncrono demorou demais", 0);
    }
    return this.getAll<T>(`${run.report_run_id}/insights`, { limit: 500 });
  }
}
