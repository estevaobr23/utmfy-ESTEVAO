// Meta Conversions API — montagem do evento (puro). Envio fica em
// src/lib/services/capi-dispatch.ts e só acontece com CAPI_ENABLED=true e o
// pixel com server_tracking_enabled.
// Regras (docs Meta, lidas em 2026-09-30):
//  * event_time: unix (s), até 7 dias no passado
//  * action_source=website exige event_source_url e client_user_agent
//  * em/ph: SHA-256 após normalizar (e-mail trim+lowercase; telefone só dígitos com DDI)
//  * fbc/fbp/client_user_agent/client_ip_address: sem hash
//  * event_id determinístico para deduplicação

export const CAPI_MAX_AGE_SECONDS = 7 * 24 * 3600;

export function purchaseEventId(provider: string, externalOrderId: string, eventName = "Purchase"): string {
  return `${provider}:${externalOrderId}:${eventName}`;
}

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
  if (!o.event_source_url) return { error: "missing_event_source_url" };
  if (!o.client_user_agent) return { error: "missing_client_user_agent" };

  const user_data: Record<string, string | string[]> = { client_user_agent: o.client_user_agent };
  if (o.customer_email_sha256) user_data.em = [o.customer_email_sha256];
  if (o.customer_phone_sha256) user_data.ph = [o.customer_phone_sha256];
  if (o.fbc) user_data.fbc = o.fbc;
  if (o.fbp) user_data.fbp = o.fbp;

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
