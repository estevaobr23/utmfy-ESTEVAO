import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/core/hash";
import { env } from "@/lib/env";
import { callTool, TOOLS } from "@/lib/mcp/tools";

// Servidor MCP (Streamable HTTP, sem sessão) para o ChatGPT e outros clientes.
// Autenticação: token em MCP_AUTH_TOKEN, no caminho (/api/mcp/<token> — o
// conector do ChatGPT não envia headers próprios) ou em "Authorization: Bearer".
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS =
  "UTMFY Tracker: atribuição de vendas Cakto a anúncios Meta. Comece por project_overview. " +
  "Use get_metrics e integration_health para análise e diagnóstico, read_file/search_code para o código, " +
  "sql_query para consultas livres. Ferramentas de escrita (sql_execute, run_job, retry_dispatch) alteram produção: " +
  "explique o efeito e peça confirmação antes.";

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: unknown } };

function authorized(request: Request, key?: string[]) {
  const expected = env.mcpAuthToken;
  if (expected.length < 32) return false;
  const fromPath = key?.[0] ?? "";
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return (!!fromPath && safeEqual(fromPath, expected)) || (!!bearer && safeEqual(bearer, expected));
}

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: Rpc) {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Requisição inválida");
  if (msg.id === undefined || msg.id === null) return null; // notificação
  switch (msg.method) {
    case "initialize": {
      const v = msg.params?.protocolVersion;
      return ok(msg.id, {
        protocolVersion: v && VERSIONS.includes(v) ? v : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "utmfy-tracker", title: "UTMFY Tracker", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS.map(({ run: _run, ...t }) => t) });
    case "tools/call":
      return ok(msg.id, await callTool(msg.params?.name, msg.params?.arguments));
    default:
      return fail(msg.id, -32601, `Método não suportado: ${msg.method}`);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ key?: string[] }> }) {
  const { key } = await ctx.params;
  if (!authorized(request, key)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(fail(null, -32700, "JSON inválido"), { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m as Rpc)))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }
  const out = await handle(body as Rpc);
  return out ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
}

function notAllowed() {
  return NextResponse.json({ error: "use POST (MCP Streamable HTTP sem SSE)" }, { status: 405, headers: { Allow: "POST" } });
}

export { notAllowed as GET, notAllowed as DELETE };
