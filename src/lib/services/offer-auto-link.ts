import type { Db } from "../supabase/types";
import { deriveOfferPixelBindings, type AdsetPixelRow } from "../core/offer-pixel-scope";

/** Vínculos conjunto → oferta pelo pixel (pixels ativos ligados às ofertas × promoted_object dos conjuntos). */
export async function loadPixelDerivation(sb: Db, workspaceId: string) {
  const [pixelLinks, adsets] = await Promise.all([
    sb.from("offer_pixels").select("offer_id, active, pixels(external_pixel_id, active)").eq("workspace_id", workspaceId).eq("active", true),
    sb.from("meta_adsets").select("account_id, campaign_id, adset_id, promoted_object").eq("workspace_id", workspaceId).limit(5000),
  ]);
  // Sem a tabela/coluna (migration pendente) ou com erro: volta ao comportamento anterior.
  if (pixelLinks.error || adsets.error) return null;
  const links = (pixelLinks.data ?? []).flatMap((row) => {
    const px = row.pixels as unknown as { external_pixel_id: string; active: boolean } | null;
    return px?.active && px.external_pixel_id ? [{ offerId: row.offer_id as string, pixelId: px.external_pixel_id }] : [];
  });
  return deriveOfferPixelBindings((adsets.data ?? []) as AdsetPixelRow[], links);
}

/**
 * Liga a oferta às contas de anúncio onde o pixel dela aparece, sem ninguém
 * clicar em nada. Só cria o que falta: nunca apaga nem altera vínculos existentes.
 */
export async function autoLinkOfferAccounts(db: Db, workspaceId: string): Promise<number> {
  const derived = await loadPixelDerivation(db, workspaceId);
  if (!derived?.bindings.length) return 0;
  const { data: accounts } = await db.from("meta_ad_accounts").select("id, account_id").eq("workspace_id", workspaceId);
  const uuidByAccount = new Map((accounts ?? []).map((a) => [a.account_id as string, a.id as string]));
  const pairs = new Map<string, { workspace_id: string; offer_id: string; ad_account_id: string }>();
  for (const b of derived.bindings) {
    const accountUuid = uuidByAccount.get(b.accountId);
    if (accountUuid) pairs.set(`${b.offerId}:${accountUuid}`, { workspace_id: workspaceId, offer_id: b.offerId, ad_account_id: accountUuid });
  }
  if (!pairs.size) return 0;
  const { error } = await db.from("offer_ad_accounts").upsert([...pairs.values()], { onConflict: "offer_id,ad_account_id", ignoreDuplicates: true });
  if (error) throw new Error(`offer_ad_accounts: ${error.message}`);
  return pairs.size;
}
