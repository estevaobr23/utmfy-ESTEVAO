import "server-only";
import type { Db } from "../supabase/types";
import { BID_CAP_STRATEGY, planBidChange } from "../core/meta-advanced";
import { ensureEnvConnection, getMetaToken } from "./meta-sync";
import { MetaApiError, MetaClient } from "./meta-client";
import { logEvent } from "./logs";

// Edição do BID CAP (limite de lance) direto pela ferramenta. O lance mora no CONJUNTO (`bid_amount`); a estratégia
// "limite de lance" mora na campanha (CBO) ou no próprio conjunto. Por isso, editar a linha de uma campanha aplica o
// mesmo valor em todos os conjuntos dela que usam bid cap. O valor chega na moeda do workspace (R$) e é convertido
// para a moeda da conta pela mesma cotação do orçamento; é gravado na Meta e espelhado no banco.

export type BidUpdate = { name: string; currency: string; adsets: number; beforeMinor: number[]; afterMinor: number; rate: number | null };

export async function updateMetaBidCap(
  db: Db,
  workspaceId: string,
  input: { level: "campaign" | "adset"; objectId: string; requested: number; workspaceCurrency: string },
): Promise<{ ok: true; update: BidUpdate } | { ok: false; error: string }> {
  if (!/^\d{1,30}$/.test(input.objectId)) return { ok: false, error: "ID Meta inválido." };

  type AdsetRow = { adset_id: string; account_id: string; name: string | null; bid_strategy: string | null; bid_amount_minor: number | null; currency: string | null; campaign_id: string };
  let name: string;
  let campaignStrategy: string | null = null;
  let adsets: AdsetRow[];
  const cols = "adset_id, account_id, name, bid_strategy, bid_amount_minor, currency, campaign_id";
  if (input.level === "campaign") {
    const { data: campaign } = await db.from("meta_campaigns").select("name, bid_strategy").eq("workspace_id", workspaceId).eq("campaign_id", input.objectId).maybeSingle();
    if (!campaign) return { ok: false, error: "Campanha não encontrada neste workspace." };
    name = String(campaign.name ?? input.objectId);
    campaignStrategy = (campaign.bid_strategy as string | null) ?? null;
    const { data } = await db.from("meta_adsets").select(cols).eq("workspace_id", workspaceId).eq("campaign_id", input.objectId);
    adsets = (data ?? []) as AdsetRow[];
  } else {
    const { data: adset } = await db.from("meta_adsets").select(cols).eq("workspace_id", workspaceId).eq("adset_id", input.objectId).maybeSingle();
    if (!adset) return { ok: false, error: "Conjunto não encontrado neste workspace." };
    name = String(adset.name ?? input.objectId);
    adsets = [adset as AdsetRow];
    const { data: campaign } = await db.from("meta_campaigns").select("bid_strategy").eq("workspace_id", workspaceId).eq("campaign_id", (adset as AdsetRow).campaign_id).maybeSingle();
    campaignStrategy = (campaign?.bid_strategy as string | null) ?? null;
  }

  // Só conjuntos cuja estratégia efetiva é "limite de lance" (cost cap e ROAS mínimo não são bid cap).
  const targets = adsets.filter((a) => (a.bid_strategy ?? campaignStrategy) === BID_CAP_STRATEGY);
  if (!targets.length) return { ok: false, error: "Esta campanha/conjunto não usa a estratégia “limite de lance” (bid cap)." };
  const currencies = [...new Set(targets.map((a) => String(a.currency ?? "")))];
  if (currencies.length !== 1 || !currencies[0]) return { ok: false, error: "Moeda da conta desconhecida ou mista." };
  const currency = currencies[0];
  const accountIds = [...new Set(targets.map((a) => a.account_id))];
  if (accountIds.length !== 1) return { ok: false, error: "Conjuntos de contas diferentes: edite um conjunto por vez." };

  const { data: account } = await db.from("meta_ad_accounts").select("connection_id, fx_rate, active").eq("workspace_id", workspaceId).eq("account_id", accountIds[0]).maybeSingle();
  if (!account?.active) return { ok: false, error: "Conta de anúncios inativa na ferramenta." };

  let rate: number | null = null;
  if (currency !== input.workspaceCurrency) {
    const { data: fx } = await db.from("fx_rates").select("rate").eq("currency", currency).order("date", { ascending: false }).limit(1);
    rate = Number(fx?.[0]?.rate) > 0 ? Number(fx![0].rate) : Number(account.fx_rate) > 0 ? Number(account.fx_rate) : null;
  }
  const currentMax = Math.max(...targets.map((a) => Number(a.bid_amount_minor) || 0));
  const plan = planBidChange({ requested: input.requested, currentMinor: currentMax > 0 ? currentMax : null, currency, targetCurrency: input.workspaceCurrency, rate });
  if (!plan.ok) return { ok: false, error: plan.reason };

  const conns = await ensureEnvConnection(db, workspaceId);
  const conn = conns.find((c) => c.id === account.connection_id) ?? conns[0];
  const token = conn ? await getMetaToken(db, conn) : null;
  if (!token) return { ok: false, error: "Token da Meta indisponível." };

  const client = new MetaClient(token);
  const done: AdsetRow[] = [];
  const failed: string[] = [];
  for (const a of targets) {
    try {
      await client.post(a.adset_id, { bid_amount: plan.newMinor });
      await db.from("meta_adsets").update({ bid_amount_minor: plan.newMinor, synced_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("adset_id", a.adset_id);
      done.push(a);
    } catch (e) {
      const message = e instanceof MetaApiError ? `${e.kind}: ${e.message}` : (e as Error).message;
      failed.push(`“${a.name ?? a.adset_id}”: ${message.slice(0, 160)}`);
      await logEvent(db, { workspaceId, level: "error", code: "META_BID_UPDATE_FAILED", provider: "meta", message: message.slice(0, 300), context: { adset_id: a.adset_id, attempted_minor: plan.newMinor } });
    }
  }
  if (!done.length) return { ok: false, error: `A Meta recusou a mudança — ${failed.join(" · ")}` };

  const update: BidUpdate = { name, currency, adsets: done.length, beforeMinor: done.map((a) => Number(a.bid_amount_minor) || 0), afterMinor: plan.newMinor, rate };
  await logEvent(db, {
    workspaceId, level: failed.length ? "warn" : "info", code: "META_BID_UPDATED", provider: "meta",
    message: `${name}: bid cap → ${plan.newMinor} (${currency}, unidade menor) em ${done.length} conjunto(s)`,
    context: { level: input.level, object_id: input.objectId, adsets: done.map((a) => a.adset_id), before_minor: update.beforeMinor, after_minor: plan.newMinor, currency, rate, requested: input.requested, workspace_currency: input.workspaceCurrency, failed },
  });
  if (failed.length) return { ok: false, error: `Bid cap aplicado em ${done.length} de ${targets.length} conjunto(s). Falhou: ${failed.join(" · ")}` };
  return { ok: true, update };
}
