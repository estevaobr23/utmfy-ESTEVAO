import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/session";
import { refreshStatus } from "@/lib/services/refresh";

// GET /api/sync-status?since=<ISO>  → andamento do "Atualizar" (Meta + Cakto) do workspace do usuário.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const s = await requireWorkspace();
  const since = new URL(request.url).searchParams.get("since") ?? "";
  if (Number.isNaN(Date.parse(since))) return NextResponse.json({ error: "invalid_since" }, { status: 400 });
  return NextResponse.json(await refreshStatus(adminClient(), s.workspace.id, new Date(since).toISOString()));
}
