import "server-only";
import type { Db } from "../supabase/types";

// Logs estruturados, sempre sem secrets. Códigos estáveis (ex.: META_SYNC_FAILED,
// ATTRIBUTION_FAILED) para filtrar na tela de Eventos/Health.

const SENSITIVE = /token|secret|password|authorization|signature|client_secret|api[_-]?key|email|phone|cpf|document/i;

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? "[redacted]" : sanitize(v, depth + 1);
    return out;
  }
  if (typeof value === "string") {
    // tokens longos que escaparam (EAA..., Bearer ...)
    return value.replace(/(EAA[A-Za-z0-9]{20,})/g, "[redacted]").replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]").slice(0, 2000);
  }
  return value;
}

export async function logEvent(
  db: Db,
  entry: {
    workspaceId?: string | null;
    level: "info" | "warn" | "error";
    code: string;
    provider?: string;
    message?: string;
    context?: Record<string, unknown>;
  },
) {
  const context = sanitize(entry.context ?? {}) as Record<string, unknown>;
  const line = `${entry.code}${entry.message ? ` — ${entry.message}` : ""} ${JSON.stringify(context)}`;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  try {
    await db.from("integration_logs").insert({
      workspace_id: entry.workspaceId ?? null,
      level: entry.level,
      code: entry.code,
      provider: entry.provider ?? null,
      message: entry.message?.slice(0, 1000) ?? null,
      context,
    });
  } catch {
    // log nunca derruba o fluxo principal
  }
}

export async function startJob(db: Db, workspaceId: string | null, kind: string, trigger: "manual" | "cron" | "system", params: Record<string, unknown> = {}) {
  const { data } = await db.from("sync_jobs").insert({ workspace_id: workspaceId, kind, trigger, params }).select("id").single();
  return (data?.id as string | undefined) ?? null;
}

export async function finishJob(
  db: Db,
  jobId: string | null,
  status: "success" | "partial" | "failed",
  stats: Record<string, unknown>,
  error?: string | null,
) {
  if (!jobId) return;
  await db.from("sync_jobs").update({ status, stats: sanitize(stats), error: error?.slice(0, 1000) ?? null, finished_at: new Date().toISOString() }).eq("id", jobId);
}
