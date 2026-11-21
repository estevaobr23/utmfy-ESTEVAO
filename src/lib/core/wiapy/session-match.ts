// Casamento venda da Wiapy → sessão do tracker (t.js). A Wiapy não devolve sck, então tentamos, nesta ordem:
//   1. utm_term   — a sessão foi no utm_term do link do checkout ("<posicionamento>|sid_<sessão>") e voltou no webhook
//   2. fbc        — o fbclid do fbc do checkout = o fbclid que a sessão guardou na página
//   3. ip_ua      — mesmo IP e mesmo navegador (user-agent) da sessão, dentro da janela antes do pagamento
//   4. ua_unico   — mesmo navegador, UMA sessão só da oferta na janela (cobre IPv6 na página × IPv4 no checkout)
// Nada casou → "none" (a venda ainda pode ser atribuída pelas UTMs que a Wiapy repassou).
export type SessionMatchMethod = "utm_term" | "fbc" | "ip_ua" | "ua_unico" | "none";

export type SessionCandidate = {
  session_id: string;
  offer_id: string | null;
  last_seen_at: string;
};

/** Janela da sessão: de 48 h antes do pagamento até 30 min depois (o beacon do clique pode chegar depois do PIX gerado). */
export const MATCH_WINDOW_BEFORE_MS = 48 * 3600 * 1000;
export const MATCH_WINDOW_AFTER_MS = 30 * 60 * 1000;

export function matchWindow(at: string | null, now = Date.now()) {
  const t = at ? new Date(at).getTime() : now;
  const ref = Number.isFinite(t) ? t : now;
  return { from: new Date(ref - MATCH_WINDOW_BEFORE_MS).toISOString(), to: new Date(ref + MATCH_WINDOW_AFTER_MS).toISOString(), ref };
}

/** Melhor candidata: da mesma oferta primeiro, depois a visita mais perto do pagamento. */
export function pickSession(cands: SessionCandidate[], opts: { offerId: string | null; at: string | null; unique?: boolean }): string | null {
  if (!cands.length) return null;
  const { ref } = matchWindow(opts.at);
  const sameOffer = opts.offerId ? cands.filter((c) => c.offer_id === opts.offerId) : [];
  const pool = sameOffer.length ? sameOffer : opts.unique ? [] : cands;
  if (opts.unique && pool.length !== 1) return null;
  const sorted = [...pool].sort((a, b) => Math.abs(new Date(a.last_seen_at).getTime() - ref) - Math.abs(new Date(b.last_seen_at).getTime() - ref));
  return sorted[0]?.session_id ?? null;
}
