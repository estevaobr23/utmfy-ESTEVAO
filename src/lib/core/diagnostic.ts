// Diagnóstico de uma URL de anúncio/landing: o que chegou, o que falta, o que
// seria enviado ao checkout.
import { decorateCheckoutUrl, pickTrackerParams } from "./checkout-url";
import { isMacro, parseUtms, safeDecode, UTM_KEYS, type ParsedUtms } from "./utm";

export type CheckLevel = "ok" | "warn" | "error";
export type Check = { level: CheckLevel; code: string; message: string };

export type DiagnosticResult = {
  valid: boolean;
  checks: Check[];
  params: Record<string, string | null>;
  parsed: ParsedUtms | null;
  fbclid: string | null;
  checkout: { url: string; added: string[]; kept: string[]; isCheckout: boolean } | null;
  sentParams: Record<string, string>;
  overall: CheckLevel;
};

const CAKTO_MAX_LEN = 255;

export function diagnoseUrl(input: string, opts: { checkoutUrl?: string | null; sessionId?: string } = {}): DiagnosticResult {
  const checks: Check[] = [];
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return {
      valid: false,
      checks: [{ level: "error", code: "INVALID_URL", message: "URL inválida. Cole a URL completa, com https://." }],
      params: {},
      parsed: null,
      fbclid: null,
      checkout: null,
      sentParams: {},
      overall: "error",
    };
  }

  const sp = url.searchParams;
  const params: Record<string, string | null> = {};
  for (const k of [...UTM_KEYS, "utm_id", "sck", "fbclid"]) params[k] = sp.get(k);

  for (const k of new Set([...sp.keys()])) {
    if (sp.getAll(k).length > 1) checks.push({ level: "warn", code: "DUPLICATED_PARAM", message: `${k} aparece ${sp.getAll(k).length} vezes na URL.` });
  }
  for (const [k, v] of Object.entries(params)) {
    if (v && v.length > CAKTO_MAX_LEN) checks.push({ level: "warn", code: "TOO_LONG", message: `${k} tem ${v.length} caracteres; a Cakto guarda até ${CAKTO_MAX_LEN}.` });
    // URLSearchParams já decodificou uma vez: sobrar %XX significa codificação dupla.
    if (v && (/%[0-9a-f]{2}/i.test(v) || safeDecode(v).encodingIssue)) checks.push({ level: "warn", code: "ENCODING_ISSUE", message: `${k} parece codificado duas vezes (ex.: %257C). Verifique o template.` });
  }

  const parsed = parseUtms(params);
  for (const issue of parsed.issues) {
    const level: CheckLevel =
      issue.code === "MACRO_UNRESOLVED" || issue.code === "NO_UTM" || issue.code === "MISSING_AD_ID" ? "error"
      : issue.code === "ENCODING_ISSUE" ? "warn"
      : "warn";
    if (issue.code === "ENCODING_ISSUE" && checks.some((c) => c.code === "ENCODING_ISSUE")) continue;
    checks.push({ level, code: issue.code, message: issue.message });
  }
  // Macros não resolvidas em qualquer parâmetro (inclusive fora dos UTM padrão)
  for (const [k, v] of sp.entries()) {
    if (!(UTM_KEYS as readonly string[]).includes(k) && isMacro(v)) {
      checks.push({ level: "error", code: "MACRO_UNRESOLVED", message: `${k} chegou como ${v} (macro não resolvida).` });
    }
  }

  const fbclid = sp.get("fbclid");
  if (!fbclid) {
    checks.push({ level: "warn", code: "NO_FBCLID", message: "fbclid ausente. Normal em teste manual; em clique real a Meta adiciona sozinha." });
  }
  if (parsed.campaign.id) checks.push({ level: "ok", code: "CAMPAIGN_ID", message: `campaign_id detectado: ${parsed.campaign.id}` });
  if (parsed.adset.id) checks.push({ level: "ok", code: "ADSET_ID", message: `adset_id detectado: ${parsed.adset.id}` });
  if (parsed.ad.id) checks.push({ level: "ok", code: "AD_ID", message: `ad_id detectado: ${parsed.ad.id}` });
  if (parsed.placement) checks.push({ level: "ok", code: "PLACEMENT", message: `placement detectado: ${parsed.placement}` });

  const sentParams = pickTrackerParams(sp);
  let checkout: DiagnosticResult["checkout"] = null;
  if (opts.checkoutUrl) {
    try {
      checkout = decorateCheckoutUrl(opts.checkoutUrl, sentParams, { sessionId: opts.sessionId ?? "sDIAGNOSTICO0000", callback: true });
      if (!checkout.isCheckout) {
        checks.push({ level: "warn", code: "NOT_CHECKOUT_DOMAIN", message: "A URL de checkout não é pay.cakto.com.br; o tracker não vai decorá-la (configure data-checkout-domains)." });
      } else if (checkout.kept.length) {
        checks.push({ level: "warn", code: "CHECKOUT_HAS_PARAMS", message: `O link de checkout já tem ${checkout.kept.join(", ")}; esses valores fixos serão mantidos e os do anúncio ignorados.` });
      }
    } catch {
      checks.push({ level: "error", code: "INVALID_CHECKOUT_URL", message: "URL de checkout inválida." });
    }
  }

  const overall: CheckLevel = checks.some((c) => c.level === "error") ? "error" : checks.some((c) => c.level === "warn") ? "warn" : "ok";
  return { valid: true, checks, params, parsed, fbclid, checkout, sentParams, overall };
}
