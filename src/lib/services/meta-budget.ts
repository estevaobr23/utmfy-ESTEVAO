import "server-only";
import type { Db } from "../supabase/types";
import { planBudgetChange } from "../core/meta-advanced";
import { ensureEnvConnection, getMetaToken } from "./meta-sync";
import { MetaApiError, MetaClient } from "./meta-client";
import { logEvent } from "./logs";

// Edição do orçamento DIÁRIO de campanha (CBO) ou conjunto (ABO) direto pela ferramenta.
// O valor chega na moeda do workspace (R$) e é convertido para a moeda da conta pela
// mesma PTAX que o relatório usa; o resultado é gravado na Meta e espelhado no banco.

export type BudgetUpdate = { name: string; currency: string; beforeMinor: number; afterMinor: number; rate: number | null };

export async function updateMetaDailyBudget(
  db: Db,
  workspaceId: string,
  input: { level: "campaign" | "adset"; objectId: string; requested: number; workspaceCurrency: string },
): Promise<{ ok: true; update: BudgetUpdate } | { ok: false; error: string }> {
  if (!/^\d{1,30}$/.test(input.objectId)) return { ok: false, error: "ID Meta inválido." };
  const table = input.level === "campaign" ? "meta_campaigns" : "meta_adsets";
  const idColumn = input.level === "campaign" ? "campaign_id" : "adset_id";
  const { data: row } = await db.from(table).select("account_id, name, daily_budget_minor, currency").eq("workspace_id", workspaceId).eq(idColumn, input.objectId).maybeSingle();
  if (!row) return { ok: false, error: "Objeto não encontrado neste workspace." };
  const current = Number(row.daily_budget_minor);
  if (!(current > 0)) return { ok: false, error: "Este objeto não tem orçamento diário próprio (é vitalício ou fica em outro nível)." };
  const currency = String(row.currency ?? "");
  if (!currency) return { ok: false, error: "Moeda da conta desconhecida." };

  const { data: account } = await db.from("meta_ad_accounts").select("connection_id, fx_rate, active").eq("workspace_id", workspaceId).eq("account_id", row.account_id as string).maybeSingle();
  if (!account?.active) return { ok: false, error: "Conta de anúncios inativa na ferramenta." };

  let rate: number | null = null;
  if (currency !== input.workspaceCurrency) {
    const { data: fx } = await db.from("fx_rates").select("rate").eq("currency", currency).order("date", { ascending: false }).limit(1);
    rate = Number(fx?.[0]?.rate) > 0 ? Number(fx![0].rate) : Number(account.fx_rate) > 0 ? Number(account.fx_rate) : null;
  }
  const plan = planBudgetChange({ requested: input.requested, currentMinor: current, currency, targetCurrency: input.workspaceCurrency, rate });
  if (!plan.ok) return { ok: false, error: plan.reason };

  const conns = await ensureEnvConnection(db, workspaceId);
  const conn = conns.find((c) => c.id === account.connection_id) ?? conns[0];
  const token = conn ? await getMetaToken(db, conn) : null;
  if (!token) return { ok: false, error: "Token da Meta indisponível." };

  try {
    await new MetaClient(token).post(input.objectId, { daily_budget: plan.newMinor });
  } catch (e) {
    const message = e instanceof MetaApiError ? `${e.kind}: ${e.message}` : (e as Error).message;
    await logEvent(db, { workspaceId, level: "error", code: "META_BUDGET_UPDATE_FAILED", provider: "meta", message: message.slice(0, 300), context: { level: input.level, object_id: input.objectId, attempted_minor: plan.newMinor } });
    return { ok: false, error: `A Meta recusou a mudança — ${message.slice(0, 200)}` };
  }

  await db.from(table).update({ daily_budget_minor: plan.newMinor, synced_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq(idColumn, input.objectId);
  const update: BudgetUpdate = { name: String(row.name ?? input.objectId), currency, beforeMinor: current, afterMinor: plan.newMinor, rate };
  await logEvent(db, {
    workspaceId, level: "info", code: "META_BUDGET_UPDATED", provider: "meta", message: `${update.name}: ${current} → ${plan.newMinor} (${currency}, unidade menor)`,
    context: {
      level: input.level, object_id: input.objectId, before_minor: current, after_minor: plan.newMinor, currency, rate, requested: input.requested, workspace_currency: input.workspaceCurrency,
      // Valores na moeda do painel (o que o usuário vê na tabela), para mostrar "de → para" sem refazer conta.
      before_target: rate ? (current / 100) * rate : current / 100, after_target: input.requested,
    },
  });
  return { ok: true, update };
}
