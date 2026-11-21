// Autenticação do webhook da Wiapy: o token cadastrado na integração vem CRU no cabeçalho Authorization
// (a doc mostra `authorization: seu_token_aqui`). Aceitamos também "Bearer <token>". Comparação em tempo constante.
import { safeEqual, sha256Hex } from "../hash";

export type WiapyAuthResult =
  | { ok: true; method: "authorization_header" }
  | { ok: false; reason: "no_secret_configured" | "missing_token" | "token_mismatch" };

export function verifyWiapyAuth(args: { header: string | null; secrets: (string | null | undefined)[] }): WiapyAuthResult {
  const secrets = args.secrets.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (!secrets.length) return { ok: false, reason: "no_secret_configured" };
  const raw = (args.header ?? "").trim();
  if (!raw) return { ok: false, reason: "missing_token" };
  const token = raw.replace(/^Bearer\s+/i, "").trim();
  return secrets.some((s) => safeEqual(token, s) || safeEqual(raw, s)) ? { ok: true, method: "authorization_header" } : { ok: false, reason: "token_mismatch" };
}

/**
 * Dono (uuid) do token da Wiapy de uma oferta no Vault. A tabela secret_refs só aceita os tipos meta_connection/pixel/cakto_webhook
 * e a chave é (tipo, dono): usamos o tipo cakto_webhook com um uuid DERIVADO da oferta (sha256("wiapy:<oferta>")) para não colidir
 * com o segredo do webhook da Cakto da mesma oferta — sem migration. O CLI (utmfy-cli.mjs) calcula igual.
 */
export function wiapyOwnerId(offerId: string): string {
  const h = sha256Hex(`wiapy:${offerId}`);
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
