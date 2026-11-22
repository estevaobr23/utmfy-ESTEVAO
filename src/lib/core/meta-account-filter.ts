// Filtro por conta de anúncios na tela Meta Ads (chips "Todas · CONTA 1 · CONTA 2 · CONTA 03").
// A conta escolhida vai na URL (?account=<id>, ou ?account=all para "Todas") e fica lembrada num cookie,
// no mesmo padrão do período (period-memory): a URL sempre vence; sem conta na URL, vale a lembrada.
// Módulo puro: usado no servidor (leitura do cookie) e no cliente (gravação ao clicar no chip).

export const META_ACCOUNT_COOKIE = "utmfy_meta_account";
export const META_ACCOUNT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
/** Valor explícito de "Todas" na URL: vence uma conta lembrada no cookie. */
export const ALL_ACCOUNTS = "all";

const ID = /^[0-9]{1,30}$/;
type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Conta escolhida: URL (`account=<id>` ou `account=all`) e, sem nada na URL, o cookie.
 * Só vale conta que existe na tela (`known`): conta de outra oferta ou removida vira "Todas".
 */
export function resolveAccount(sp: SP, cookieValue: string | null | undefined, known: Iterable<string>): string | null {
  const ids = new Set(known);
  const fromUrl = first(sp.account);
  if (fromUrl === ALL_ACCOUNTS) return null;
  if (fromUrl) return ID.test(fromUrl) && ids.has(fromUrl) ? fromUrl : null;
  const saved = (cookieValue ?? "").trim();
  return ID.test(saved) && ids.has(saved) ? saved : null;
}

/** Linhas só da conta escolhida (null = todas). Linha sem conta só aparece em "Todas". */
export function filterByAccount<T extends { accountId: string | null }>(rows: T[], account: string | null): T[] {
  return account ? rows.filter((row) => row.accountId === account) : rows;
}

/** Cores das etiquetas/chips, só com os tokens da paleta. */
export const ACCOUNT_TONES = [
  "bg-primary/15 text-copy ring-primary/40",
  "bg-success/15 text-success ring-success/40",
  "bg-amber-400/15 text-amber-200 ring-amber-400/30",
  "bg-sky-400/15 text-sky-200 ring-sky-400/30",
  "bg-fuchsia-400/15 text-fuchsia-200 ring-fuchsia-400/30",
];

/**
 * Cor fixa por conta: posição da conta na lista ordenada por nome (CONTA 1 → 1ª cor, CONTA 2 → 2ª, CONTA 03 → 3ª).
 * Antes era hash do ID e duas contas caíam na mesma cor; pela ordem, contas diferentes nunca repetem (até 5).
 */
export function accountToneMap(accounts: { account_id: string; account_name?: string | null }[]): Record<string, number> {
  const sorted = [...accounts].sort((a, b) =>
    (a.account_name ?? a.account_id).localeCompare(b.account_name ?? b.account_id, "pt-BR", { numeric: true }) || a.account_id.localeCompare(b.account_id));
  return Object.fromEntries(sorted.map((account, index) => [account.account_id, index % ACCOUNT_TONES.length]));
}

export function accountToneClass(accountId: string | null, tones: Record<string, number>): string {
  const index = accountId != null ? tones[accountId] : undefined;
  if (index != null) return ACCOUNT_TONES[index];
  let h = 0;
  for (const ch of accountId ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCOUNT_TONES[h % ACCOUNT_TONES.length];
}
