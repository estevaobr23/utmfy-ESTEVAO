import { after, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { processDispatches } from "@/lib/services/capi-dispatch";
import { handleHotmartWebhook } from "@/lib/services/hotmart-webhook";
import { logEvent } from "@/lib/services/logs";
import { buildAreaRelay } from "@/lib/core/hotmart/area-relay";
import { buildEntrega } from "@/lib/core/hotmart/entrega";

const AREA_URL = "https://nsduiygbatefbbhoriex.supabase.co/functions/v1/lavadoras-webhook";
const AREA_URL_INGLES = "https://nsduiygbatefbbhoriex.supabase.co/functions/v1/ingles-webhook";
const AREA_URL_INGLES_ES = "https://nsduiygbatefbbhoriex.supabase.co/functions/v1/ingles-es-webhook";

// POST /api/webhooks/hotmart            (webhook GERAL: produtos "todos"; a oferta sai do mapeamento produto → oferta)
// POST /api/webhooks/hotmart?ws=<slug>   (idem, escolhendo o workspace)
// A Hotmart manda o token do webhook em X-HOTMART-HOTTOK (e em `hottok` no corpo). Corpo lido CRU, como o da Cakto.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 1_000_000;

export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  const slug = new URL(request.url).searchParams.get("ws");
  const out = await handleHotmartWebhook(
    adminClient(),
    { rawBody, headerToken: request.headers.get("x-hotmart-hottok") },
    { secrets: env.hotmartHottoks, workspaceSlug: slug && /^[a-z0-9-]{1,63}$/.test(slug) ? slug : env.caktoWebhookWorkspace || null },
  );
  // Venda aprovada: envia a conversão à Meta logo, sem atrasar a resposta à Hotmart (a fila de 5 min segue de rede de segurança).
  if (out.httpStatus === 200 && out.body.ok === true && out.body.status === "paid" && env.capiEnabled) {
    after(async () => {
      await processDispatches(adminClient(), { limit: 20, trigger: "cron" }).catch(() => null);
    });
  }
  // Acesso das áreas de membros: repasse (webhook único da Hotmart). Só com hottok válido (200) e fora da resposta à Hotmart.
  // Cada área recebe só as vendas dos produtos dela. 17/11/2026: + área "Inglês da Limpeza" (produto 9004178); 18/11: + área ES (9015321).
  const areas = [
    { nome: "lavadoras", secret: process.env.AREA_WEBHOOK_SECRET, url: process.env.AREA_WEBHOOK_URL ?? AREA_URL, produtos: process.env.AREA_HOTMART_PRODUCT_IDS ?? "8814892,8844527,8844938,8844997,8844999" },
    { nome: "ingles", secret: process.env.INGLES_AREA_WEBHOOK_SECRET, url: process.env.INGLES_AREA_WEBHOOK_URL ?? AREA_URL_INGLES, produtos: process.env.INGLES_AREA_PRODUCT_IDS ?? "9004178" },
    // 18/11/2026: área "El Inglés de la Limpieza" (ES, produto 9015321). segredo só por env (sem segredo = não repassa).
    { nome: "ingles-es", secret: process.env.INGLES_ES_AREA_WEBHOOK_SECRET, url: process.env.INGLES_ES_AREA_WEBHOOK_URL ?? AREA_URL_INGLES_ES, produtos: process.env.INGLES_ES_AREA_PRODUCT_IDS ?? "9015321" },
  ];
  if (out.httpStatus === 200) {
    for (const area of areas) {
      if (!area.secret || !area.url) continue;
      after(async () => {
        try {
          const relay = buildAreaRelay(JSON.parse(rawBody), area.produtos.split(",").map((s) => s.trim()).filter(Boolean));
          if (!relay) return;
          const r = await fetch(area.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: area.secret, ...relay }) });
          if (!r.ok) await logEvent(adminClient(), { level: "error", code: "AREA_RELAY_FAILED", provider: "hotmart", message: `${area.nome}: status ${r.status}`, context: { area: area.nome, event: relay.event, transaction: relay.data.id } });
        } catch (e) {
          await logEvent(adminClient(), { level: "error", code: "AREA_RELAY_FAILED", provider: "hotmart", message: `${area.nome}: ${(e as Error).message.slice(0, 200)}` }).catch(() => null);
        }
      });
    }
  }
  // Entrega por WhatsApp: agenda a mensagem na ferramenta de recuperação (mesmo banco). Desligada por padrão no banco
  // (recuperacao.config 'entrega'.ativo); sem telefone no webhook não faz nada.
  if (out.httpStatus === 200) {
    after(async () => {
      try {
        const pedido = buildEntrega(JSON.parse(rawBody), process.env.ENTREGA_PRODUCT_ID ?? "8845970");
        if (!pedido) return;
        const db = adminClient() as unknown as { schema: (s: string) => { rpc: (n: string, a: unknown) => Promise<{ data: unknown; error: { message: string } | null }> } };
        const { error } = await db.schema("public").rpc("rec_entrega_registrar", { p: pedido });
        if (error) await logEvent(adminClient(), { level: "error", code: "ENTREGA_FAILED", provider: "hotmart", message: error.message.slice(0, 200), context: { transaction: pedido.transaction } });
      } catch (e) {
        await logEvent(adminClient(), { level: "error", code: "ENTREGA_FAILED", provider: "hotmart", message: (e as Error).message.slice(0, 200) }).catch(() => null);
      }
    });
  }
  return NextResponse.json(out.body, { status: out.httpStatus });
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "Endpoint de webhook Hotmart: use POST" });
}
