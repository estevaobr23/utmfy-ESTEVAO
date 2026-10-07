import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";

// Login com Facebook pedindo SOMENTE ads_read (leitura). Opcional: sem
// META_APP_ID/SECRET, use META_ACCESS_TOKEN (token de System User).
export async function GET() {
  const s = await requireWorkspace();
  if (!s.canWrite) return NextResponse.redirect(`${env.appUrl}/meta?error=sem_permissao`);
  if (!env.metaAppId || !env.metaAppSecret) return NextResponse.redirect(`${env.appUrl}/meta?error=${encodeURIComponent("Defina META_APP_ID e META_APP_SECRET (ver SETUP_REQUIRED.md)")}`);
  const state = randomBytes(24).toString("hex");
  const url = new URL(`https://www.facebook.com/${env.metaGraphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", env.metaAppId);
  url.searchParams.set("redirect_uri", `${env.appUrl}/api/meta/oauth/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "ads_read");
  url.searchParams.set("response_type", "code");
  const res = NextResponse.redirect(url.toString());
  res.cookies.set("meta_oauth_state", `${state}.${s.workspace.id}`, { httpOnly: true, sameSite: "lax", secure: env.appUrl.startsWith("https"), maxAge: 600, path: "/" });
  return res;
}
