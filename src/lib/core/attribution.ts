// Motor de atribuição (puro). Prioridade: ID EXATO > UTM parseada > nome exato.
// Nunca faz fuzzy matching: "não rastreada" é melhor que atribuição falsa.
import { parseUtms, type ParsedUtms, type UtmInput, type UtmIssue } from "./utm";

export type AttributionStatus = "EXACT_ID" | "UTM_PARSED" | "NAME_MATCH" | "ORGANIC" | "DIRECT" | "UNTRACKED" | "UNKNOWN";

export type UntrackedReason =
  | "no_utm"
  | "missing_campaign_id"
  | "missing_ad_id"
  | "ad_id_not_found"
  | "ad_not_synced"
  | "macro_unresolved"
  | "offer_not_mapped"
  | "source_unknown"
  | "params_lost"
  | "ambiguous_name"
  | "name_not_found"
  | "id_conflict";

export const REASON_LABELS: Record<UntrackedReason, string> = {
  no_utm: "Nenhuma UTM recebida",
  missing_campaign_id: "campaign_id ausente",
  missing_ad_id: "ad_id ausente",
  ad_id_not_found: "ad_id não encontrado nas contas sincronizadas",
  ad_not_synced: "Anúncio ainda não sincronizado da Meta",
  macro_unresolved: "Macro da Meta não resolvida",
  offer_not_mapped: "Produto/oferta Cakto não mapeado a nenhuma oferta",
  source_unknown: "utm_source desconhecida",
  params_lost: "Parâmetros perdidos entre a página e o checkout",
  ambiguous_name: "Nome corresponde a mais de um anúncio/campanha",
  name_not_found: "Nome não encontrado no catálogo da Meta",
  id_conflict: "IDs da UTM não batem com a estrutura da Meta",
};

export type CatalogAd = {
  account_id: string;
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
};

/** Catálogo já carregado (somente as contas das ofertas relevantes). */
export type Catalog = {
  ads: CatalogAd[];
  /** true se já existe ao menos uma sincronização de catálogo concluída. */
  synced: boolean;
};

export type SessionTouch = {
  session_id: string;
  utms: UtmInput;
  referrer_host: string | null;
} | null;

export type AttributionInput = {
  utms: UtmInput;
  session?: SessionTouch;
  catalog: Catalog;
  offerMapped: boolean;
};

export type AttributionResult = {
  status: AttributionStatus;
  method: string;
  reason: UntrackedReason | null;
  account_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  placement: string | null;
  issues: (UtmIssue | { code: string; message: string })[];
  parsed: ParsedUtms;
  usedParams: "order" | "session";
};

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function hasUsefulUtm(u: UtmInput) {
  return ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].some(
    (k) => typeof u[k as keyof UtmInput] === "string" && (u[k as keyof UtmInput] as string).trim() !== "",
  );
}

export function attribute(input: AttributionInput): AttributionResult {
  // 1) de onde vêm os parâmetros: pedido (Cakto) > sessão do nosso tracker
  let usedParams: "order" | "session" = "order";
  let utms = input.utms;
  const session = input.session ?? null;
  if (!hasUsefulUtm(utms) && session && hasUsefulUtm(session.utms)) {
    utms = session.utms;
    usedParams = "session";
  }
  const parsed = parseUtms(utms);
  const issues: AttributionResult["issues"] = [...parsed.issues];
  if (usedParams === "session") {
    issues.push({ code: "PARAMS_FROM_TRACKER", message: "UTMs não chegaram na Cakto; usadas as do tracker (callback)." });
  }
  if (!input.offerMapped) issues.push({ code: "OFFER_NOT_MAPPED", message: REASON_LABELS.offer_not_mapped });

  const base = {
    parsed,
    usedParams,
    issues,
    placement: parsed.placement,
    account_id: null as string | null,
    campaign_id: parsed.campaign.id,
    campaign_name: parsed.campaign.name,
    adset_id: parsed.adset.id,
    adset_name: parsed.adset.name,
    ad_id: parsed.ad.id,
    ad_name: parsed.ad.name,
  };
  const method = (m: string) => (usedParams === "session" ? `${m}+tracker_session` : m);
  // Atribuição ok mas produto sem oferta interna: aparece em Não rastreadas com esse motivo.
  const withReason = (r: UntrackedReason | null): UntrackedReason | null => (!input.offerMapped && r === null ? "offer_not_mapped" : r);

  // 2) sem UTM nenhuma
  if (!parsed.hasAnyUtm) {
    if (session && !session.referrer_host) {
      return { ...base, status: "DIRECT", method: method("no_params"), reason: input.offerMapped ? null : "offer_not_mapped" };
    }
    return {
      ...base,
      status: "UNTRACKED",
      method: "none",
      reason: session && hasUsefulUtm(session.utms) ? "params_lost" : input.offerMapped ? "no_utm" : "offer_not_mapped",
    };
  }

  const ads = input.catalog.ads;
  const byAd = parsed.ad.id ? ads.find((a) => a.ad_id === parsed.ad.id) : undefined;

  // 3) ID exato do anúncio
  if (byAd) {
    const conflict =
      (parsed.campaign.id && parsed.campaign.id !== byAd.campaign_id) || (parsed.adset.id && parsed.adset.id !== byAd.adset_id);
    if (conflict) issues.push({ code: "ID_CONFLICT", message: REASON_LABELS.id_conflict + " (valendo o ad_id)." });
    return {
      ...base,
      status: "EXACT_ID",
      method: method("ad_id"),
      reason: withReason(null),
      account_id: byAd.account_id,
      campaign_id: byAd.campaign_id,
      campaign_name: byAd.campaign_name ?? parsed.campaign.name,
      adset_id: byAd.adset_id,
      adset_name: byAd.adset_name ?? parsed.adset.name,
      ad_id: byAd.ad_id,
      ad_name: byAd.ad_name ?? parsed.ad.name,
    };
  }

  // 4) sem anúncio no catálogo, mas com IDs de conjunto/campanha
  const byAdset = parsed.adset.id ? ads.find((a) => a.adset_id === parsed.adset.id) : undefined;
  const byCampaign = parsed.campaign.id ? ads.find((a) => a.campaign_id === parsed.campaign.id) : undefined;
  const anyId = parsed.ad.id || parsed.adset.id || parsed.campaign.id;

  if (anyId) {
    const anchor = byAdset ?? byCampaign;
    if (anchor && byAdset && parsed.campaign.id && byAdset.campaign_id !== parsed.campaign.id) {
      issues.push({ code: "ID_CONFLICT", message: REASON_LABELS.id_conflict });
    }
    const reason: UntrackedReason | null = parsed.ad.id
      ? input.catalog.synced ? "ad_id_not_found" : "ad_not_synced"
      : parsed.ad.unresolvedMacro ? "macro_unresolved" : "missing_ad_id";
    return {
      ...base,
      // Achou a estrutura por ID (campanha/conjunto) → EXACT_ID no nível encontrado; senão só UTM parseada.
      status: anchor && !parsed.ad.id ? "EXACT_ID" : "UTM_PARSED",
      method: method(byAdset ? "adset_id" : byCampaign ? "campaign_id" : "utm_ids"),
      reason,
      account_id: anchor?.account_id ?? null,
      campaign_id: byAdset?.campaign_id ?? parsed.campaign.id,
      campaign_name: (byAdset ?? byCampaign)?.campaign_name ?? parsed.campaign.name,
      adset_id: parsed.adset.id,
      adset_name: byAdset?.adset_name ?? parsed.adset.name,
      ad_id: parsed.ad.id,
      ad_name: parsed.ad.name,
    };
  }

  // 5) todas as macros vieram literais
  const macroEverywhere = [parsed.campaign, parsed.adset, parsed.ad].every((p) => p.unresolvedMacro || !p.raw) &&
    [parsed.campaign, parsed.adset, parsed.ad].some((p) => p.unresolvedMacro);
  if (macroEverywhere) {
    return { ...base, status: "UNKNOWN", method: "none", reason: "macro_unresolved" };
  }

  // 6) só nomes → match EXATO (case-insensitive) e ÚNICO
  const hasNames = parsed.campaign.name || parsed.adset.name || parsed.ad.name;
  if (hasNames && (parsed.sourceKind === "meta" || parsed.sourceKind === "none")) {
    const candidates = ads.filter(
      (a) =>
        (!parsed.campaign.name || lower(a.campaign_name) === lower(parsed.campaign.name)) &&
        (!parsed.adset.name || lower(a.adset_name) === lower(parsed.adset.name)) &&
        (!parsed.ad.name || lower(a.ad_name) === lower(parsed.ad.name)),
    );
    const level = parsed.ad.name ? "ad" : parsed.adset.name ? "adset" : "campaign";
    const distinct = new Set(
      candidates.map((c) => (level === "ad" ? c.ad_id : level === "adset" ? c.adset_id : c.campaign_id)),
    );
    if (distinct.size === 1) {
      const c = candidates[0];
      return {
        ...base,
        status: "NAME_MATCH",
        method: method(`name_${level}`),
        reason: withReason(null),
        account_id: c.account_id,
        campaign_id: c.campaign_id,
        campaign_name: c.campaign_name,
        adset_id: level === "campaign" ? null : c.adset_id,
        adset_name: level === "campaign" ? parsed.adset.name : c.adset_name,
        ad_id: level === "ad" ? c.ad_id : null,
        ad_name: level === "ad" ? c.ad_name : parsed.ad.name,
      };
    }
    return {
      ...base,
      status: "UNKNOWN",
      method: "none",
      reason: distinct.size > 1 ? "ambiguous_name" : input.catalog.synced ? "name_not_found" : "ad_not_synced",
    };
  }

  // 7) origem orgânica / outra origem sem IDs
  if (parsed.sourceKind === "organic") {
    return { ...base, status: "ORGANIC", method: method("utm_source"), reason: withReason(null) };
  }
  if (parsed.sourceKind === "other") {
    return { ...base, status: "UNKNOWN", method: "none", reason: "source_unknown" };
  }
  return { ...base, status: "UNKNOWN", method: "none", reason: parsed.source ? "missing_campaign_id" : "source_unknown" };
}

/** Status que contam como "rastreado" nos relatórios de campanha. */
export const TRACKED_STATUSES: AttributionStatus[] = ["EXACT_ID", "UTM_PARSED", "NAME_MATCH"];
export const UNTRACKED_STATUSES: AttributionStatus[] = ["UNTRACKED", "UNKNOWN"];
