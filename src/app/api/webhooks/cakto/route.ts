import { after, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { processDispatches } from "@/lib/services/capi-dispatch";
import { handleCaktoWebhook } from "@/lib/services/cakto-webhook";
import { TOKEN_RE } from "@/lib/services/offer-webhooks";

// POST /api/webhooks/cakto?o=<token-da-oferta>  (uma URL por oferta, produtos escolhidos na Cakto)
// POST /api/webhooks/cakto?ws=<slug>             (webhook geral: oferta pelo mapeamento de produto)
// Corpo lido CRU (request.text()) para validar o HMAC byte a byte.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 1_000_000;

export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  const url = new URL(request.url);
  const slug = url.searchParams.get("ws");
  const out = await handleCaktoWebhook(
    adminClient(),
    {
      rawBody,
      timestamp: request.headers.get("x-cakto-timestamp"),
      signature: request.headers.get("x-cakto-signature"),
    },
    {
      secrets: env.caktoWebhookSecrets,
      allowBodySecret: env.caktoAllowBodySecret,
      workspaceSlug: slug && /^[a-z0-9-]{1,63}$/.test(slug) ? slug : env.caktoWebhookWorkspace || null,
      offerToken: TOKEN_RE.test(url.searchParams.get("o") ?? "") ? url.searchParams.get("o") : null,
    },
  );
  // Venda aprovada: envia a conversão à Meta logo, sem atrasar a resposta à Cakto (a fila de 5 min segue de rede de segurança).
  // Com CAPI_ENABLED=false isto não faz nada.
  if (out.httpStatus === 200 && env.capiEnabled) {
    after(async () => {
      await processDispatches(adminClient(), { limit: 20, trigger: "cron" }).catch(() => null);
    });
  }
  return NextResponse.json(out.body, { status: out.httpStatus });
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "Endpoint de webhook Cakto: use POST" });
}
