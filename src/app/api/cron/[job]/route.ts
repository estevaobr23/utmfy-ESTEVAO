import { NextResponse } from "next/server";
import { addDays, todayIn } from "@/lib/core/dates";
import { safeEqual } from "@/lib/core/hash";
import { env } from "@/lib/env";
import { adminClient } from "@/lib/supabase/admin";
import { syncCaktoOrders } from "@/lib/services/cakto-sync";
import { processDispatches } from "@/lib/services/capi-dispatch";
import { syncMeta } from "@/lib/services/meta-sync";

// Rotinas automáticas. Chamadas por Vercel Cron ou pg_cron (pg_net) com
// "Authorization: Bearer $CRON_SECRET".
//   meta-sync        hoje + ontem + retroativo (META_LOOKBACK_DAYS)
//   cakto-reconcile  pedidos atualizados nos últimos 3 dias
//   capi-dispatch    fila de conversões (só com CAPI_ENABLED=true)
//   purge-sessions   retenção do IP/sessões do tracker
//   all              todos
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  if (!env.cronSecret) return false;
  const h = request.headers.get("authorization") ?? "";
  return safeEqual(h, `Bearer ${env.cronSecret}`);
}

async function run(job: string) {
  const db = adminClient();
  const { data: workspaces } = await db.from("workspaces").select("id, timezone").eq("is_demo", false);
  const results: Record<string, unknown> = {};
  for (const ws of workspaces ?? []) {
    const r: Record<string, unknown> = {};
    if (job === "meta-sync" || job === "all") {
      r.meta = (await syncMeta(db, ws.id, { trigger: "cron" })).stats;
    }
    if (job === "cakto-reconcile" || job === "all") {
      const today = todayIn(ws.timezone);
      r.cakto = (await syncCaktoOrders(db, ws.id, { from: `${addDays(today, -3)}T00:00:00Z`, to: `${addDays(today, 1)}T23:59:59Z`, mode: "reconcile", trigger: "cron" })).stats;
    }
    results[ws.id] = r;
  }
  if (job === "capi-dispatch" || job === "all") results.capi = await processDispatches(db, { trigger: "cron" });
  // LGPD: apaga o IP guardado após 30 dias e as sessões após 90 (a Meta só aceita evento de até 7 dias).
  if (job === "purge-sessions" || job === "all") results.purge = (await db.rpc("purge_tracking_pii", { p_ip_days: 30, p_session_days: 90 })).data ?? null;
  return results;
}

async function handler(request: Request, ctx: { params: Promise<{ job: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { job } = await ctx.params;
  if (!["meta-sync", "cakto-reconcile", "capi-dispatch", "purge-sessions", "all"].includes(job)) return NextResponse.json({ error: "unknown_job" }, { status: 404 });
  return NextResponse.json({ ok: true, job, results: await run(job) });
}

export { handler as GET, handler as POST };
