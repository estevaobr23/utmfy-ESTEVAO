import type { OfferMetaBinding } from "./offer-spend-scope";

// Regra automática: um conjunto de anúncios pertence à oferta cujo pixel ele
// otimiza (promoted_object.pixel_id). Um pixel por oferta é o padrão; pixel
// repetido em duas ofertas é ambíguo e não atribui gasto a nenhuma delas.

export type AdsetPixelRow = {
  account_id: string;
  campaign_id: string;
  adset_id: string;
  promoted_object: unknown;
};

export type OfferPixelLink = { offerId: string; pixelId: string };

/** pixel_id do promoted_object do conjunto (string numérica) ou null. */
export function adsetPixelId(promoted: unknown): string | null {
  if (!promoted || typeof promoted !== "object") return null;
  const value = (promoted as Record<string, unknown>).pixel_id;
  const id = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return /^\d{1,30}$/.test(id) ? id : null;
}

export type PixelDerivation = {
  /** Vínculo por conjunto, um para cada conjunto cujo pixel pertence a uma única oferta. */
  bindings: OfferMetaBinding[];
  /** Pixels ligados a mais de uma oferta: nenhum gasto é atribuído por eles. */
  ambiguousPixels: string[];
};

export function deriveOfferPixelBindings(adsets: AdsetPixelRow[], links: OfferPixelLink[]): PixelDerivation {
  const offersByPixel = new Map<string, Set<string>>();
  for (const link of links) {
    if (!link.pixelId) continue;
    const set = offersByPixel.get(link.pixelId) ?? new Set<string>();
    set.add(link.offerId);
    offersByPixel.set(link.pixelId, set);
  }
  const ambiguousPixels = [...offersByPixel].filter(([, offers]) => offers.size > 1).map(([pixel]) => pixel).sort();
  const bindings: OfferMetaBinding[] = [];
  for (const adset of adsets) {
    const pixel = adsetPixelId(adset.promoted_object);
    const offers = pixel ? offersByPixel.get(pixel) : null;
    if (!offers || offers.size !== 1) continue;
    bindings.push({ offerId: [...offers][0], accountId: adset.account_id, level: "adset", objectId: adset.adset_id });
  }
  return { bindings, ambiguousPixels };
}

/**
 * Soma os vínculos automáticos aos manuais. No mesmo conjunto o pixel vence o
 * vínculo manual; os manuais continuam valendo para o que não tem pixel.
 */
export function mergeBindings(manual: OfferMetaBinding[], derived: OfferMetaBinding[]): OfferMetaBinding[] {
  const derivedAdsets = new Set(derived.map((b) => `${b.accountId}:${b.objectId}`));
  return [...manual.filter((b) => !(b.level === "adset" && derivedAdsets.has(`${b.accountId}:${b.objectId}`))), ...derived];
}
