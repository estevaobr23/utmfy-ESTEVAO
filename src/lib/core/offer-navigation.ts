export const OFFER_SECTIONS = [
  ["resumo", "Resumo"],
  ["meta", "Meta Ads"],
  ["pedidos", "Pedidos"],
  ["integracoes", "Integrações"],
  ["tracking", "Tracking"],
  ["configuracoes", "Configurações"],
] as const;

export type OfferSection = (typeof OFFER_SECTIONS)[number][0];

const OFFER_PATH = /^\/ofertas\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/([a-z-]+))?/i;
const SECTION_SET = new Set<string>(OFFER_SECTIONS.map(([section]) => section));
const LEGACY_SECTION: Record<string, OfferSection> = {
  configurar: "integracoes",
  saude: "tracking",
};

export function normalizeOfferSection(section: string | null | undefined): OfferSection {
  if (!section) return "resumo";
  if (SECTION_SET.has(section)) return section as OfferSection;
  return LEGACY_SECTION[section] ?? "resumo";
}

/** A URL é a fonte do contexto; ids desconhecidos nunca ativam uma oferta. */
export function offerContextFromPath(path: string, knownOfferIds: Iterable<string>) {
  const match = path.match(OFFER_PATH);
  const known = new Set(knownOfferIds);
  const offerId = match && known.has(match[1]) ? match[1] : null;
  return { offerId, section: normalizeOfferSection(match?.[2]) };
}

/** Telas de Administração: valem para o workspace todo e não têm o id da oferta na URL. */
export const ADMIN_PATHS = ["/meta", "/cakto", "/pixels", "/saude", "/eventos", "/utms", "/diagnostico", "/configuracoes"] as const;
export const isAdminPath = (path: string) => ADMIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Cookie (só preferência de interface) que lembra a última oferta aberta. Serve para (1) não perder a oferta ao passear
 * pela Administração e (2) ABRIR A UTMFY ONDE PAROU: a raiz `/` redireciona para a oferta lembrada.
 */
export const OFFER_COOKIE = "utmfy_offer";

/** "Todas as ofertas" escolhido de propósito. Só este endereço (e o botão que leva a ele) apaga a oferta lembrada. */
export const CONSOLIDATED_HREF = "/?todas=1";

/**
 * Oferta selecionada. A URL manda; nas telas de Administração (sem id na URL) vale a oferta lembrada, para a
 * navegação NÃO voltar sozinha para "Todas as ofertas". Em telas consolidadas (/, /campanhas, /pedidos, /ofertas)
 * não há oferta selecionada, mas abrir uma delas NÃO apaga a lembrança: só a escolha explícita de
 * "Todas as ofertas" (CONSOLIDATED_HREF) limpa. Assim, reabrir a UTMFY volta para a última oferta.
 */
export function resolveSelectedOffer(path: string, urlOfferId: string | null, remembered: string | null, known: Iterable<string>): string | null {
  if (urlOfferId) return urlOfferId;
  if (!isAdminPath(path) || !remembered) return null;
  return new Set(known).has(remembered) ? remembered : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** A URL pediu o consolidado de propósito (`/?todas=1`)? */
export const wantsConsolidated = (sp: SP) => first(sp.todas) !== "" && first(sp.todas) !== "0";

/**
 * Para onde a raiz `/` deve mandar. `null` = mostrar o consolidado.
 * - `?todas=1` (ou aviso `?ok=`/`?error=` de uma ação) → consolidado;
 * - cookie com uma oferta válida (do workspace e não arquivada; a validação é do chamador, no servidor) → resumo dela,
 *   levando só o período da URL (se houver). Validar no servidor evita laço com a tela "oferta não encontrada".
 */
export function rootRedirectTarget(sp: SP, savedOfferId: string | null | undefined, isValidOffer: (id: string) => boolean): string | null {
  // Aviso de uma ação (?ok= / ?error=, ex.: dados DEMO criados) é mostrado no consolidado, não engolido pelo redirect.
  if (wantsConsolidated(sp) || first(sp.ok) || first(sp.error)) return null;
  if (!savedOfferId || !UUID.test(savedOfferId) || !isValidOffer(savedOfferId)) return null;
  const q = new URLSearchParams();
  for (const key of ["preset", "from", "to"] as const) {
    const v = first(sp[key]);
    if (v) q.set(key, v);
  }
  const query = q.toString();
  return `/ofertas/${savedOfferId}/resumo${query ? `?${query}` : ""}`;
}

/** Destino seguro depois do login: só caminho interno (nada de `//host`, `\`, esquema ou volta para /login). */
export function safeNextPath(next: string | null | undefined): string {
  const v = (next ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /^\/login(\/|\?|$)/.test(v) || v.length > 500) return "/";
  return v;
}

/** Trocar de oferta mantém a seção funcional atual, nunca filtros da query string. */
export function offerSwitchHref(targetOfferId: string, currentOfferId: string | null, section: string) {
  return `/ofertas/${targetOfferId}/${currentOfferId ? normalizeOfferSection(section) : "resumo"}`;
}

export function offerSectionLinks(offerId: string): [string, string][] {
  return OFFER_SECTIONS.map(([section, label]) => [`/ofertas/${offerId}/${section}`, label]);
}
