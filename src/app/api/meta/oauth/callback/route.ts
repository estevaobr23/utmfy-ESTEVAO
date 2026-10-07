import { NextResponse, type NextRequest } from "next/server";
import { hint, safeEqual } from "@/lib/core/hash";
import { env } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";
import { adminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/services/logs";

const fail = (msg: string) => NextResponse.redirect(`${env.appUrl}/meta?error=${encodeURIComponent(msg)}`);

export async function GET(request: NextRequest) {
  const s = await requireWorkspace();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const [expected, wsId] = (request.cookies.get("meta_oauth_state")?.value ?? "").split(".");
  if (!code || !expected || !safeEqual(state, expected) || wsId !== s.workspace.id || !s.canWrite) return fail("OAuth inválido (state)");

  const g = `https://graph.facebook.com/${env.metaGraphVersion}`;
  const short = await fetch(`${g}/oauth/access_token?${new URLSearchParams({ client_id: env.metaAppId, client_secret: env.metaAppSecret, redirect_uri: `${env.appUrl}/api/meta/oauth/callback`, code })}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  if (!short?.access_token) return fail("Falha ao trocar o código OAuth");
  const long = await fetch(`${g}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: env.metaAppId, client_secret: env.metaAppSecret, fb_exchange_token: short.access_token })}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  const token: string | undefined = long?.access_token ?? short.access_token;
  if (!token) return fail("Falha ao obter token de longa duração");

  const db = adminClient();
  const { data: conn, error } = await db
    .from("meta_connections")
    .insert({
      workspace_id: s.workspace.id, name: "Meta (OAuth)", token_source: "vault", token_hint: hint(token), status: "active", scopes: ["ads_read"],
      expires_at: long?.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !conn) return fail("Falha ao salvar conexão");
  const stored = await db.rpc("store_secret", { p_workspace: s.workspace.id, p_owner_type: "meta_connection", p_owner_id: conn.id, p_secret: token });
  if (stored.error) {
    await db.from("meta_connections").delete().eq("id", conn.id);
    return fail("Vault indisponível — use META_ACCESS_TOKEN");
  }
  await logEvent(db, { workspaceId: s.workspace.id, level: "info", code: "META_CONNECTED", provider: "meta", message: "Conexão OAuth criada", context: { connection_id: conn.id } });
  const res = NextResponse.redirect(`${env.appUrl}/meta?ok=${encodeURIComponent("Meta conectada. Agora clique em Descobrir contas.")}`);
  res.cookies.delete("meta_oauth_state");
  return res;
}
