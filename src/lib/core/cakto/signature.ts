// Validação de origem do webhook Cakto.
// Doc: HMAC-SHA256(secret, `${X-Cakto-Timestamp}.${corpo cru}`) → header
// X-Cakto-Signature: "v1=<hex>" (futuramente "v1=...,v2=..."). Tolerância: 5 min.
import { hmacSha256Hex, safeEqual } from "../hash";

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type SignatureResult =
  | { ok: true; method: "header_hmac" | "body_secret"; timestamp: number | null }
  | { ok: false; reason: SignatureFailure };

export type SignatureFailure =
  | "no_secret_configured"
  | "missing_headers"
  | "invalid_timestamp"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch"
  | "body_secret_mismatch"
  | "body_secret_not_allowed";

export function parseSignatureHeader(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3).trim().toLowerCase())
    .filter((p) => /^[0-9a-f]{64}$/.test(p));
}

export function verifyCaktoWebhook(args: {
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  bodySecret: string | null;
  secrets: string[];
  nowSeconds?: number;
  allowBodySecret?: boolean;
  toleranceSeconds?: number;
}): SignatureResult {
  const secrets = args.secrets.filter((s) => s.length > 0);
  if (secrets.length === 0) return { ok: false, reason: "no_secret_configured" };
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = args.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;

  const sigs = parseSignatureHeader(args.signatureHeader);
  if (args.timestampHeader && sigs.length > 0) {
    if (!/^\d{9,11}$/.test(args.timestampHeader.trim())) return { ok: false, reason: "invalid_timestamp" };
    const ts = Number(args.timestampHeader.trim());
    if (Math.abs(now - ts) > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };
    for (const secret of secrets) {
      const expected = hmacSha256Hex(secret, [`${ts}.`, args.rawBody]);
      if (sigs.some((s) => safeEqual(s, expected))) return { ok: true, method: "header_hmac", timestamp: ts };
    }
    return { ok: false, reason: "signature_mismatch" };
  }

  // Sem headers: a doc ainda aceita o campo `secret` do corpo (menos seguro).
  if (!args.allowBodySecret) return { ok: false, reason: args.bodySecret ? "body_secret_not_allowed" : "missing_headers" };
  if (!args.bodySecret) return { ok: false, reason: "missing_headers" };
  for (const secret of secrets) {
    if (safeEqual(args.bodySecret, secret)) return { ok: true, method: "body_secret", timestamp: null };
  }
  return { ok: false, reason: "body_secret_mismatch" };
}
