import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { sendInitiateCheckout } from "@/lib/services/capi-checkout";
import { clientNetFrom, rateLimited, recordTrack, trackPayload } from "@/lib/services/tracking";

// Beacon público do tracker (public/t.js). Aceita text/plain (sendBeacon, sem
// preflight). Resposta sempre 204 para não vazar informação a terceiros.
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return new NextResponse(null, { status: 429, headers: CORS });
  const raw = await request.text();
  if (raw.length > 8000) return new NextResponse(null, { status: 413, headers: CORS });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400, headers: CORS });
  }
  const parsed = trackPayload.safeParse(json);
  if (!parsed.success) return new NextResponse(null, { status: 400, headers: CORS });
  const db = adminClient();
  const ua = request.headers.get("user-agent");
  const net = clientNetFrom(request.headers);
  await recordTrack(db, parsed.data, ua, net).catch(() => null);
  // Clique no checkout com o InitiateCheckout do navegador: reenvia pelo servidor com o mesmo event_id.
  if (parsed.data.e === "checkout_click" && parsed.data.eid) await sendInitiateCheckout(db, parsed.data, ua, net).catch(() => null);
  return new NextResponse(null, { status: 204, headers: CORS });
}
