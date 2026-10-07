// Macros não resolvidas são repassadas de propósito: assim o pedido chega na
// Cakto com o problema visível (e a tela Não rastreadas explica o motivo).
// Espelho (em TS) da regra de decoração do public/t.js — usado pelo
// Diagnóstico de Tracking. tests/tracker.test.ts garante que os dois produzem
// exatamente a mesma URL.
export const TRACKER_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "sck", "fbclid"] as const;
export const DEFAULT_CHECKOUT_DOMAINS = ["pay.cakto.com.br"];

export function isCheckoutHost(host: string, domains = DEFAULT_CHECKOUT_DOMAINS): boolean {
  const h = host.toLowerCase();
  return domains.some((d) => h === d || h.endsWith("." + d));
}

export function pickTrackerParams(search: string | URLSearchParams): Record<string, string> {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const out: Record<string, string> = {};
  for (const k of TRACKER_PARAMS) {
    const v = sp.get(k);
    if (v != null && v !== "") out[k] = v.slice(0, 500);
  }
  return out;
}

export function decorateCheckoutUrl(
  checkoutUrl: string,
  params: Record<string, string>,
  opts: { sessionId?: string | null; callback?: boolean; domains?: string[] } = {},
): { url: string; added: string[]; kept: string[]; isCheckout: boolean } {
  const u = new URL(checkoutUrl);
  const isCheckout = isCheckoutHost(u.hostname, opts.domains);
  const added: string[] = [];
  const kept: string[] = [];
  if (!isCheckout) return { url: checkoutUrl, added, kept, isCheckout };
  for (const k of TRACKER_PARAMS) {
    const v = params[k];
    if (!v) continue;
    if (u.searchParams.has(k)) kept.push(k);
    else {
      u.searchParams.set(k, v);
      added.push(k);
    }
  }
  if (opts.callback !== false && opts.sessionId) {
    if (u.searchParams.has("callback")) kept.push("callback");
    else {
      u.searchParams.set("callback", opts.sessionId);
      added.push("callback");
    }
  }
  return { url: added.length ? u.toString() : checkoutUrl, added, kept, isCheckout };
}
