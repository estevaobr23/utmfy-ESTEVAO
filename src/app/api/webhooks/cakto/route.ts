import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { handleCaktoWebhook } from "@/lib/services/cakto-webhook";

// POST /api/webhooks/cakto?ws=<slug-do-workspace>
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
    },
  );
  return NextResponse.json(out.body, { status: out.httpStatus });
}

export function GET() {
  return NextResponse.json({ ok: true, hint: "Endpoint de webhook Cakto: use POST" });
}
