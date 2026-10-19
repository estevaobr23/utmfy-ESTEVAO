// Status de campanha/conjunto/anúncio na tabela Meta Ads: rótulos, o que conta como "removido" e as
// operações em massa (ativar, pausar, excluir). Funções puras, sem rede.

export type StatusOp = "activate" | "pause" | "delete";
export type StatusLevel = "campaign" | "adset" | "ad";

/** Máximo de objetos por operação (a Meta é chamada um a um; o resto vira outra operação). */
export const MAX_BULK = 50;

export const STATUS_OPS: Record<StatusOp, { apiStatus: "ACTIVE" | "PAUSED" | "DELETED"; label: string; done: string; confirm: string }> = {
  activate: { apiStatus: "ACTIVE", label: "Ativar", done: "ativado(s)", confirm: "Vai ligar na Meta e começar a gastar." },
  pause: { apiStatus: "PAUSED", label: "Desativar", done: "desativado(s)", confirm: "Vai pausar na Meta (dá para ativar de novo)." },
  delete: { apiStatus: "DELETED", label: "Excluir", done: "excluído(s)", confirm: "Exclui na Meta e NÃO dá para desfazer. O histórico de gasto e vendas continua nos relatórios." },
};

export const isStatusOp = (value: string): value is StatusOp => value === "activate" || value === "pause" || value === "delete";
export const isStatusLevel = (value: string): value is StatusLevel => value === "campaign" || value === "adset" || value === "ad";

/** Arquivado ou excluído: a Meta deixou de listar o objeto (some do Gerenciador). */
export const REMOVED_STATUSES = ["ARCHIVED", "DELETED"] as const;
export const isRemovedStatus = (status: string | null | undefined) => status === "ARCHIVED" || status === "DELETED";

export const removedLabel = (status: string | null | undefined) => (status === "DELETED" ? "Excluída" : status === "ARCHIVED" ? "Arquivada" : null);

/** Lê "id1,id2,..." do formulário: só números da Meta, sem repetição, até MAX_BULK. Passou do limite = null (recusa inteira). */
export function parseBulkIds(raw: string): string[] | null {
  const ids = [...new Set(String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!ids.length || ids.length > MAX_BULK || ids.some((id) => !/^\d{1,30}$/.test(id))) return null;
  return ids;
}

/** Como o status efetivo local muda depois que a Meta aceita a operação (a sincronização seguinte confirma). */
export function statusAfter(op: StatusOp): string {
  return op === "activate" ? "ACTIVE" : op === "pause" ? "PAUSED" : "DELETED";
}

/**
 * Filhos de uma campanha/conjunto que mudou: a Meta reporta os anúncios como "pausados pelo pai".
 * `only` = só troca quem está nesse status (null = todos). Aproximação até a próxima sincronização.
 */
export function childStatusChange(op: StatusOp, level: "campaign" | "adset"): { to: string; only: string | null } {
  if (op === "delete") return { to: "DELETED", only: null };
  const paused = level === "campaign" ? "CAMPAIGN_PAUSED" : "ADSET_PAUSED";
  return op === "pause" ? { to: paused, only: "ACTIVE" } : { to: "ACTIVE", only: paused };
}
