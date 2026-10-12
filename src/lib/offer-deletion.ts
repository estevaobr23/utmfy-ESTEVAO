import "server-only";
import type { Db } from "./supabase/types";

export type OfferDeletionPreview = {
  orders: number;
  sessions: number;
  caktoItems: number;
  adAccounts: number;
  pixels: number;
  costRules: number;
  hasHistory: boolean;
};

export async function loadOfferDeletionPreview(sb: Db, offerId: string): Promise<OfferDeletionPreview> {
  const queries = await Promise.all([
    sb.from("orders").select("id", { count: "exact", head: true }).eq("offer_id", offerId),
    sb.from("tracking_sessions").select("id", { count: "exact", head: true }).eq("offer_id", offerId),
    sb.from("offer_cakto_items").select("id", { count: "exact", head: true }).eq("offer_id", offerId),
    sb.from("offer_ad_accounts").select("offer_id", { count: "exact", head: true }).eq("offer_id", offerId),
    sb.from("offer_pixels").select("offer_id", { count: "exact", head: true }).eq("offer_id", offerId),
    sb.from("cost_rules").select("id", { count: "exact", head: true }).eq("offer_id", offerId),
  ]);
  const error = queries.find((query) => query.error)?.error;
  if (error) throw new Error(`offer deletion preview: ${error.message}`);
  const [orders, sessions, caktoItems, adAccounts, pixels, costRules] = queries.map((query) => query.count ?? 0);
  return { orders, sessions, caktoItems, adAccounts, pixels, costRules, hasHistory: orders > 0 || sessions > 0 };
}
