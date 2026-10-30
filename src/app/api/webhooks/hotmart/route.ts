import { after, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { processDispatches } from "@/lib/services/capi-dispatch";
import { handleHotmartWebhook } from "@/lib/services/hotmart-webhook";
import { logEvent } from "@/lib/services/logs";
import { buildAreaRelay } from "@/lib/core/hotmart/area-relay";

const AREA_URL = "https://nsduiygbatefbbhoriex.supabase.co/functions/v1/lavadoras-webhook";

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
  // Acesso da área de membros: repasse (webhook único). Só com hottok válido (200) e fora da resposta à Hotmart.
  const secretArea = process.env.AREA_WEBHOOK_SECRET;
  if (out.httpStatus === 200 && secretArea) {
    after(async () => {
      try {
        const relay = buildAreaRelay(JSON.parse(rawBody), (process.env.AREA_HOTMART_PRODUCT_IDS ?? "8814892,8844527,8844938,8844997,8844999").split(",").map((s) => s.trim()).filter(Boolean));
        if (!relay) return;
        const r = await fetch(process.env.AREA_WEBHOOK_URL ?? AREA_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: secretArea, ...relay }) });
        if (!r.ok) await logEvent(adminClient(), { level: "error", code: "AREA_RELAY_FAILED", provider: "hotmart", message: `status ${r.status}`, context: { event: relay.event, transaction: relay.data.id } });
      } catch (e) {
        await logEvent(adminClient(), { level: "error", code: "AREA_RELAY_FAILED", provider: "hotmart", message: (e as Error).message.slice(0, 200) }).catch(() => null);
      }
    });
  }
  return NextResponse.json(out.body, { status: out.httpStatus });
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "Endpoint de webhook Hotmart: use POST" });
}
