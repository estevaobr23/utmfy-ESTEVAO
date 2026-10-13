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

/** Cookie (só preferência de interface) que lembra a oferta escolhida enquanto se navega pela Administração. */
export const OFFER_COOKIE = "utmfy_offer";

/**
 * Oferta selecionada. A URL manda; nas telas de Administração (sem id na URL) vale a oferta lembrada, para a
 * navegação NÃO voltar sozinha para "Todas as ofertas". Em telas consolidadas (/, /campanhas, /pedidos, /ofertas)
 * não há oferta: escolher "Todas as ofertas" limpa a lembrança.
 */
export function resolveSelectedOffer(path: string, urlOfferId: string | null, remembered: string | null, known: Iterable<string>): string | null {
  if (urlOfferId) return urlOfferId;
  if (!isAdminPath(path) || !remembered) return null;
  return new Set(known).has(remembered) ? remembered : null;
}

/** Trocar de oferta mantém a seção funcional atual, nunca filtros da query string. */
export function offerSwitchHref(targetOfferId: string, currentOfferId: string | null, section: string) {
  return `/ofertas/${targetOfferId}/${currentOfferId ? normalizeOfferSection(section) : "resumo"}`;
}

export function offerSectionLinks(offerId: string): [string, string][] {
  return OFFER_SECTIONS.map(([section, label]) => [`/ofertas/${offerId}/${section}`, label]);
}
