// Validação de origem do webhook da Hotmart.
// A Hotmart não assina o corpo: envia o "hottok" (token do webhook, o mesmo para toda a conta) no cabeçalho
// X-HOTMART-HOTTOK e, na v2, também no corpo (`hottok`). Comparamos em tempo constante com o(s) token(s) configurado(s).
import { safeEqual } from "../hash";

export type HottokResult =
  | { ok: true; method: "hottok_header" | "hottok_body" }
  | { ok: false; reason: "no_secret_configured" | "missing_hottok" | "hottok_mismatch" };

export function verifyHottok(args: { headerToken: string | null; bodyToken: string | null; secrets: string[] }): HottokResult {
  const secrets = args.secrets.filter((s) => s.length > 0);
  if (secrets.length === 0) return { ok: false, reason: "no_secret_configured" };
  const candidates: ["hottok_header" | "hottok_body", string][] = [];
  if (args.headerToken?.trim()) candidates.push(["hottok_header", args.headerToken.trim()]);
  if (args.bodyToken?.trim()) candidates.push(["hottok_body", args.bodyToken.trim()]);
  if (candidates.length === 0) return { ok: false, reason: "missing_hottok" };
  for (const [method, token] of candidates) {
    if (secrets.some((s) => safeEqual(token, s))) return { ok: true, method };
  }
  return { ok: false, reason: "hottok_mismatch" };
}
