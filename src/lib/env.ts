import "server-only";
import { DEFAULT_GRAPH_VERSION } from "./core/meta";

// Leitura central das variáveis de ambiente do SERVIDOR. Nunca exporte valores
// de secret para componentes client; use envStatus() para mostrar "configurado".

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const bool = (v: string | undefined, def: boolean) => (v == null || v === "" ? def : /^(1|true|yes|on)$/i.test(v));

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  appUrl: (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3200").replace(/\/$/, ""),
  cronSecret: process.env.CRON_SECRET ?? "",

  caktoApiBase: (process.env.CAKTO_API_BASE ?? "https://api.cakto.com.br").replace(/\/$/, ""),
  caktoClientId: process.env.CAKTO_CLIENT_ID ?? "",
  caktoClientSecret: process.env.CAKTO_CLIENT_SECRET ?? "",
  caktoWebhookSecrets: list(process.env.CAKTO_WEBHOOK_SECRETS ?? process.env.CAKTO_WEBHOOK_SECRET),
  caktoAllowBodySecret: bool(process.env.CAKTO_ALLOW_BODY_SECRET, true),
  caktoWebhookWorkspace: process.env.CAKTO_WEBHOOK_WORKSPACE_SLUG ?? "",

  metaAccessToken: process.env.META_ACCESS_TOKEN ?? "",
  metaAppId: process.env.META_APP_ID ?? "",
  metaAppSecret: process.env.META_APP_SECRET ?? "",
  metaGraphVersion: process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
  metaLookbackDays: Math.min(Math.max(Number(process.env.META_LOOKBACK_DAYS ?? 3) || 3, 1), 28),

  capiEnabled: bool(process.env.CAPI_ENABLED, false),
  metaCapiToken: process.env.META_CAPI_TOKEN ?? "",
};

/** Só booleans — seguro para exibir na UI. */
export function envStatus() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: !!env.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!env.supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: !!env.supabaseServiceKey,
    APP_URL: !!process.env.APP_URL,
    CRON_SECRET: !!env.cronSecret,
    CAKTO_CLIENT_ID: !!env.caktoClientId,
    CAKTO_CLIENT_SECRET: !!env.caktoClientSecret,
    CAKTO_WEBHOOK_SECRETS: env.caktoWebhookSecrets.length > 0,
    META_ACCESS_TOKEN: !!env.metaAccessToken,
    META_APP_ID: !!env.metaAppId,
    META_APP_SECRET: !!env.metaAppSecret,
    META_CAPI_TOKEN: !!env.metaCapiToken,
    CAPI_ENABLED: env.capiEnabled,
  };
}
