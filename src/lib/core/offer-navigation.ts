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

/** Trocar de oferta mantém a seção funcional atual, nunca filtros da query string. */
export function offerSwitchHref(targetOfferId: string, currentOfferId: string | null, section: string) {
  return `/ofertas/${targetOfferId}/${currentOfferId ? normalizeOfferSection(section) : "resumo"}`;
}

export function offerSectionLinks(offerId: string): [string, string][] {
  return OFFER_SECTIONS.map(([section, label]) => [`/ofertas/${offerId}/${section}`, label]);
}
