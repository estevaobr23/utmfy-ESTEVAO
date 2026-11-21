import { after, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { processDispatches } from "@/lib/services/capi-dispatch";
import { handleWiapyWebhook } from "@/lib/services/wiapy-webhook";
import { TOKEN_RE } from "@/lib/services/offer-webhooks";

// POST /api/webhooks/wiapy?o=<token-da-oferta>   (uma integração "Webhook" na Wiapy por oferta, com os produtos dela)
// A Wiapy manda o token da integração no cabeçalho Authorization. O token mora no Vault (utmfy.mjs wiapy-webhook-criar).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 1_000_000;

export async function POST(request: Request) {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  const o = new URL(request.url).searchParams.get("o") ?? "";
  const out = await handleWiapyWebhook(
    adminClient(),
    { rawBody, authorization: request.headers.get("authorization") },
    { offerToken: TOKEN_RE.test(o) ? o : null, secrets: env.wiapyWebhookTokens },
  );
  // Venda aprovada (não teste): envia a conversão à Meta logo, sem atrasar a resposta (a fila de 5 min segue de rede de segurança).
  if (out.httpStatus === 200 && out.body.ok === true && out.body.status === "paid" && out.body.test !== true && env.capiEnabled) {
    after(async () => {
      await processDispatches(adminClient(), { limit: 20, trigger: "cron" }).catch(() => null);
    });
  }
  return NextResponse.json(out.body, { status: out.httpStatus });
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "Endpoint de webhook Wiapy: use POST com ?o=<token da oferta>" });
}
