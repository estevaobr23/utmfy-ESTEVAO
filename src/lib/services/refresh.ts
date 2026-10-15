import "server-only";
import type { Db } from "../supabase/types";
import { addDays, todayIn } from "../core/dates";
import { logEvent } from "./logs";
import { syncCaktoOrders } from "./cakto-sync";
import { syncOfferWebhooks } from "./offer-webhooks";
import { syncMeta } from "./meta-sync";
import { reattributePending } from "./orders";

// "Atualizar" dos painéis. O botão espera SÓ o gasto da Meta (ontem+hoje, ~1–2 s): a venda já chega na hora pelo
// webhook da Cakto e fica no banco. A API da Cakto (token e listagem oscilam de 0,5 s a 30 s) roda DEPOIS, em segundo
// plano, só como rede de segurança — nunca no caminho do botão. Trava contra cliques repetidos.

/** O que o botão acompanha: só o job rápido da Meta. */
const KINDS = ["meta_insights"];
/** Um job "running" mais velho que isto é tratado como morto (função encerrada no meio). */
const STALE_MS = 4 * 60_000;
/** Depois de uma sincronização que acabou de terminar, outro clique não repete as chamadas. */
export const DEBOUNCE_MS = 15_000;
/** As coletas de segundo plano (catálogo, alcance, vídeo…) não precisam rodar a cada clique. */
const EXTRAS_EVERY_MS = 3 * 60_000;
/** Reconciliação da Cakto em segundo plano: no máximo uma por minuto. */
const CAKTO_EVERY_MS = 60_000;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export async function activeRefresh(db: Db, workspaceId: string): Promise<{ running: boolean; startedAt: string | null }> {
  const { data } = await db.from("sync_jobs").select("started_at").eq("workspace_id", workspaceId).eq("status", "running").in("kind", KINDS).gte("started_at", ago(STALE_MS)).order("started_at", { ascending: true }).limit(1);
  return { running: !!data?.length, startedAt: (data?.[0]?.started_at as string | undefined) ?? null };
}

export async function recentlyRefreshed(db: Db, workspaceId: string): Promise<boolean> {
  const { data } = await db.from("sync_jobs").select("id").eq("workspace_id", workspaceId).eq("kind", "meta_insights").in("status", ["success", "partial"]).gte("finished_at", ago(DEBOUNCE_MS)).limit(1);
  return !!data?.length;
}

/** Fase que o botão espera: gasto da Meta de ontem+hoje. Nunca lança (roda depois da resposta, ninguém receberia o erro). */
export async function runRefresh(db: Db, workspaceId: string) {
  try {
    await syncMeta(db, workspaceId, { trigger: "manual", mode: "fast" });
  } catch (e) {
    await logEvent(db, { workspaceId, level: "error", code: "REFRESH_FAILED", provider: "system", message: (e as Error).message.slice(0, 300) });
  }
}

/**
 * Segundo plano, sem segurar o botão: reconciliação da Cakto (só reprocessa pedido novo/alterado), webhooks da Cakto,
 * catálogo/campanhas/vídeo/alcance da Meta (depois do job rápido, para não disputar a cota) e reatribuição.
 */
export async function runRefreshExtras(db: Db, workspaceId: string, timezone: string, metaFast: Promise<unknown> = Promise.resolve()) {
  const today = todayIn(timezone);
  const recentJob = async (kind: string, ms: number) =>
    !!(await db.from("sync_jobs").select("id").eq("workspace_id", workspaceId).eq("kind", kind).in("status", ["running", "success", "partial"]).gte("started_at", ago(ms)).limit(1)).data?.length;
  try {
    await Promise.all([
      (async () => {
        if (await recentJob("cakto_reconcile", CAKTO_EVERY_MS)) return;
        await syncCaktoOrders(db, workspaceId, { from: `${addDays(today, -1)}T00:00:00Z`, to: `${addDays(today, 1)}T23:59:59Z`, mode: "reconcile", trigger: "manual", skipWebhookSync: true, skipUnchanged: true });
      })(),
      syncOfferWebhooks(db, workspaceId).catch((e) => logEvent(db, { workspaceId, level: "warn", code: "CAKTO_WEBHOOKS_READ_FAILED", provider: "cakto", message: (e as Error).message })),
      (async () => {
        await metaFast.catch(() => null);
        if (!(await recentJob("meta_catalog", EXTRAS_EVERY_MS))) await syncMeta(db, workspaceId, { trigger: "manual", mode: "extras" });
      })(),
    ]);
    // Anúncio novo que a venda citava e ainda não estava no catálogo.
    await reattributePending(db, workspaceId).catch(() => null);
  } catch (e) {
    await logEvent(db, { workspaceId, level: "warn", code: "REFRESH_EXTRAS_FAILED", provider: "system", message: (e as Error).message.slice(0, 300) });
  }
}

export type RefreshStatus = {
  running: boolean;
  /** O job rápido da Meta começou depois de `since` e já terminou (a Cakto segue em segundo plano). */
  done: boolean;
  rateLimited: boolean;
  errors: string[];
};

export async function refreshStatus(db: Db, workspaceId: string, since: string): Promise<RefreshStatus> {
  const { data } = await db.from("sync_jobs").select("kind, status, error, stats, started_at").eq("workspace_id", workspaceId).in("kind", KINDS).gte("started_at", since).order("started_at", { ascending: false }).limit(10);
  const jobs = data ?? [];
  const running = jobs.some((j) => j.status === "running" && Date.now() - new Date(j.started_at as string).getTime() < STALE_MS);
  const hasMeta = jobs.some((j) => j.kind === "meta_insights");
  const rateLimited = jobs.some((j) => (j.stats as { rate_limited?: boolean } | null)?.rate_limited === true);
  const errors = jobs.filter((j) => j.status === "failed" && j.error).map((j) => `Meta: ${String(j.error).slice(0, 160)}`);
  return { running, done: !running && hasMeta, rateLimited, errors };
}
