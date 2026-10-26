import { after, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { processDispatches } from "@/lib/services/capi-dispatch";
import { handleHotmartWebhook } from "@/lib/services/hotmart-webhook";

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
  return NextResponse.json(out.body, { status: out.httpStatus });
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "Endpoint de webhook Hotmart: use POST" });
}
