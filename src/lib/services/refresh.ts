import "server-only";
import type { Db } from "../supabase/types";
import { addDays, todayIn } from "../core/dates";
import { logEvent } from "./logs";
import { syncCaktoOrders } from "./cakto-sync";
import { syncMeta } from "./meta-sync";
import { reattributePending } from "./orders";

// "Atualizar" dos painéis: Meta + Cakto em segundo plano, com trava contra cliques repetidos.

const KINDS = ["meta_insights", "cakto_reconcile", "cakto_sync"];
/** Um job "running" mais velho que isto é tratado como morto (função encerrada no meio). */
const STALE_MS = 4 * 60_000;
/** Depois de uma sincronização que acabou de terminar, outro clique não repete as chamadas. */
export const DEBOUNCE_MS = 45_000;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export async function activeRefresh(db: Db, workspaceId: string): Promise<{ running: boolean; startedAt: string | null }> {
  const { data } = await db.from("sync_jobs").select("started_at").eq("workspace_id", workspaceId).eq("status", "running").in("kind", KINDS).gte("started_at", ago(STALE_MS)).order("started_at", { ascending: true }).limit(1);
  return { running: !!data?.length, startedAt: (data?.[0]?.started_at as string | undefined) ?? null };
}

export async function recentlyRefreshed(db: Db, workspaceId: string): Promise<boolean> {
  const { data } = await db.from("sync_jobs").select("id").eq("workspace_id", workspaceId).eq("kind", "meta_insights").in("status", ["success", "partial"]).gte("finished_at", ago(DEBOUNCE_MS)).limit(1);
  return !!data?.length;
}

/** Meta e Cakto juntas; nunca lança (roda depois da resposta, ninguém receberia o erro). */
export async function runRefresh(db: Db, workspaceId: string, timezone: string) {
  const today = todayIn(timezone);
  try {
    await Promise.all([
      syncMeta(db, workspaceId, { trigger: "manual" }),
      syncCaktoOrders(db, workspaceId, { from: `${addDays(today, -3)}T00:00:00Z`, to: `${addDays(today, 1)}T23:59:59Z`, mode: "reconcile", trigger: "manual" }),
    ]);
    // Anúncio novo que a venda citava e ainda não estava no catálogo.
    await reattributePending(db, workspaceId).catch(() => null);
  } catch (e) {
    await logEvent(db, { workspaceId, level: "error", code: "REFRESH_FAILED", provider: "system", message: (e as Error).message.slice(0, 300) });
  }
}

export type RefreshStatus = {
  running: boolean;
  /** Os dois jobs (Meta e Cakto) começaram depois de `since` e já terminaram. */
  done: boolean;
  rateLimited: boolean;
  errors: string[];
};

export async function refreshStatus(db: Db, workspaceId: string, since: string): Promise<RefreshStatus> {
  const { data } = await db.from("sync_jobs").select("kind, status, error, stats, started_at").eq("workspace_id", workspaceId).in("kind", KINDS).gte("started_at", since).order("started_at", { ascending: false }).limit(10);
  const jobs = data ?? [];
  const running = jobs.some((j) => j.status === "running" && Date.now() - new Date(j.started_at as string).getTime() < STALE_MS);
  const hasMeta = jobs.some((j) => j.kind === "meta_insights");
  const hasCakto = jobs.some((j) => j.kind !== "meta_insights");
  const rateLimited = jobs.some((j) => (j.stats as { rate_limited?: boolean } | null)?.rate_limited === true);
  const errors = jobs.filter((j) => j.status === "failed" && j.error).map((j) => `${j.kind === "meta_insights" ? "Meta" : "Cakto"}: ${String(j.error).slice(0, 160)}`);
  return { running, done: !running && hasMeta && hasCakto, rateLimited, errors };
}
