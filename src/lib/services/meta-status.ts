import "server-only";
import type { Db } from "../supabase/types";
import { childStatusChange, STATUS_OPS, statusAfter, type StatusLevel, type StatusOp } from "../core/meta-status";
import { ensureEnvConnection, getMetaToken } from "./meta-sync";
import { MetaApiError, MetaClient } from "./meta-client";
import { logEvent } from "./logs";

// Ativar, desativar e excluir campanha/conjunto/anúncio direto pela ferramenta (seleção na tabela Meta Ads).
// Só roda a partir de ação explícita do usuário (botão + confirmação). Cada objeto é um pedido à Meta; a falha de um
// não impede os demais, e o resultado de cada um volta para a tela.

export type StatusResult = { id: string; name: string; ok: boolean; error?: string };

const TABLES: Record<StatusLevel, { table: string; idColumn: string; nameColumn: string }> = {
  campaign: { table: "meta_campaigns", idColumn: "campaign_id", nameColumn: "name" },
  adset: { table: "meta_adsets", idColumn: "adset_id", nameColumn: "name" },
  ad: { table: "meta_ads", idColumn: "ad_id", nameColumn: "ad_name" },
};

export async function updateMetaStatus(
  db: Db,
  workspaceId: string,
  input: { level: StatusLevel; ids: string[]; op: StatusOp },
): Promise<{ ok: true; results: StatusResult[] } | { ok: false; error: string }> {
  const { table, idColumn, nameColumn } = TABLES[input.level];
  const { data: found } = await db.from(table).select(`account_id, ${idColumn}, ${nameColumn}`).eq("workspace_id", workspaceId).in(idColumn, input.ids);
  const rows = (found ?? []) as unknown as Record<string, string | null>[];
  const byId = new Map(rows.map((r) => [String(r[idColumn]), r]));

  const accountIds = [...new Set(rows.map((r) => String(r.account_id)))];
  const { data: accounts } = await db.from("meta_ad_accounts").select("account_id, connection_id, active").eq("workspace_id", workspaceId).in("account_id", accountIds.length ? accountIds : ["-"]);
  const accountOf = new Map((accounts ?? []).map((a) => [String(a.account_id), a]));
  const conns = await ensureEnvConnection(db, workspaceId);
  const clients = new Map<string, MetaClient | null>();
  const clientFor = async (accountId: string) => {
    if (clients.has(accountId)) return clients.get(accountId) ?? null;
    const account = accountOf.get(accountId);
    const conn = conns.find((c) => c.id === account?.connection_id) ?? conns[0];
    const token = account?.active && conn ? await getMetaToken(db, conn) : null;
    const client = token ? new MetaClient(token) : null;
    clients.set(accountId, client);
    return client;
  };

  const op = STATUS_OPS[input.op];
  const results: StatusResult[] = [];
  for (const id of input.ids) {
    const row = byId.get(id);
    const name = String(row?.[nameColumn] ?? id);
    if (!row) { results.push({ id, name, ok: false, error: "não encontrado neste workspace" }); continue; }
    const client = await clientFor(String(row.account_id));
    if (!client) { results.push({ id, name, ok: false, error: "conta de anúncios inativa ou sem token" }); continue; }
    try {
      await client.post(id, { status: op.apiStatus });
    } catch (e) {
      const message = e instanceof MetaApiError ? `${e.kind}: ${e.message}` : (e as Error).message;
      await logEvent(db, { workspaceId, level: "error", code: "META_STATUS_UPDATE_FAILED", provider: "meta", message: message.slice(0, 300), context: { level: input.level, object_id: id, op: input.op } });
      results.push({ id, name, ok: false, error: message.slice(0, 160) });
      continue;
    }
    // Espelha no banco local (a sincronização seguinte confirma): o status do próprio objeto e o dos filhos.
    const now = new Date().toISOString();
    await db.from(table).update(table === "meta_ads" ? { effective_status: statusAfter(input.op), updated_at: now } : { effective_status: statusAfter(input.op), synced_at: now }).eq("workspace_id", workspaceId).eq(idColumn, id);
    if (input.level !== "ad") {
      const change = childStatusChange(input.op, input.level);
      const children: { table: string; column: string }[] = input.level === "campaign"
        ? [{ table: "meta_adsets", column: "campaign_id" }, { table: "meta_ads", column: "campaign_id" }]
        : [{ table: "meta_ads", column: "adset_id" }];
      for (const child of children) {
        let query = db.from(child.table).update({ effective_status: change.to }).eq("workspace_id", workspaceId).eq(child.column, id);
        if (change.only) query = query.eq("effective_status", change.only);
        await query;
      }
    }
    await logEvent(db, { workspaceId, level: "info", code: "META_STATUS_UPDATED", provider: "meta", message: `${name}: ${op.label}`, context: { level: input.level, object_id: id, op: input.op, status: op.apiStatus } });
    results.push({ id, name, ok: true });
  }
  return { ok: true, results };
}
