import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireWorkspace } from "./session";

export type OfferContext = Awaited<ReturnType<typeof requireOffer>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Oferta da URL, validada contra o workspace do usuário (RLS). Toda página
 * dentro de /ofertas/[id] parte daqui: o id da rota é a única fonte da oferta,
 * então nenhum filtro na query string tira a página desse contexto.
 */
export const requireOffer = cache(async (id: string) => {
  const s = await requireWorkspace();
  if (!UUID.test(id)) notFound();
  const { data: offer } = await s.sb.from("offers").select("*").eq("id", id).eq("workspace_id", s.workspace.id).maybeSingle();
  if (!offer) notFound();
  const [accounts, pixels] = await Promise.all([
    s.sb.from("offer_ad_accounts").select("meta_ad_accounts(account_id, account_name, currency)").eq("offer_id", id),
    s.sb.from("offer_pixels").select("active, pixels(id, name, external_pixel_id)").eq("offer_id", id).eq("active", true),
  ]);
  type Acc = { account_id: string; account_name: string | null; currency: string | null };
  type Px = { id: string; name: string; external_pixel_id: string };
  return {
    ...s,
    offer: offer as { id: string; name: string; slug: string; status: string } & Record<string, unknown>,
    accounts: (accounts.data ?? []).map((r) => r.meta_ad_accounts as unknown as Acc | null).filter((a): a is Acc => !!a),
    pixels: (pixels.data ?? []).map((r) => r.pixels as unknown as Px | null).filter((p): p is Px => !!p),
  };
});
