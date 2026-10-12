import { describe, expect, it } from "vitest";
import {
  adsetBidCap, adsetBudget, buildAdvancedIndex, campaignBidCap, campaignBudget, deriveVideo, indexVideo, minorToMajor, planBudgetChange,
  normalizeAdset, normalizeCampaign, normalizeReach, normalizeVideoInsight, reachWindows, rejectedField, scopeFromSpend,
  type AdsetConfig, type CampaignConfig, type RawVideoInsight, type VideoRow,
} from "@/lib/core/meta-advanced";
import { totalVideoRows, type MetaTableRow } from "@/lib/core/meta-metrics";
import { derive, emptySums } from "@/lib/core/metrics";

const camp = (p: Partial<CampaignConfig> = {}): CampaignConfig => ({
  account_id: "1", campaign_id: "C1", name: "c", effective_status: "ACTIVE", daily_budget_minor: null,
  lifetime_budget_minor: null, bid_strategy: "LOWEST_COST_WITHOUT_CAP", currency: "USD", meta_updated_time: null, ...p,
});
const adset = (p: Partial<AdsetConfig> = {}): AdsetConfig => ({
  account_id: "1", campaign_id: "C1", adset_id: "S1", name: "s", effective_status: "ACTIVE", daily_budget_minor: null,
  lifetime_budget_minor: null, bid_strategy: null, bid_amount_minor: null, bid_constraints: null, optimization_goal: null,
  billing_event: null, promoted_object: null, currency: "USD", meta_updated_time: null, ...p,
});

describe("moeda: unidade menor da Meta → valor de exibição", () => {
  it("USD/BRL em centavos; JPY/KRW sem casas decimais", () => {
    expect(minorToMajor("401", "USD")).toBe(4.01);
    expect(minorToMajor(5103, "BRL")).toBe(51.03);
    expect(minorToMajor("1500", "JPY")).toBe(1500);
    expect(minorToMajor("0", "USD")).toBeNull();
    expect(minorToMajor(null, "USD")).toBeNull();
  });
});

describe("orçamento CBO × ABO", () => {
  it("campanha com orçamento diário é CBO (valor real da API: daily_budget=401)", () => {
    const c = normalizeCampaign({ id: "C1", daily_budget: "401", bid_strategy: "LOWEST_COST_WITHOUT_CAP" }, "1", "USD")!;
    expect(campaignBudget(c)).toEqual({ mode: "CBO", amount: 4.01, period: "daily", currency: "USD", note: null });
  });
  it("orçamento vitalício é diferenciado do diário", () => {
    expect(campaignBudget(camp({ lifetime_budget_minor: 100000 }))).toMatchObject({ mode: "CBO", amount: 1000, period: "lifetime" });
  });
  it("campanha sem orçamento é ABO e aponta para o conjunto; conjunto mostra o valor", () => {
    const c = camp();
    expect(campaignBudget(c)).toMatchObject({ mode: "ABO", amount: null, note: "Orç. do conjunto" });
    expect(adsetBudget(adset({ daily_budget_minor: 2000 }), c)).toMatchObject({ mode: "ABO", amount: 20, period: "daily" });
  });
  it("conjunto de campanha CBO não inventa valor próprio", () => {
    expect(adsetBudget(adset(), camp({ daily_budget_minor: 401 }))).toMatchObject({ mode: "CBO", amount: null, note: "Orç. da campanha" });
  });
  it("orçamento zero é tratado como ausente", () => {
    expect(normalizeAdset({ id: "S", campaign_id: "C", daily_budget: "0" }, "1", "USD")!.daily_budget_minor).toBeNull();
  });
});

describe("bid cap", () => {
  it("só existe com LOWEST_COST_WITH_BID_CAP", () => {
    expect(adsetBidCap(adset({ bid_strategy: "LOWEST_COST_WITH_BID_CAP", bid_amount_minor: 1250 }))).toMatchObject({ amount: 12.5 });
  });
  it("bid_amount com COST_CAP NÃO é bid cap", () => {
    expect(adsetBidCap(adset({ bid_strategy: "COST_CAP", bid_amount_minor: 1250 }))).toMatchObject({ amount: null, strategy: "COST_CAP" });
  });
  it("sem limite (padrão das contas testadas) → sem valor", () => {
    expect(adsetBidCap(adset(), camp())).toMatchObject({ amount: null, strategy: "LOWEST_COST_WITHOUT_CAP" });
  });
  it("conjunto herda a estratégia da campanha CBO", () => {
    expect(adsetBidCap(adset({ bid_amount_minor: 300 }), camp({ bid_strategy: "LOWEST_COST_WITH_BID_CAP" }))).toMatchObject({ amount: 3 });
  });
  it("campanha: valor único vira o bid cap; valores diferentes viram 'Vários'", () => {
    const c = camp({ bid_strategy: "LOWEST_COST_WITH_BID_CAP" });
    expect(campaignBidCap(c, [adset({ bid_amount_minor: 300 }), adset({ adset_id: "S2", bid_amount_minor: 300 })])).toMatchObject({ amount: 3 });
    expect(campaignBidCap(c, [adset({ bid_amount_minor: 300 }), adset({ adset_id: "S2", bid_amount_minor: 500 })])).toMatchObject({ amount: null, note: "Vários" });
  });
});

// Linha real devolvida pela Graph v26.0 (anúncio de vídeo, 7 dias)
const RAW_VIDEO: RawVideoInsight = {
  account_id: "2094401681297034", campaign_id: "C1", adset_id: "S1", ad_id: "A1", date_start: "2026-10-04", impressions: "827",
  actions: [{ action_type: "link_click", value: "12" }, { action_type: "video_view", value: "190" }],
  video_play_actions: [{ action_type: "video_view", value: "799" }],
  video_6_sec_watched_actions: [{ action_type: "video_view", value: "118" }],
  video_15_sec_watched_actions: [{ action_type: "video_view", value: "69" }],
  video_thruplay_watched_actions: [{ action_type: "video_view", value: "69" }],
  video_p25_watched_actions: [{ action_type: "video_view", value: "70" }],
  video_p50_watched_actions: [{ action_type: "video_view", value: "40" }],
  video_p75_watched_actions: [{ action_type: "video_view", value: "34" }],
  video_p95_watched_actions: [{ action_type: "video_view", value: "26" }],
  video_p100_watched_actions: [{ action_type: "video_view", value: "25" }],
  video_avg_time_watched_actions: [{ action_type: "video_view", value: "5" }],
};

const vrow = (p: Partial<VideoRow>): VideoRow => ({
  account_id: "1", campaign_id: "C1", adset_id: "S1", ad_id: "A1", has_video: true, impressions: 0, video_plays: 0,
  plays_2s_continuous: null, plays_3s: 0, plays_6s: 0, plays_15s: 0, thruplays: 0, p25: 0, p50: 0, p75: 0, p95: 0, p100: 0,
  watch_seconds: 0, ...p,
});

describe("vídeo: normalização", () => {
  it("3s vem de actions[video_view]; 2s contínuo ausente fica null (não zero)", () => {
    const r = normalizeVideoInsight(RAW_VIDEO)!;
    expect(r).toMatchObject({ impressions: 827, plays_3s: 190, video_plays: 799, thruplays: 69, p25: 70, p100: 25, avg_watch_seconds: 5 });
    expect(r.plays_2s_continuous).toBeNull();
  });
  it("linha sem IDs é descartada", () => {
    expect(normalizeVideoInsight({ ...RAW_VIDEO, ad_id: undefined })).toBeNull();
  });
});

describe("vídeo: fórmulas e agregação", () => {
  it("hook, play rate e retenção do body com definição explícita", () => {
    const d = deriveVideo(indexVideo([vrow({ impressions: 827, video_plays: 799, plays_3s: 190, thruplays: 69, p25: 70, p100: 25, watch_seconds: 5 * 799 })], null).ad.get("A1"));
    expect(d.hook_rate).toBeCloseTo(190 / 827, 10);
    expect(d.play_rate).toBeCloseTo(799 / 827, 10);
    expect(d.body_retention).toBeCloseTo(69 / 190, 10);
    expect(d.retention_25).toBeCloseTo(70 / 799, 10);
    expect(d.retention_100).toBeCloseTo(25 / 799, 10);
    expect(d.avg_watch_seconds).toBeCloseTo(5, 10);
  });

  it("agrega numeradores e denominadores — nunca média simples de percentuais", () => {
    const rows = [
      vrow({ ad_id: "A1", impressions: 100, plays_3s: 50 }),   // 50%
      vrow({ ad_id: "A2", impressions: 900, plays_3s: 90 }),   // 10%
    ];
    const hook = deriveVideo(indexVideo(rows, null).campaign.get("C1")).hook_rate!;
    expect(hook).toBeCloseTo(140 / 1000, 10); // 14%, não 30%
  });

  it("anúncio de imagem (contagens espúrias de play) fica fora e dá N/D", () => {
    const img = vrow({ ad_id: "IMG", has_video: false, impressions: 546, video_plays: 6, plays_3s: null, thruplays: null, watch_seconds: 6 });
    const idx = indexVideo([img], null);
    expect(idx.ad.get("IMG")).toBeUndefined();
    expect(deriveVideo(idx.campaign.get("C1")).hook_rate).toBeNull();
  });

  it("imagem não dilui o hook da campanha mista", () => {
    const idx = indexVideo([
      vrow({ ad_id: "V", impressions: 1000, plays_3s: 300 }),
      vrow({ ad_id: "IMG", has_video: false, impressions: 1000, video_plays: 3, thruplays: null }),
    ], null);
    expect(deriveVideo(idx.campaign.get("C1")).hook_rate).toBeCloseTo(0.3, 10);
  });

  it("anúncio fora do catálogo conta como vídeo só se teve ThruPlay", () => {
    const idx = indexVideo([
      vrow({ ad_id: "X", has_video: null, impressions: 100, plays_3s: 30, thruplays: 10 }),
      vrow({ ad_id: "Y", has_video: null, impressions: 100, video_plays: 2, thruplays: null }),
    ], null);
    expect(idx.ad.has("X")).toBe(true);
    expect(idx.ad.has("Y")).toBe(false);
  });

  it("respeita o escopo da oferta (só anúncios com gasto no escopo)", () => {
    const idx = indexVideo([vrow({ ad_id: "A1", impressions: 10, plays_3s: 5 }), vrow({ ad_id: "A2", campaign_id: "C2", impressions: 10, plays_3s: 5 })], new Set(["A1"]));
    expect(idx.campaign.has("C2")).toBe(false);
  });

  it("total da tabela soma vídeo das linhas", () => {
    const row = (ads: number, impressions: number, plays_3s: number): MetaTableRow => ({
      id: String(ads), level: "campaign", name: "", accountId: null, campaignId: null, adsetId: null, status: null, lastSync: null,
      budget: null, bidCap: null, reach: null, frequency: null, metrics: derive(emptySums()), drillUrl: null, managerUrl: null, children: [],
      video: { impressions, plays: 0, plays_3s, plays_2s: 0, plays_6s: 0, plays_15s: 0, thruplays: 0, p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, watch_seconds: 0, ads },
    });
    const total = totalVideoRows([row(1, 100, 50), row(1, 900, 90)]);
    expect(deriveVideo(total).hook_rate).toBeCloseTo(0.14, 10);
  });
});

describe("alcance e frequência", () => {
  it("usa o valor deduplicado da Meta, não impressões ÷ Σ alcance diário", () => {
    // Real: período 7d campanha 120249335249480650 → reach 700, freq 1.181429; Σ diário = 712 (1.162)
    const r = normalizeReach({ account_id: "1", campaign_id: "C1", impressions: "827", reach: "700", frequency: "1.181429" }, "campaign", "2026-10-04", "2026-10-10")!;
    expect(r).toMatchObject({ level: "campaign", object_id: "C1", reach: 700, frequency: 1.181429 });
  });
  it("janelas predefinidas são únicas e no fuso informado", () => {
    const w = reachWindows("America/Sao_Paulo", new Date("2026-10-11T15:00:00Z"));
    expect(w).toContainEqual({ since: "2026-10-05", until: "2026-10-11" });
    expect(w).toContainEqual({ since: "2026-10-11", until: "2026-10-11" });
    expect(new Set(w.map((x) => `${x.since}|${x.until}`)).size).toBe(w.length);
  });
  it("alcance da conta vira N/D dentro de oferta; campanha continua exata", () => {
    const data = { campaigns: [], adsets: [], video: [], reach: [
      { level: "account" as const, object_id: "1", reach: 5000, frequency: 1.3 },
      { level: "campaign" as const, object_id: "C1", reach: 700, frequency: "1.181429" },
    ] };
    const inOffer = buildAdvancedIndex(data, null, { offerScoped: true });
    expect(inOffer.extras("account", "1").frequency).toBeNull();
    expect(inOffer.extras("campaign", "C1").frequency).toBeCloseTo(1.181429, 6);
    expect(inOffer.totalReach({ campaign: null, adset: null, accountIds: ["1"] }).frequency).toBeNull();
    expect(inOffer.totalReach({ campaign: "C1", adset: null, accountIds: ["1"] }).reach).toBe(700);
    const noOffer = buildAdvancedIndex(data, null, { offerScoped: false });
    expect(noOffer.totalReach({ campaign: null, adset: null, accountIds: ["1"] }).frequency).toBe(1.3);
    expect(noOffer.totalReach({ campaign: null, adset: null, accountIds: ["1", "2"] }).frequency).toBeNull();
  });
  it("objeto fora do escopo de gasto (ex.: oferta sem campanhas associadas) não mostra alcance", () => {
    const data = { campaigns: [], adsets: [], video: [], reach: [{ level: "ad" as const, object_id: "A9", reach: 509, frequency: 1.19 }] };
    const scope = scopeFromSpend([{ account_id: "1", campaign_id: "C1", adset_id: "S1", ad_id: "A1" }]);
    expect(buildAdvancedIndex(data, scope, { offerScoped: true }).extras("ad", "A9").reach).toBeNull();
    const inScope = scopeFromSpend([{ account_id: "1", campaign_id: "C1", adset_id: "S1", ad_id: "A9" }]);
    expect(buildAdvancedIndex(data, inScope, { offerScoped: true }).extras("ad", "A9").reach).toBe(509);
  });
  it("sem linha de período (personalizado) → N/D", () => {
    const idx = buildAdvancedIndex({ campaigns: [], adsets: [], video: [], reach: [] }, null, { offerScoped: false });
    expect(idx.extras("campaign", "C1")).toMatchObject({ reach: null, frequency: null, video: null, budget: null });
  });
});

describe("orçamento e lance exibidos em reais", () => {
  const data = { campaigns: [camp({ daily_budget_minor: 401 }), camp({ campaign_id: "C2", daily_budget_minor: 200 })], adsets: [], video: [], reach: [] };
  it("converte pela PTAX: US$ 4,01 → R$ 20,01 e US$ 2,00 → R$ 9,98 (igual à UTMify)", () => {
    const idx = buildAdvancedIndex(data, null, { offerScoped: false, fx: { target: "BRL", rates: { USD: 4.9892 } } });
    expect(idx.extras("campaign", "C1").budget).toMatchObject({ amount: 20.01, currency: "BRL", period: "daily" });
    expect(idx.extras("campaign", "C2").budget).toMatchObject({ amount: 9.98, currency: "BRL" });
  });
  it("sem cotação, mantém a moeda da conta em vez de inventar valor", () => {
    const idx = buildAdvancedIndex(data, null, { offerScoped: false, fx: { target: "BRL", rates: {} } });
    expect(idx.extras("campaign", "C1").budget).toMatchObject({ amount: 4.01, currency: "USD" });
  });
});

describe("troca de orçamento diário em reais", () => {
  const base = { currentMinor: 401, currency: "USD", targetCurrency: "BRL", rate: 4.9892 };
  it("R$ 25,00 a 4,9892 → US$ 5,01 (501 centavos)", () => {
    expect(planBudgetChange({ ...base, requested: 25 })).toEqual({ ok: true, newMinor: 501, newMajor: 5.01 });
  });
  it("recusa valor inválido, sem cotação e aumento acima de 5×", () => {
    expect(planBudgetChange({ ...base, requested: 0 }).ok).toBe(false);
    expect(planBudgetChange({ ...base, requested: 25, rate: null }).ok).toBe(false);
    expect(planBudgetChange({ ...base, requested: 500 })).toMatchObject({ ok: false });
  });
  it("conta já em reais não precisa de cotação", () => {
    expect(planBudgetChange({ currentMinor: 2000, currency: "BRL", targetCurrency: "BRL", rate: null, requested: 25 })).toMatchObject({ ok: true, newMinor: 2500 });
  });
});

describe("campo rejeitado pela Graph", () => {
  it("identifica o campo no texto do erro", () => {
    expect(rejectedField("(#100) video_continuous_2_sec_watched_actions is not valid for fields param", ["impressions", "video_continuous_2_sec_watched_actions"])).toBe("video_continuous_2_sec_watched_actions");
    expect(rejectedField("Invalid parameter", ["impressions"])).toBeNull();
  });
});
