// Meta Conversions API — montagem do evento (puro). Envio fica em
// src/lib/services/capi-dispatch.ts e só acontece com CAPI_ENABLED=true e o
// pixel com server_tracking_enabled.
// Regras (docs Meta, lidas em 2026-09-30):
//  * event_time: unix (s), até 7 dias no passado
//  * action_source=website exige event_source_url e client_user_agent
//  * em/ph/fn/ln/ct/st/country/external_id: SHA-256 após normalizar (e-mail trim+lowercase; telefone só dígitos com DDI;
//    nomes/cidade/estado/país em minúsculas, sem espaços nas pontas)
//  * fbc/fbp/client_user_agent/client_ip_address: sem hash
//  * event_id determinístico para deduplicação

import { sha256Hex } from "./hash";

export const CAPI_MAX_AGE_SECONDS = 7 * 24 * 3600;

export function purchaseEventId(provider: string, externalOrderId: string, eventName = "Purchase"): string {
  return `${provider}:${externalOrderId}:${eventName}`;
}

/** Texto para o hash da Meta: minúsculas, sem acento solto, sem pontuação e sem espaços repetidos. */
export function normalizeForMatch(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}

/** Cidade e estado na regra da Meta: só letras e números, sem espaços (ex.: "São Paulo" → "saopaulo"). */
export function normalizePlace(v: string | null | undefined): string | null {
  const s = normalizeForMatch(v);
  return s ? s.replace(/ /g, "") : null;
}

/** "Maria da Silva" → primeiro nome e último sobrenome, já normalizados. */
export function splitName(full: string | null | undefined): { first: string | null; last: string | null } {
  const n = normalizeForMatch(full);
  if (!n) return { first: null, last: null };
  const parts = n.split(" ");
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : null };
}

export const hashForMeta = (v: string | null | undefined): string | null => (v ? sha256Hex(v) : null);

export type CapiOrderInput = {
  provider: string;
  external_order_id: string;
  gross_amount: number | null;
  currency: string;
  paid_at: string | null;
  customer_email_sha256: string | null;
  customer_phone_sha256: string | null;
  fbc: string | null;
  fbp: string | null;
  client_user_agent: string | null;
  event_source_url: string | null;
  product_external_id: string | null;
  // Enriquecimento (opcionais: sem eles o evento sai como antes, só com menos pontos de casamento)
  customer_fn_sha256?: string | null;
  customer_ln_sha256?: string | null;
  client_ip?: string | null;
  geo_country?: string | null;
  geo_region?: string | null;
  geo_city?: string | null;
  /** Id da sessão do tracker: é o mesmo `external_id` que o t.js manda ao pixel no navegador. */
  external_id?: string | null;
};

export type CapiEvent = {
  event_name: "Purchase";
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url: string;
  user_data: Record<string, string | string[]>;
  custom_data: { value: number; currency: string; order_id: string; content_ids?: string[]; content_type?: string };
};

export function buildPurchaseEvent(o: CapiOrderInput, nowSeconds = Math.floor(Date.now() / 1000)):
  | { event: CapiEvent }
  | { skip: string }
  | { error: string } {
  if (!o.paid_at) return { error: "order_not_paid" };
  const eventTime = Math.floor(new Date(o.paid_at).getTime() / 1000);
  if (!Number.isFinite(eventTime)) return { error: "invalid_paid_at" };
  if (nowSeconds - eventTime > CAPI_MAX_AGE_SECONDS) return { skip: "event_too_old" };
  if (o.gross_amount == null) return { error: "missing_value" };
  // Sem a sessão do tracker não há user-agent nem página: a Meta recusaria o evento. Não é falha a repetir.
  if (!o.client_user_agent) return { skip: "no_tracker_session" };
  if (!o.event_source_url) return { skip: "no_tracker_session" };

  const user_data: Record<string, string | string[]> = { client_user_agent: o.client_user_agent };
  if (o.customer_email_sha256) user_data.em = [o.customer_email_sha256];
  if (o.customer_phone_sha256) user_data.ph = [o.customer_phone_sha256];
  if (o.customer_fn_sha256) user_data.fn = [o.customer_fn_sha256];
  if (o.customer_ln_sha256) user_data.ln = [o.customer_ln_sha256];
  const ct = hashForMeta(normalizePlace(o.geo_city));
  const st = hashForMeta(normalizePlace(o.geo_region));
  const country = hashForMeta(normalizePlace(o.geo_country));
  if (ct) user_data.ct = [ct];
  if (st) user_data.st = [st];
  if (country) user_data.country = [country];
  if (o.client_ip) user_data.client_ip_address = o.client_ip;
  if (o.external_id) user_data.external_id = [sha256Hex(o.external_id)];
  if (o.fbc) user_data.fbc = o.fbc;
  if (o.fbp) user_data.fbp = o.fbp;

  // client_user_agent sozinho não conta como parâmetro de identificação para a Meta
  // (ela acusa "user_data ausente" mesmo com o evento chegando). Exige pelo menos
  // um identificador real antes de enviar; senão é melhor não mandar o evento.
  const hasIdentifyingParam = Object.keys(user_data).some((k) => k !== "client_user_agent");
  if (!hasIdentifyingParam) return { skip: "no_identifying_user_data" };

  return {
    event: {
      event_name: "Purchase",
      event_time: eventTime,
      event_id: purchaseEventId(o.provider, o.external_order_id),
      action_source: "website",
      event_source_url: o.event_source_url,
      user_data,
      custom_data: {
        value: o.gross_amount,
        currency: o.currency,
        order_id: o.external_order_id,
        ...(o.product_external_id ? { content_ids: [o.product_external_id], content_type: "product" } : {}),
      },
    },
  };
}
