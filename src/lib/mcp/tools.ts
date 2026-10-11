import "server-only";
import { addDays, todayIn } from "@/lib/core/dates";
import { envStatus } from "@/lib/env";
import { loadReport, parseFilters } from "@/lib/queries";
import { syncCaktoOrders } from "@/lib/services/cakto-sync";
import { processDispatches, retryDispatch } from "@/lib/services/capi-dispatch";
import { sanitize } from "@/lib/services/logs";
import { syncMeta } from "@/lib/services/meta-sync";
import { reattributePending } from "@/lib/services/orders";
import type { Workspace } from "@/lib/session";
import { adminClient } from "@/lib/supabase/admin";
import { listFiles, readText, searchCode } from "./files";

type Args = Record<string, unknown>;
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
  run: (a: Args) => Promise<unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 120_000;
const REPO = "https://github.com/estevaobr23/utmfy-ESTEVAO/blob/main";
const TABLES = [
  "workspaces", "workspace_members", "offers", "offer_cakto_items", "cakto_connections", "meta_connections",
  "meta_ad_accounts", "offer_ad_accounts", "meta_ads", "pixels", "offer_pixels", "orders", "order_status_history",
  "order_attribution", "webhook_events", "meta_insights_daily", "tracking_sessions", "conversion_dispatches",
  "integration_logs", "sync_jobs", "reconciliation_changes", "cost_rules",
];

const db = () => adminClient();
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const int = (v: unknown, def: number, max: number) => {
  const x = Number(v);
  return Math.min(Math.max(v == null || !Number.isFinite(x) ? def : Math.trunc(x), 1), max);
};
const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : undefined);

function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

async function workspace(ref?: unknown): Promise<Workspace> {
  const key = str(ref);
  let q = db().from("workspaces").select("id, name, slug, is_demo, timezone, currency");
  if (key) q = UUID.test(key) ? q.eq("id", key) : q.eq("slug", key);
  const list = must(await q.order("created_at")) as Workspace[];
  if (key) {
    if (!list[0]) throw new Error(`workspace não encontrado: ${key}`);
    return list[0];
  }
  const real = list.filter((w) => !w.is_demo);
  const ws = real.find((w) => w.slug === "principal") ?? real[0] ?? list[0];
  if (!ws) throw new Error("nenhum workspace cadastrado");
  return ws;
}

const sqlText = (v: unknown) => {
  const q = str(v)?.replace(/;+\s*$/, "");
  if (!q) throw new Error("informe o SQL");
  return q;
};

async function sqlQuery(q: string, maxRows = 500) {
  return must(await db().rpc("mcp_query", { q, max_rows: maxRows }));
}

async function orderDetail(id: string) {
  let q = db().from("orders").select("*, order_attribution(*)");
  q = UUID.test(id) ? q.eq("id", id) : q.eq("external_order_id", id);
  const orders = must(await q.limit(5)) as { id: string; external_order_id: string; workspace_id: string }[];
  if (!orders.length) throw new Error(`pedido não encontrado: ${id}`);
  return Promise.all(
    orders.map(async (o) => {
      const [history, events, dispatches, recon] = await Promise.all([
        db().from("order_status_history").select("*").eq("order_id", o.id).order("created_at"),
        db().from("webhook_events").select("*").eq("workspace_id", o.workspace_id).eq("external_order_id", o.external_order_id).order("received_at"),
        db().from("conversion_dispatches").select("*").eq("order_id", o.id),
        db().from("reconciliation_changes").select("*").eq("order_id", o.id).order("created_at"),
      ]);
      return { order: o, status_history: history.data, webhook_events: events.data, conversion_dispatches: dispatches.data, reconciliation_changes: recon.data };
    }),
  );
}

const wsProp = { workspace: { type: "string", description: "Slug ou id do workspace (padrão: 'principal')." } };
const limitProp = (def: number, max: number) => ({ type: "integer", minimum: 1, maximum: max, default: def });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

export const TOOLS: Tool[] = [
  {
    name: "project_overview",
    title: "Visão geral do projeto",
    description: "Ponto de partida: arquitetura, workspaces, volume de dados por tabela, variáveis de ambiente configuradas (só sim/não), documentos e rotas do app.",
    inputSchema: obj({}),
    annotations: READ,
    run: async () => {
      const [workspaces, counts, files] = await Promise.all([
        db().from("workspaces").select("id, name, slug, is_demo, timezone, currency, created_at"),
        Promise.all(TABLES.map(async (t) => [t, (await db().from(t).select("*", { count: "exact", head: true })).count ?? 0] as const)),
        listFiles(),
      ]);
      return {
        stack: "Next.js 16 (App Router, src/) na Vercel + Supabase Postgres (schema 'utmfy' dentro do projeto casas-sobrados-membros, sa-east-1).",
        fluxo: [
          "Venda: Cakto → POST /api/webhooks/cakto?ws=<slug> (HMAC) → utmfy.webhook_events → utmfy.upsert_order (máquina de estados) → utmfy.orders + order_status_history.",
          "Atribuição: UTMs do pedido + sessão do tracker (public/t.js → /api/track → utmfy.tracking_sessions) → utmfy.order_attribution (EXACT_ID, UTM_PARSED, NAME_MATCH, ORGANIC...).",
          "Gasto: Meta Marketing API (read-only) → utmfy.meta_ads + meta_insights_daily, via syncMeta.",
          "Relatórios: RPCs report_spend_rows/report_order_rows; métricas derivadas (ROAS, CPA) em src/lib/core/metrics.ts.",
          "Rotinas: Vercel Cron /api/cron/all (meta-sync, cakto-reconcile, capi-dispatch).",
          "CAPI (Conversions API) preparado, desligado por CAPI_ENABLED.",
        ],
        workspaces: workspaces.data,
        linhas_por_tabela: Object.fromEntries(counts),
        env: envStatus(),
        documentos: files.filter((f) => f.endsWith(".md") && !f.includes("/")),
        rotas: files.filter((f) => /^src\/app\/.*\/(route|page)\.tsx?$/.test(f)),
      };
    },
  },
  {
    name: "list_files",
    title: "Listar arquivos do código",
    description: "Lista os arquivos do repositório disponíveis (src, supabase/migrations, supabase/sql, scripts, tests, public e docs da raiz). Filtre por pasta.",
    inputSchema: obj({ path: { type: "string", description: "Prefixo de pasta, ex.: 'src/lib/services'." } }),
    annotations: READ,
    run: async (a) => listFiles(str(a.path)),
  },
  {
    name: "read_file",
    title: "Ler arquivo do código",
    description: "Lê um arquivo do repositório com números de linha. Use start_line/end_line para arquivos grandes.",
    inputSchema: obj({ path: { type: "string" }, start_line: { type: "integer", minimum: 1 }, end_line: { type: "integer", minimum: 1 } }, ["path"]),
    annotations: READ,
    run: async (a) => readText(str(a.path) ?? "", a.start_line as number | undefined, a.end_line as number | undefined),
  },
  {
    name: "search_code",
    title: "Buscar no código",
    description: "Busca um texto (ou regex) em todos os arquivos do repositório. Retorna 'arquivo:linha: trecho'.",
    inputSchema: obj({ query: { type: "string" }, path: { type: "string" }, regex: { type: "boolean", default: false } }, ["query"]),
    annotations: READ,
    run: async (a) => searchCode(str(a.query) ?? "", str(a.path), a.regex === true),
  },
  {
    name: "db_schema",
    title: "Schema do banco",
    description: "Colunas das tabelas do schema utmfy (tipo, nulo, default). Informe 'table' para uma só.",
    inputSchema: obj({ table: { type: "string" } }),
    annotations: READ,
    run: async (a) => {
      const t = str(a.table);
      if (t && !/^[a-z_]+$/.test(t)) throw new Error("nome de tabela inválido");
      return sqlQuery(
        `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
         where table_schema = 'utmfy' ${t ? `and table_name = '${t}'` : ""} order by table_name, ordinal_position`,
        5000,
      );
    },
  },
  {
    name: "sql_query",
    title: "Consulta SQL (leitura)",
    description:
      "Executa um SELECT no schema utmfy (somente leitura, 15s, até 5000 linhas). Tabelas sem prefixo resolvem para utmfy. Não acessa outros schemas do banco.",
    inputSchema: obj({ sql: { type: "string" }, max_rows: limitProp(500, 5000) }, ["sql"]),
    annotations: READ,
    run: async (a) => sqlQuery(sqlText(a.sql), int(a.max_rows, 500, 5000)),
  },
  {
    name: "sql_execute",
    title: "Executar SQL (escrita)",
    description:
      "Executa UM comando INSERT/UPDATE/DELETE no schema utmfy (30s). Altera dados de produção: explique o comando e confirme com o usuário antes. DDL não é permitido — proponha uma migration.",
    inputSchema: obj({ sql: { type: "string" } }, ["sql"]),
    annotations: WRITE,
    run: async (a) => must(await db().rpc("mcp_exec", { q: sqlText(a.sql) })),
  },
  {
    name: "get_metrics",
    title: "Métricas do dashboard",
    description:
      "Mesmo relatório do dashboard: faturamento, vendas, gasto Meta, ROAS, CPA, reembolsos, Pix e árvore campanha → conjunto → anúncio. Período por preset (today, yesterday, 7d, 14d, 30d, month) ou from/to (YYYY-MM-DD).",
    inputSchema: obj({
      ...wsProp,
      preset: { type: "string", enum: ["today", "yesterday", "7d", "14d", "30d", "month"] },
      from: { type: "string" },
      to: { type: "string" },
      offer: { type: "string", description: "id (uuid) da oferta interna" },
      account: { type: "string" },
      source: { type: "string" },
      campaign: { type: "string" },
      adset: { type: "string" },
      ad: { type: "string" },
      status: { type: "string" },
      include_tree: { type: "boolean", default: true },
    }),
    annotations: READ,
    run: async (a) => {
      const ws = await workspace(a.workspace);
      const sp: Record<string, string> = {};
      for (const k of ["preset", "from", "to", "offer", "account", "source", "campaign", "adset", "ad", "status"]) {
        const v = str(a[k]);
        if (v) sp[k] = v;
      }
      if (!sp.preset && !sp.from) sp.preset = "7d";
      const f = parseFilters(sp, ws.timezone);
      const r = await loadReport(db(), ws, f);
      return {
        workspace: { slug: ws.slug, currency: ws.currency, timezone: ws.timezone },
        filtros: f,
        resumo: r.summary,
        gasto_fora_por_cambio: r.excludedSpend,
        ...(a.include_tree === false ? {} : { arvore: r.tree }),
      };
    },
  },
  {
    name: "integration_health",
    title: "Saúde das integrações",
    description: "Diagnóstico: último webhook Cakto, falhas 24h, conexão e contas Meta, último import de insights, tracker, pixels, pedidos 7d sem atribuição, falhas CAPI e últimos jobs.",
    inputSchema: obj({ ...wsProp, offer: { type: "string" } }),
    annotations: READ,
    run: async (a) => {
      const ws = await workspace(a.workspace);
      return must(await db().rpc("integration_health", { p_workspace: ws.id, p_offer: str(a.offer) ?? null }));
    },
  },
  {
    name: "list_orders",
    title: "Listar pedidos",
    description: "Pedidos com atribuição, mais recentes primeiro. Filtros: status, período de criação (YYYY-MM-DD, UTC), oferta, busca por id externo.",
    inputSchema: obj({
      ...wsProp,
      status: { type: "string", enum: ["pending", "refused", "canceled", "paid", "refund_requested", "disputed", "refunded", "chargedback"] },
      from: { type: "string" },
      to: { type: "string" },
      offer: { type: "string" },
      search: { type: "string" },
      limit: limitProp(50, 500),
    }),
    annotations: READ,
    run: async (a) => {
      const ws = await workspace(a.workspace);
      let q = db()
        .from("orders")
        .select("id, external_order_id, ref_id, status, product_name, offer_name, offer_type, gross_amount, net_amount, fees, payment_method, paid_at, created_at, source, offer_id, order_attribution(attribution_status, utm_source, campaign_name, adset_name, ad_name, ad_id, untracked_reason)", { count: "exact" })
        .eq("workspace_id", ws.id);
      if (str(a.status)) q = q.eq("status", str(a.status)!);
      if (date(a.from)) q = q.gte("created_at", `${date(a.from)}T00:00:00Z`);
      if (date(a.to)) q = q.lte("created_at", `${date(a.to)}T23:59:59Z`);
      if (str(a.offer)) q = q.eq("offer_id", str(a.offer)!);
      if (str(a.search)) q = q.ilike("external_order_id", `%${str(a.search)}%`);
      const r = await q.order("created_at", { ascending: false }).limit(int(a.limit, 50, 500));
      return { total: r.count, pedidos: must(r) };
    },
  },
  {
    name: "get_order",
    title: "Detalhe de um pedido",
    description: "Tudo sobre um pedido (id interno ou id externo da Cakto): dados, atribuição, histórico de status, webhooks recebidos, disparos CAPI e mudanças de reconciliação.",
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
    annotations: READ,
    run: async (a) => orderDetail(str(a.id) ?? ""),
  },
  {
    name: "list_webhook_events",
    title: "Webhooks recebidos",
    description: "Eventos de webhook da Cakto, mais recentes primeiro, com status de processamento, assinatura e erro.",
    inputSchema: obj({
      ...wsProp,
      status: { type: "string", enum: ["received", "processed", "ignored", "failed", "rejected"] },
      include_payload: { type: "boolean", default: false },
      limit: limitProp(50, 500),
    }),
    annotations: READ,
    run: async (a) => {
      const ws = await workspace(a.workspace);
      const cols = "id, event_name, external_order_id, processing_status, signature_verified, signature_method, error_message, attempts, received_at, processed_at";
      let q = db().from("webhook_events").select(a.include_payload === true ? `${cols}, payload` : cols).or(`workspace_id.eq.${ws.id},workspace_id.is.null`);
      if (str(a.status)) q = q.eq("processing_status", str(a.status)!);
      return must(await q.order("received_at", { ascending: false }).limit(int(a.limit, 50, 500)));
    },
  },
  {
    name: "list_logs",
    title: "Logs de integração",
    description: "Logs (info/warn/error) das integrações e das ações do MCP, mais recentes primeiro. Filtre por level ou code (ex.: META_SYNC_FAILED).",
    inputSchema: obj({ ...wsProp, level: { type: "string", enum: ["info", "warn", "error"] }, code: { type: "string" }, limit: limitProp(100, 1000) }),
    annotations: READ,
    run: async (a) => {
      const ws = await workspace(a.workspace);
      let q = db().from("integration_logs").select("*").or(`workspace_id.eq.${ws.id},workspace_id.is.null`);
      if (str(a.level)) q = q.eq("level", str(a.level)!);
      if (str(a.code)) q = q.eq("code", str(a.code)!);
      return must(await q.order("created_at", { ascending: false }).limit(int(a.limit, 100, 1000)));
    },
  },
  {
    name: "list_sync_jobs",
    title: "Execuções de rotinas",
    description: "Histórico das rotinas (cakto_sync, cakto_reconcile, meta_insights, capi_dispatch, reattribute...) com status, estatísticas e erro.",
    inputSchema: obj({ ...wsProp, kind: { type: "string" }, limit: limitProp(30, 500) }),
    annotations: READ,
    run: async (a) => {
      const ws = await workspace(a.workspace);
      let q = db().from("sync_jobs").select("*").or(`workspace_id.eq.${ws.id},workspace_id.is.null`);
      if (str(a.kind)) q = q.eq("kind", str(a.kind)!);
      return must(await q.order("started_at", { ascending: false }).limit(int(a.limit, 30, 500)));
    },
  },
  {
    name: "list_offers",
    title: "Ofertas e vínculos",
    description: "Ofertas internas com produtos/ofertas Cakto mapeados, contas de anúncio vinculadas (filtro de campanha) e pixels.",
    inputSchema: obj(wsProp),
    annotations: READ,
    run: async (a) => {
      const ws = await workspace(a.workspace);
      return must(
        await db()
          .from("offers")
          .select("*, offer_cakto_items(*), offer_ad_accounts(campaign_filter, meta_ad_accounts(account_id, account_name, currency, active, fx_rate)), offer_pixels(active, pixels(external_pixel_id, name, active, server_tracking_enabled))")
          .eq("workspace_id", ws.id)
          .order("created_at"),
      );
    },
  },
  {
    name: "run_job",
    title: "Rodar rotina",
    description:
      "Executa uma rotina agora: cakto_reconcile (corrige status pela API Cakto), cakto_sync (importa pedidos do período), meta_sync (gasto/insights Meta), capi_dispatch (fila de conversões), reattribute (refaz atribuição de pedidos sem anúncio). Período padrão: últimos 3 dias.",
    inputSchema: obj(
      {
        ...wsProp,
        job: { type: "string", enum: ["cakto_reconcile", "cakto_sync", "meta_sync", "capi_dispatch", "reattribute"] },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
        days: { type: "integer", minimum: 1, maximum: 365, description: "reattribute: janela em dias (padrão 60)" },
      },
      ["job"],
    ),
    annotations: WRITE,
    run: async (a) => {
      const ws = await workspace(a.workspace);
      const today = todayIn(ws.timezone);
      const from = date(a.from) ?? addDays(today, -3);
      const to = date(a.to) ?? today;
      switch (a.job) {
        case "cakto_reconcile":
        case "cakto_sync":
          return syncCaktoOrders(db(), ws.id, {
            from: `${from}T00:00:00Z`,
            to: `${addDays(to, 1)}T23:59:59Z`,
            mode: a.job === "cakto_sync" ? "sync" : "reconcile",
            trigger: "manual",
          });
        case "meta_sync":
          return syncMeta(db(), ws.id, { since: from, until: to, trigger: "manual" });
        case "capi_dispatch":
          return processDispatches(db(), { trigger: "manual", workspaceId: ws.id });
        case "reattribute":
          return reattributePending(db(), ws.id, int(a.days, 60, 365));
        default:
          throw new Error("job desconhecido");
      }
    },
  },
  {
    name: "retry_dispatch",
    title: "Reenviar conversão CAPI",
    description: "Recoloca na fila um disparo CAPI com status failed/skipped (id de conversion_dispatches).",
    inputSchema: obj({ dispatch_id: { type: "string" } }, ["dispatch_id"]),
    annotations: WRITE,
    run: async (a) => {
      const id = str(a.dispatch_id);
      if (!id || !UUID.test(id)) throw new Error("dispatch_id inválido");
      const r = await retryDispatch(db(), id);
      if (r.error) throw new Error(r.error.message);
      return { ok: true };
    },
  },
  {
    name: "search",
    title: "Buscar",
    description: "Busca no código do projeto e nos pedidos (id externo). Retorna ids para usar em 'fetch'.",
    inputSchema: obj({ query: { type: "string" } }, ["query"]),
    annotations: READ,
    run: async (a) => {
      const query = str(a.query) ?? "";
      const hits = await searchCode(query, "", false, 60);
      const files = [...new Set(hits.map((h) => h.split(":")[0]))].map((f) => ({ id: `file:${f}`, title: f, url: `${REPO}/${f}` }));
      const orders = must(await db().from("orders").select("id, external_order_id, status, product_name").ilike("external_order_id", `%${query}%`).limit(10)) as {
        id: string; external_order_id: string; status: string; product_name: string | null;
      }[];
      return {
        results: [
          ...files,
          ...orders.map((o) => ({ id: `order:${o.id}`, title: `Pedido ${o.external_order_id} (${o.status}) ${o.product_name ?? ""}`.trim(), url: `https://utmfy-tracker.vercel.app/pedidos` })),
        ],
      };
    },
  },
  {
    name: "fetch",
    title: "Abrir resultado",
    description: "Abre um resultado do 'search': 'file:<caminho>' devolve o arquivo; 'order:<id>' devolve o pedido completo.",
    inputSchema: obj({ id: { type: "string" } }, ["id"]),
    annotations: READ,
    run: async (a) => {
      const id = str(a.id) ?? "";
      if (id.startsWith("file:")) {
        const f = await readText(id.slice(5));
        return { id, title: f.path, text: f.content, url: `${REPO}/${f.path}`, metadata: { total_lines: f.total_lines } };
      }
      if (id.startsWith("order:")) {
        const d = await orderDetail(id.slice(6));
        return { id, title: `Pedido ${id.slice(6)}`, text: JSON.stringify(d, null, 2), url: "https://utmfy-tracker.vercel.app/pedidos", metadata: {} };
      }
      throw new Error("id deve começar com 'file:' ou 'order:'");
    },
  },
];

function text(value: unknown) {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n…[truncado: ${s.length} caracteres no total — refine a consulta]` : s;
}

export async function callTool(name: unknown, args: unknown) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `Ferramenta desconhecida: ${String(name)}` }], isError: true };
  const a = (args && typeof args === "object" ? args : {}) as Args;
  if (!tool.annotations.readOnlyHint) {
    await db().from("integration_logs").insert({ level: "info", code: "MCP_TOOL_CALL", provider: "mcp", message: tool.name, context: sanitize(a) });
  }
  try {
    return { content: [{ type: "text", text: text(await tool.run(a)) }] };
  } catch (e) {
    return { content: [{ type: "text", text: `Erro em ${tool.name}: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
  }
}
