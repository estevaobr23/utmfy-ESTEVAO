import "server-only";
import type { Db } from "../supabase/types";
import { buildInitiateCheckoutEvent } from "../core/capi";
import { env } from "../env";
import { pixelToken } from "./capi-dispatch";
import { logEvent } from "./logs";
import type { ClientNet, TrackPayload } from "./tracking";

// InitiateCheckout pelo servidor: o t.js dispara o evento no navegador com um `eventID` e manda o mesmo id no
// beacon "checkout_click". Aqui o servidor reenvia o evento com o mesmo event_id (IP e user-agent reais do
// clique): a Meta junta as duas cópias, e a cobertura "pixel × API de Conversões" sobe sem contar em dobro.
// Sem fila: é uma chamada curta; se falhar, o pixel do navegador já contou o evento.

type Beacon = Pick<TrackPayload, "offer" | "sid" | "url" | "fbc" | "fbp" | "eid">;

export async function sendInitiateCheckout(db: Db, p: Beacon, userAgent: string | null, net: ClientNet | null) {
  if (!env.capiEnabled || !env.capiCheckoutEnabled) return { sent: 0, reason: "disabled" };
  if (!p.eid || !p.offer) return { sent: 0, reason: "no_event_id" };

  const { data: links } = await db
    .from("offer_pixels")
    .select("workspace_id, pixels(id, external_pixel_id, active, server_tracking_enabled, token_source)")
    .eq("offer_id", p.offer)
    .eq("active", true);
  const pixels = (links ?? []).flatMap((l) => {
    const px = (Array.isArray(l.pixels) ? l.pixels[0] : l.pixels) as { id: string; external_pixel_id: string; active: boolean; server_tracking_enabled: boolean; token_source: string } | null;
    return px?.active && px.server_tracking_enabled ? [{ ...px, workspace_id: l.workspace_id as string }] : [];
  });
  if (!pixels.length) return { sent: 0, reason: "no_server_pixel" };

  const built = buildInitiateCheckoutEvent({
    event_id: p.eid,
    event_source_url: p.url ?? null,
    client_user_agent: userAgent,
    client_ip: net?.ip ?? null,
    geo_country: net?.country ?? null,
    geo_region: net?.region ?? null,
    geo_city: net?.city ?? null,
    fbc: p.fbc ?? null,
    fbp: p.fbp ?? null,
    external_id: p.sid,
  });
  if ("skip" in built) return { sent: 0, reason: built.skip };

  let sent = 0;
  for (const px of pixels) {
    try {
      const token = await pixelToken(db, px);
      if (!token) continue;
      const body = new URLSearchParams({ data: JSON.stringify([built.event]), access_token: token });
      const res = await fetch(`https://graph.facebook.com/${env.metaGraphVersion}/${px.external_pixel_id}/events`, {
        method: "POST",
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) sent++;
      else {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        await logEvent(db, { workspaceId: px.workspace_id, level: "warn", code: "CAPI_CHECKOUT_FAILED", provider: "meta", message: (json.error?.message ?? `HTTP ${res.status}`).slice(0, 200), context: { pixel: px.external_pixel_id, status: res.status } });
      }
    } catch (e) {
      await logEvent(db, { workspaceId: px.workspace_id, level: "warn", code: "CAPI_CHECKOUT_FAILED", provider: "meta", message: (e as Error).message.slice(0, 200), context: { pixel: px.external_pixel_id } });
    }
  }
  return { sent, reason: sent ? "ok" : "not_sent" };
}
