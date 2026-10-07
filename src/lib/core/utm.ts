// Parser resiliente de UTMs no padrão:
//   utm_source   = origem/plataforma (FB, ig, facebook...)
//   utm_campaign = CAMPAIGN_NAME|CAMPAIGN_ID
//   utm_medium   = ADSET_NAME|ADSET_ID
//   utm_content  = AD_NAME|AD_ID
//   utm_term     = PLACEMENT
// Também aceita só nomes, só IDs, ID|NOME e sufixos "Nome - 1234567890123".
// IDs externos são a referência principal; nomes são apenas descritivos.

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export type UtmInput = Partial<Record<UtmKey | "sck" | "utm_id" | "fbclid", string | null | undefined>>;

export type ParsedPart = {
  raw: string | null;
  name: string | null;
  id: string | null;
  unresolvedMacro: boolean;
  encodingIssue: boolean;
};

export type UtmIssueCode =
  | "NO_UTM"
  | "MACRO_UNRESOLVED"
  | "ENCODING_ISSUE"
  | "MISSING_CAMPAIGN_ID"
  | "MISSING_ADSET_ID"
  | "MISSING_AD_ID"
  | "MISSING_SOURCE"
  | "MISSING_PLACEMENT";

export type UtmIssue = { code: UtmIssueCode; field?: string; message: string };

export type ParsedUtms = {
  source: string | null;
  sourceKind: "meta" | "organic" | "other" | "none";
  campaign: ParsedPart;
  adset: ParsedPart;
  ad: ParsedPart;
  placement: string | null;
  placementUnresolved: boolean;
  hasAnyUtm: boolean;
  issues: UtmIssue[];
};

// Meta usa IDs numéricos longos (normalmente 15–18 dígitos).
const ID_WITH_SEPARATOR = /^\d{6,20}$/;
const ID_SUFFIX = /^(.*?)[\s]*[-_:~#][\s]*(\d{12,20})$/;
// {{campaign.name}}, {campaign.name}, %7B%7B...%7D%7D, [[x]], ${x}
const MACRO = /\{\{[^}]*\}\}|\{[a-z_]+(?:\.[a-z_]+)*\}|%7B%7B|\$\{[^}]*\}/i;

const META_SOURCES = new Set([
  "fb", "facebook", "ig", "instagram", "meta", "an", "msg", "messenger", "audience_network",
  "facebook_ads", "fb_ads", "meta_ads", "facebookads", "metaads", "threads", "th",
]);
const ORGANIC_SOURCES = new Set([
  "organic", "organico", "orgânico", "bio", "instagram_bio", "ig_bio", "linktree", "linkinbio", "email",
  "newsletter", "whatsapp", "wpp", "zap", "telegram", "youtube_organic", "direct", "direto", "stories_organic",
]);

export function isMacro(value: string | null | undefined): boolean {
  return !!value && MACRO.test(value);
}

/** Decodifica %xx e '+' com segurança (inclusive valores duplamente codificados). */
export function safeDecode(value: string): { value: string; encodingIssue: boolean } {
  let out = value;
  let issue = false;
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(out); i++) {
    try {
      const next = decodeURIComponent(out.replace(/\+/g, " "));
      if (i >= 1) issue = true; // chegou codificado mais de uma vez
      out = next;
    } catch {
      issue = true;
      break;
    }
  }
  if (out.includes("�")) issue = true;
  return { value: out, encodingIssue: issue };
}

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t === "" || t.toLowerCase() === "null" || t.toLowerCase() === "undefined" ? null : t;
}

export function parsePart(input: string | null | undefined): ParsedPart {
  const raw = clean(input);
  const empty: ParsedPart = { raw, name: null, id: null, unresolvedMacro: false, encodingIssue: false };
  if (!raw) return empty;

  const { value, encodingIssue } = safeDecode(raw);
  const v = value.trim();
  if (isMacro(v)) return { ...empty, unresolvedMacro: true, encodingIssue };

  if (v.includes("|")) {
    const parts = v.split("|").map((p) => p.trim()).filter((p) => p !== "");
    const last = parts[parts.length - 1];
    const first = parts[0];
    if (last && ID_WITH_SEPARATOR.test(last)) {
      // preserva o nome original (inclusive "|" internos), só remove o "|ID" final
      const name = v.slice(0, v.lastIndexOf("|")).trim() || null;
      return { raw, name: name && !isMacro(name) ? name : null, id: last, unresolvedMacro: !!name && isMacro(name), encodingIssue };
    }
    if (first && ID_WITH_SEPARATOR.test(first) && parts.length > 1) {
      return { raw, name: v.slice(v.indexOf("|") + 1).trim(), id: first, unresolvedMacro: false, encodingIssue };
    }
    return { raw, name: v, id: null, unresolvedMacro: false, encodingIssue };
  }

  if (ID_WITH_SEPARATOR.test(v)) return { raw, name: null, id: v, unresolvedMacro: false, encodingIssue };

  const suffix = v.match(ID_SUFFIX);
  if (suffix && suffix[1].trim() !== "") {
    return { raw, name: suffix[1].trim(), id: suffix[2], unresolvedMacro: false, encodingIssue };
  }
  return { raw, name: v, id: null, unresolvedMacro: false, encodingIssue };
}

export function classifySource(source: string | null): ParsedUtms["sourceKind"] {
  if (!source) return "none";
  const s = source.trim().toLowerCase();
  if (ORGANIC_SOURCES.has(s) || s.includes("organic") || s.includes("organico")) return "organic";
  if (META_SOURCES.has(s) || /^(facebook|instagram|fb|ig|meta)([_-]|$)/.test(s)) return "meta";
  return "other";
}

export function parseUtms(input: UtmInput): ParsedUtms {
  const issues: UtmIssue[] = [];
  const sourceRaw = clean(input.utm_source);
  const sourceDecoded = sourceRaw ? safeDecode(sourceRaw).value : null;
  const sourceMacro = isMacro(sourceDecoded);
  const source = sourceMacro ? null : sourceDecoded;

  const campaign = parsePart(input.utm_campaign);
  const adset = parsePart(input.utm_medium);
  const ad = parsePart(input.utm_content);

  // utm_id (quando existir) é outro lugar comum para o ID da campanha.
  const utmId = clean(input.utm_id);
  if (!campaign.id && utmId && ID_WITH_SEPARATOR.test(utmId)) campaign.id = utmId;

  const termRaw = clean(input.utm_term);
  const termDecoded = termRaw ? safeDecode(termRaw).value : null;
  const placementUnresolved = isMacro(termDecoded);
  const placement = placementUnresolved ? null : termDecoded;

  const hasAnyUtm = UTM_KEYS.some((k) => clean(input[k]) !== null);
  if (!hasAnyUtm) {
    issues.push({ code: "NO_UTM", message: "Nenhuma UTM recebida." });
  }

  const fields: [string, ParsedPart | null, boolean][] = [
    ["utm_source", null, sourceMacro],
    ["utm_campaign", campaign, campaign.unresolvedMacro],
    ["utm_medium", adset, adset.unresolvedMacro],
    ["utm_content", ad, ad.unresolvedMacro],
    ["utm_term", null, placementUnresolved],
  ];
  for (const [field, part, macro] of fields) {
    if (macro) {
      const raw = part?.raw ?? (field === "utm_source" ? sourceRaw : termRaw);
      issues.push({ code: "MACRO_UNRESOLVED", field, message: `${field} chegou como ${raw} (macro não resolvida pela Meta).` });
    }
    if (part?.encodingIssue) {
      issues.push({ code: "ENCODING_ISSUE", field, message: `${field} parece codificado mais de uma vez ou com caracteres inválidos.` });
    }
  }

  const sourceKind = classifySource(source);
  if (hasAnyUtm) {
    if (!source && !sourceMacro) issues.push({ code: "MISSING_SOURCE", field: "utm_source", message: "utm_source ausente." });
    if (sourceKind === "meta" || campaign.id || adset.id || ad.id) {
      if (!campaign.id && !campaign.unresolvedMacro) issues.push({ code: "MISSING_CAMPAIGN_ID", field: "utm_campaign", message: "campaign_id ausente em utm_campaign." });
      if (!adset.id && !adset.unresolvedMacro) issues.push({ code: "MISSING_ADSET_ID", field: "utm_medium", message: "adset_id ausente em utm_medium." });
      if (!ad.id && !ad.unresolvedMacro) issues.push({ code: "MISSING_AD_ID", field: "utm_content", message: "ad_id ausente em utm_content." });
      if (!placement && !placementUnresolved) issues.push({ code: "MISSING_PLACEMENT", field: "utm_term", message: "Posicionamento ausente em utm_term." });
    }
  }

  return {
    source,
    sourceKind: source ? sourceKind : sourceMacro ? "meta" : "none",
    campaign,
    adset,
    ad,
    placement,
    placementUnresolved,
    hasAnyUtm,
    issues,
  };
}
