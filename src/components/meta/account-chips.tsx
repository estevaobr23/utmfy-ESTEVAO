"use client";

import Link from "next/link";
import { ALL_ACCOUNTS, META_ACCOUNT_COOKIE, META_ACCOUNT_COOKIE_MAX_AGE, accountToneClass } from "@/lib/core/meta-account-filter";

/**
 * Chips de conta de anúncios (Todas · CONTA 1 · CONTA 2 · CONTA 03), nas mesmas cores das etiquetas da tabela.
 * Clicar navega com ?account=<id> (o servidor refaz tabela e totais só dessa conta) e lembra a escolha no cookie
 * `utmfy_meta_account` (30 dias): trocar de aba/oferta ou reabrir o navegador mantém a conta.
 */
export function AccountChips({ accounts, selected, tones, hrefFor }: {
  accounts: { id: string; name: string }[];
  selected: string | null;
  tones: Record<string, number>;
  /** id da conta → link da tela com a conta aplicada (ALL_ACCOUNTS = "Todas"). */
  hrefFor: Record<string, string>;
}) {
  if (accounts.length < 2) return null;
  const remember = (id: string) => {
    try {
      document.cookie = id === ALL_ACCOUNTS
        ? `${META_ACCOUNT_COOKIE}=; path=/; max-age=0; SameSite=Lax`
        : `${META_ACCOUNT_COOKIE}=${id}; path=/; max-age=${META_ACCOUNT_COOKIE_MAX_AGE}; SameSite=Lax`;
    } catch { /* cookie bloqueado: a conta continua valendo pela URL */ }
  };
  const chip = "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold uppercase tracking-wide ring-1 transition";
  return (
    <div role="group" aria-label="Filtrar por conta de anúncios" className="flex items-center gap-2 overflow-x-auto border-b border-divider bg-surface px-5 py-2.5 [scrollbar-width:none]">
      <span className="shrink-0 text-[11px] text-copy">Conta</span>
      <Link
        href={hrefFor[ALL_ACCOUNTS]}
        onClick={() => remember(ALL_ACCOUNTS)}
        aria-pressed={!selected}
        className={`${chip} ${!selected ? "bg-white/90 text-app-bg ring-white" : "bg-transparent text-copy ring-input-border hover:bg-surface-hover"}`}
      >
        Todas
      </Link>
      {accounts.map((account) => {
        const active = selected === account.id;
        return (
          <Link
            key={account.id}
            href={hrefFor[account.id]}
            onClick={() => remember(account.id)}
            aria-pressed={active}
            title={`${account.name} (act_${account.id})`}
            className={`${chip} ${accountToneClass(account.id, tones)} ${active ? "ring-2 ring-offset-1 ring-offset-surface" : selected ? "opacity-50 hover:opacity-100" : ""}`}
          >
            {active && <span aria-hidden className="mr-1">✓</span>}{account.name}
          </Link>
        );
      })}
    </div>
  );
}
