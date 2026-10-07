import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseUtms } from "../core/utm";

// Recebe o beacon do public/t.js. Guarda o mínimo necessário para atribuição:
// sessão, UTMs, fbclid/fbc/fbp, página (sem query), host de referência e UA.

const param = z.string().max(500).nullable().optional();
const touch = z
  .object({
    utm_source: param, utm_medium: param, utm_campaign: param, utm_term: param, utm_content: param,
    utm_id: param, sck: param, fbclid: param,
  })
  .strip()
  .nullable()
  .optional();

export const trackPayload = z.object({
  v: z.literal(1),
  e: z.enum(["pageview", "checkout_click"]),
  sid: z.string().regex(/^[A-Za-z0-9._~-]{8,64}$/),
  offer: z.string().uuid().or(z.literal("")).optional(),
  url: z.string().max(1000).nullable().optional(),
  ref: z.string().max(255).nullable().optional(),
  ft: touch,
  lt: touch,
  fbc: z.string().max(500).nullable().optional(),
  fbp: z.string().max(200).nullable().optional(),
});

export type TrackPayload = z.infer<typeof trackPayload>;

function stripQuery(u: string | null | undefined) {
  if (!u) return null;
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

export async function recordTrack(db: SupabaseClient, p: TrackPayload, userAgent: string | null) {
  if (!p.offer) return { ok: false, reason: "no_offer" };
  const { data: offer } = await db.from("offers").select("id, workspace_id").eq("id", p.offer).maybeSingle();
  if (!offer) return { ok: false, reason: "unknown_offer" };
  const lt = p.lt ?? {};
  const parsed = parseUtms(lt);
  const { error } = await db.rpc("track_session", {
    p: {
      workspace_id: offer.workspace_id,
      offer_id: offer.id,
      session_id: p.sid,
      event: p.e,
      landing_url: stripQuery(p.url),
      referrer_host: p.ref ?? null,
      first_touch: p.ft ?? {},
      last_touch: p.lt ?? {},
      fbc: p.fbc ?? null,
      fbp: p.fbp ?? null,
      campaign_id: parsed.campaign.id,
      adset_id: parsed.adset.id,
      ad_id: parsed.ad.id,
      placement: parsed.placement,
      user_agent: userAgent?.slice(0, 400) ?? null,
    },
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

// Rate limit simples em memória (por instância): 120 req/min por IP.
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimited(key: string, max = 120, windowMs = 60000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return false;
  }
  b.n++;
  return b.n > max;
}
