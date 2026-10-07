import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { serverClient } from "./supabase/server";

export type Workspace = { id: string; name: string; slug: string; is_demo: boolean; timezone: string; currency: string };

export const WS_COOKIE = "utmfy_ws";

/** Usuário logado + workspace atual (cookie) — tudo lido com RLS. */
export const requireSession = cache(async () => {
  const sb = await serverClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await sb
    .from("workspace_members")
    .select("role, workspaces(id, name, slug, is_demo, timezone, currency)")
    .eq("user_id", user.id);
  const memberships = (data ?? [])
    .map((m) => ({ role: m.role as string, ws: m.workspaces as unknown as Workspace }))
    .filter((m) => m.ws);
  const store = await cookies();
  const wanted = store.get(WS_COOKIE)?.value;
  const current =
    memberships.find((m) => m.ws.id === wanted) ??
    memberships.find((m) => !m.ws.is_demo) ??
    memberships[0] ??
    null;
  return {
    sb,
    user,
    workspace: current?.ws ?? null,
    role: current?.role ?? null,
    workspaces: memberships.map((m) => m.ws),
    canWrite: current?.role === "owner" || current?.role === "admin",
  };
});

export async function requireWorkspace() {
  const s = await requireSession();
  if (!s.workspace) redirect("/configuracoes?sem-workspace=1");
  return { ...s, workspace: s.workspace };
}
