"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, isIsoDate, todayIn } from "@/lib/core/dates";
import { hint } from "@/lib/core/hash";
import { adminClient } from "@/lib/supabase/admin";
import { serverClient } from "@/lib/supabase/server";
import { requireWorkspace, requireSession, WS_COOKIE } from "@/lib/session";
import { syncCaktoOrders } from "@/lib/services/cakto-sync";
import { discoverAccounts, syncMeta } from "@/lib/services/meta-sync";
import { syncOfferWebhooks } from "@/lib/services/offer-webhooks";
import { autoLinkOfferAccounts } from "@/lib/services/offer-auto-link";
import { updateMetaDailyBudget } from "@/lib/services/meta-budget";
import { processDispatches, retryDispatch } from "@/lib/services/capi-dispatch";
import { seedDemo } from "@/lib/services/demo";
import { logEvent } from "@/lib/services/logs";

// Toda action: exige sessão; escritas de config usam o cliente do usuário
// (RLS decide); jobs de integração exigem owner/admin e usam service_role.

async function writer() {
  const s = await requireWorkspace();
  if (!s.canWrite) throw new Error("Sem permissão de escrita neste workspace");
  return s;
}

const back = (path: string, msg?: string, tone: "ok" | "error" = "ok") => {
  revalidatePath(path);
  redirect(msg ? `${path}${path.includes("?") ? "&" : "?"}${tone}=${encodeURIComponent(msg)}` : path);
};

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "oferta";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const uuid = z.string().uuid();

// ---------------------------------------------------------------- auth ------
export async function signOut() {
  const sb = await serverClient();
  await sb.auth.signOut();
  redirect("/login");
}

export async function switchWorkspace(fd: FormData) {
  const s = await requireSession();
  const id = str(fd, "workspace_id");
  if (s.workspaces.some((w) => w.id === id)) {
    (await cookies()).set(WS_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  }
  redirect("/");
}

// -------------------------------------------------------------- ofertas -----
export async function createOffer(fd: FormData) {
  const s = await writer();
  const name = str(fd, "name");
  if (!name || name.length > 120) back("/ofertas", "Nome inválido", "error");
  const { data, error } = await s.sb
    .from("offers")
    .insert({ workspace_id: s.workspace.id, name, slug: slugify(str(fd, "slug") || name), currency: s.workspace.currency, timezone: s.workspace.timezone })
    .select("id")
    .single();
  if (error) back("/ofertas", error.message.includes("duplicate") ? "Já existe oferta com esse slug" : error.message, "error");
  back(`/ofertas/${data!.id}/integracoes`, "Oferta criada");
}

export async function updateOffer(fd: FormData) {
  const s = await writer();
  const id = uuid.parse(str(fd, "offer_id"));
  const url = (v: string) => (v && /^https:\/\/[^\s]+$/.test(v) ? v : null);
  const status = ["active", "paused", "archived"].includes(str(fd, "status")) ? str(fd, "status") : "active";
  const { error } = await s.sb
    .from("offers")
    .update({ name: str(fd, "name").slice(0, 120), status, checkout_url: url(str(fd, "checkout_url")), landing_url: url(str(fd, "landing_url")), notes: str(fd, "notes").slice(0, 2000) || null })
    .eq("id", id)
    .eq("workspace_id", s.workspace.id);
  back(`/ofertas/${id}/configuracoes`, error ? error.message : "Oferta salva", error ? "error" : "ok");
}

export async function archiveOffer(fd: FormData) {
  const s = await writer();
  const id = uuid.parse(str(fd, "offer_id"));
  const confirmation = str(fd, "confirmation");
  const { data: offer } = await s.sb.from("offers").select("name").eq("id", id).eq("workspace_id", s.workspace.id).maybeSingle();
  if (!offer || confirmation !== offer.name) return back(`/ofertas/${id}/configuracoes`, "O nome digitado não confere.", "error");
  const { error } = await s.sb.from("offers").update({ status: "archived" }).eq("id", id).eq("workspace_id", s.workspace.id);
  if (error) return back(`/ofertas/${id}/configuracoes`, error.message, "error");
  revalidatePath("/", "layout");
  redirect("/ofertas?ok=Oferta%20arquivada%20sem%20apagar%20o%20histórico");
}

export async function deleteOffer(fd: FormData) {
  const s = await writer();
  const id = uuid.parse(str(fd, "offer_id"));
  const confirmation = str(fd, "confirmation");
  const { error } = await s.sb.rpc("delete_empty_offer", { p_offer: id, p_confirmation: confirmation });
  if (error) {
    const message = error.message.includes("offer_has_history")
      ? "A oferta ganhou histórico e não pode mais ser excluída. Arquive-a para preservar os dados."
      : error.message.includes("confirmation") ? "O nome digitado não confere." : `Não foi possível excluir: ${error.message}`;
    return back(`/ofertas/${id}/configuracoes`, message, "error");
  }
  revalidatePath("/", "layout");
  redirect("/ofertas?ok=Oferta%20vazia%20excluída%20com%20segurança");
}

export async function addCaktoItem(fd: FormData) {
  const s = await writer();
  const offerId = uuid.parse(str(fd, "offer_id"));
  const product = str(fd, "cakto_product_id");
  const offer = str(fd, "cakto_offer_id");
  const valid = /^[A-Za-z0-9_-]{1,255}$/;
  if (!valid.test(product) || (offer && !valid.test(offer))) back(`/ofertas/${offerId}/integracoes`, "IDs Cakto inválidos", "error");
  const { error } = await s.sb.from("offer_cakto_items").insert({
    workspace_id: s.workspace.id, offer_id: offerId, cakto_product_id: product, cakto_offer_id: offer || null, label: str(fd, "label").slice(0, 120) || null,
  });
  back(`/ofertas/${offerId}/integracoes`, error ? (error.message.includes("duplicate") ? "Esse produto/oferta Cakto já está mapeado para uma oferta" : error.message) : "Produto Cakto associado", error ? "error" : "ok");
}

/** Lê na Cakto o webhook desta oferta: produtos marcados lá passam a ser desta oferta. */
export async function checkOfferWebhook(fd: FormData) {
  const s = await writer();
  const offerId = uuid.parse(str(fd, "offer_id"));
  const path = `/ofertas/${offerId}/integracoes`;
  let r: Awaited<ReturnType<typeof syncOfferWebhooks>>;
  try {
    r = await syncOfferWebhooks(adminClient(), s.workspace.id);
  } catch (e) {
    return back(path, `Falha ao ler webhooks da Cakto: ${(e as Error).message}`, "error");
  }
  const { data: offer } = await s.sb.from("offers").select("cakto_webhook_id").eq("id", offerId).single();
  if (!offer?.cakto_webhook_id) return back(path, "Nenhum webhook com a URL desta oferta foi encontrado na Cakto.", "error");
  back(path, r.conflicts.length ? `Webhook encontrado. Atenção: ${r.conflicts.join("; ")}` : "Webhook encontrado: produtos atualizados.", r.conflicts.length ? "error" : "ok");
}

export async function removeCaktoItem(fd: FormData) {
  const s = await writer();
  const offerId = uuid.parse(str(fd, "offer_id"));
  await s.sb.from("offer_cakto_items").delete().eq("id", uuid.parse(str(fd, "id"))).eq("workspace_id", s.workspace.id);
  back(`/ofertas/${offerId}/integracoes`, "Removido");
}

export async function linkAdAccount(fd: FormData) {
  const s = await writer();
  const offerId = uuid.parse(str(fd, "offer_id"));
  const rawCampaignIds = str(fd, "campaign_filter").trim();
  const campaignIds = rawCampaignIds ? rawCampaignIds.split(/[\s,;]+/).filter(Boolean) : [];
  if (campaignIds.some((id) => !/^\d{1,30}$/.test(id))) {
    return back(`/ofertas/${offerId}/integracoes`, "Use somente IDs numéricos de campanhas, separados por vírgula.", "error");
  }
  const filter = campaignIds.length ? [...new Set(campaignIds)].join(",") : null;
  const { error } = await s.sb.from("offer_ad_accounts").upsert({
    workspace_id: s.workspace.id, offer_id: offerId, ad_account_id: uuid.parse(str(fd, "ad_account_id")), campaign_filter: filter,
  });
  back(`/ofertas/${offerId}/integracoes`, error ? error.message : filter ? "Conta e campanhas associadas" : "Conta salva como associação pendente; nenhum gasto será atribuído até informar campanhas.", error ? "error" : "ok");
}

export async function saveMetaBindings(fd: FormData) {
  const s = await writer();
  const offerId = uuid.parse(str(fd, "offer_id"));
  const accountId = uuid.parse(str(fd, "ad_account_id"));
  const ids = (name: string) => fd.getAll(name).flatMap((value) => String(value).split(/[\s,;]+/)).map((value) => value.trim()).filter(Boolean);
  const campaignIds = [...new Set(ids("campaign_ids"))];
  const adsetIds = [...new Set(ids("adset_ids"))];
  if ([...campaignIds, ...adsetIds].some((id) => !/^\d{1,30}$/.test(id))) {
    return back(`/ofertas/${offerId}/integracoes`, "Há um ID Meta inválido na seleção.", "error");
  }
  const { error } = await s.sb.rpc("replace_offer_meta_bindings", {
    p_offer: offerId,
    p_ad_account: accountId,
    p_campaign_ids: campaignIds,
    p_adset_ids: adsetIds,
  });
  if (error) {
    const message = error.message.includes("meta_binding_conflict")
      ? "Uma campanha ou conjunto selecionado já pertence a outra oferta. Remova o vínculo conflitante antes de continuar."
      : error.message.includes("replace_offer_meta_bindings") ? "A migration de associações Meta ainda não foi aplicada." : error.message;
    return back(`/ofertas/${offerId}/integracoes`, message, "error");
  }
  back(`/ofertas/${offerId}/integracoes`, campaignIds.length || adsetIds.length ? "Associações Meta confirmadas" : "Conta salva como pendente; nenhum gasto será atribuído");
}

export async function unlinkAdAccount(fd: FormData) {
  const s = await writer();
  const offerId = uuid.parse(str(fd, "offer_id"));
  await s.sb.from("offer_ad_accounts").delete().eq("offer_id", offerId).eq("ad_account_id", uuid.parse(str(fd, "ad_account_id")));
  back(`/ofertas/${offerId}/integracoes`, "Conta desassociada");
}

// --------------------------------------------------------------- pixels -----
export async function createPixel(fd: FormData) {
  const s = await writer();
  const pid = str(fd, "external_pixel_id");
  if (!/^[0-9]{5,30}$/.test(pid)) back("/pixels", "ID do pixel deve ser numérico", "error");
  const { error } = await s.sb.from("pixels").insert({ workspace_id: s.workspace.id, external_pixel_id: pid, name: str(fd, "name").slice(0, 120) || `Pixel ${pid}` });
  back("/pixels", error ? (error.message.includes("duplicate") ? "Pixel já cadastrado" : error.message) : "Pixel cadastrado", error ? "error" : "ok");
}

export async function updatePixel(fd: FormData) {
  const s = await writer();
  const id = uuid.parse(str(fd, "pixel_id"));
  const patch: Record<string, unknown> = {};
  if (fd.has("active")) patch.active = str(fd, "active") === "true";
  if (fd.has("server_tracking_enabled")) patch.server_tracking_enabled = str(fd, "server_tracking_enabled") === "true";
  if (fd.has("test_event_code")) patch.test_event_code = str(fd, "test_event_code").slice(0, 40) || null;
  await s.sb.from("pixels").update(patch).eq("id", id).eq("workspace_id", s.workspace.id);
  back("/pixels", "Pixel atualizado");
}

/** Token CAPI do pixel → Supabase Vault (nunca em tabela). */
export async function setPixelToken(fd: FormData) {
  const s = await writer();
  const id = uuid.parse(str(fd, "pixel_id"));
  const mode = str(fd, "mode");
  const admin = adminClient();
  const { data: px } = await admin.from("pixels").select("id, workspace_id").eq("id", id).single();
  if (!px || px.workspace_id !== s.workspace.id) back("/pixels", "Pixel não encontrado", "error");
  if (mode === "env") {
    await admin.from("pixels").update({ token_source: "env", token_hint: "META_CAPI_TOKEN" }).eq("id", id);
    back("/pixels", "Pixel usará META_CAPI_TOKEN");
  }
  const token = str(fd, "token");
  if (token.length < 20) back("/pixels", "Token inválido", "error");
  const { error } = await admin.rpc("store_secret", { p_workspace: s.workspace.id, p_owner_type: "pixel", p_owner_id: id, p_secret: token });
  if (error) back("/pixels", `Vault indisponível: ${error.message}. Use a opção META_CAPI_TOKEN.`, "error");
  await admin.from("pixels").update({ token_source: "vault", token_hint: hint(token) }).eq("id", id);
  back("/pixels", "Token salvo no Vault");
}

export async function linkPixel(fd: FormData) {
  const s = await writer();
  const dest = str(fd, "back") === "offer" ? `/ofertas/${str(fd, "offer_id")}/integracoes` : "/pixels";
  // Pixel compartilhado por duas ofertas não separa o gasto: um pixel, uma oferta.
  const { data: other } = await s.sb.from("offer_pixels").select("offer_id").eq("pixel_id", uuid.parse(str(fd, "pixel_id"))).eq("active", true).neq("offer_id", uuid.parse(str(fd, "offer_id"))).limit(1);
  if (other?.length) return back(dest, "Esse pixel já pertence a outra oferta. Use um pixel exclusivo para cada oferta.", "error");
  const { error } = await s.sb.from("offer_pixels").upsert({ workspace_id: s.workspace.id, offer_id: uuid.parse(str(fd, "offer_id")), pixel_id: uuid.parse(str(fd, "pixel_id")), active: true });
  // Um pixel por oferta: com o pixel ligado, as contas e campanhas dele entram sozinhas.
  if (!error) await autoLinkOfferAccounts(s.sb, s.workspace.id).catch(() => 0);
  back(str(fd, "back") === "offer" ? `/ofertas/${str(fd, "offer_id")}/integracoes` : "/pixels", error ? error.message : "Pixel associado", error ? "error" : "ok");
}

export async function unlinkPixel(fd: FormData) {
  const s = await writer();
  await s.sb.from("offer_pixels").delete().eq("offer_id", uuid.parse(str(fd, "offer_id"))).eq("pixel_id", uuid.parse(str(fd, "pixel_id")));
  back(str(fd, "back") === "offer" ? `/ofertas/${str(fd, "offer_id")}/integracoes` : "/pixels", "Pixel desassociado");
}

// ---------------------------------------------------------------- meta ------
export async function toggleAccount(fd: FormData) {
  const s = await writer();
  await s.sb.from("meta_ad_accounts").update({ active: str(fd, "active") === "true" }).eq("id", uuid.parse(str(fd, "id"))).eq("workspace_id", s.workspace.id);
  back("/meta", "Conta atualizada");
}

/** Câmbio manual da conta (ex.: USD→BRL). Vazio = não converter (gasto fica fora). */
export async function setFxRate(fd: FormData) {
  const s = await writer();
  const raw = str(fd, "fx_rate").replace(",", ".");
  const rate = raw === "" ? null : Number(raw);
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0 || rate > 100000)) back("/meta", "Câmbio inválido", "error");
  await s.sb
    .from("meta_ad_accounts")
    .update({ fx_rate: rate, fx_note: rate ? `manual ${new Date().toISOString().slice(0, 10)}` : null })
    .eq("id", uuid.parse(str(fd, "id")))
    .eq("workspace_id", s.workspace.id);
  back("/meta", rate ? `Câmbio salvo: 1 = ${rate} ${s.workspace.currency}` : "Câmbio removido");
}

export async function discoverMetaAccounts() {
  const s = await writer();
  const r = await discoverAccounts(adminClient(), s.workspace.id, "manual");
  back("/meta", r.error ? `Falha: ${r.error}` : `${r.stats.accounts} conta(s) encontrada(s)`, r.error ? "error" : "ok");
}

/** Lápis do orçamento na tabela Meta Ads: valor em reais → Meta (moeda da conta, mesma PTAX do relatório). */
export async function updateMetaBudget(fd: FormData) {
  const s = await writer();
  const raw = str(fd, "back");
  const path = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/meta-ads";
  const level = str(fd, "level");
  if (level !== "campaign" && level !== "adset") return back(path, "Nível inválido.", "error");
  const requested = Number(str(fd, "amount").replace(/\./g, "").replace(",", "."));
  const r = await updateMetaDailyBudget(adminClient(), s.workspace.id, { level, objectId: str(fd, "object_id"), requested, workspaceCurrency: s.workspace.currency });
  if (!r.ok) return back(path, r.error, "error");
  const unit = (minor: number) => (minor / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  back(path, `Orçamento de “${r.update.name}” atualizado na Meta: ${r.update.currency} ${unit(r.update.beforeMinor)} → ${unit(r.update.afterMinor)}/dia`);
}

export async function syncMetaNow(fd: FormData) {
  const s = await writer();
  const since = str(fd, "since");
  const until = str(fd, "until");
  const r = await syncMeta(adminClient(), s.workspace.id, {
    trigger: "manual",
    since: isIsoDate(since) ? since : undefined,
    until: isIsoDate(until) ? until : undefined,
  });
  const raw = str(fd, "back");
  const path = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/meta";
  back(path, r.error ? `Falha: ${r.error}` : `Meta sincronizada: ${r.stats.insights} linhas, ${r.stats.ads} anúncios`, r.error ? "error" : "ok");
}

/**
 * "Atualizar" dos painéis: gasto da Meta E vendas da Cakto, na mesma ordem do cron
 * (Meta primeiro, para o catálogo de anúncios já existir quando a venda for atribuída).
 */
export async function refreshNow(fd: FormData) {
  const s = await writer();
  const admin = adminClient();
  const today = todayIn(s.workspace.timezone);
  const meta = await syncMeta(admin, s.workspace.id, { trigger: "manual" });
  const cakto = await syncCaktoOrders(admin, s.workspace.id, { from: `${addDays(today, -3)}T00:00:00Z`, to: `${addDays(today, 1)}T23:59:59Z`, mode: "reconcile", trigger: "manual" });
  const raw = str(fd, "back");
  const path = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/meta";
  const failed = [meta.error ? `Meta: ${meta.error}` : "", cakto.error ? `Cakto: ${cakto.error}` : ""].filter(Boolean);
  back(
    path,
    failed.length ? `Falha parcial — ${failed.join(" · ")}` : `Atualizado: Meta ${meta.stats.insights} linhas · Cakto ${cakto.stats.fetched} pedidos lidos, ${cakto.stats.inserted} novos, ${cakto.stats.statusChanged} corrigidos`,
    failed.length ? "error" : "ok",
  );
}

// ---------------------------------------------------------------- cakto -----
export async function syncCaktoNow(fd: FormData) {
  const s = await writer();
  const tz = s.workspace.timezone;
  const from = isIsoDate(str(fd, "from")) ? str(fd, "from") : addDays(todayIn(tz), -2);
  const to = isIsoDate(str(fd, "to")) ? str(fd, "to") : todayIn(tz);
  const mode = str(fd, "mode") === "reconcile" ? "reconcile" : "sync";
  // Janela alargada ±1 dia (UTC) para cobrir qualquer fuso; reprocessar é idempotente.
  const r = await syncCaktoOrders(adminClient(), s.workspace.id, { from: `${addDays(from, -1)}T00:00:00Z`, to: `${addDays(to, 1)}T23:59:59Z`, mode, trigger: "manual" });
  back("/cakto", r.error ? `Falha: ${r.error}` : `${r.stats.fetched} pedidos lidos, ${r.stats.inserted} novos, ${r.stats.statusChanged} corrigidos`, r.error ? "error" : "ok");
}

// --------------------------------------------------------------- eventos ----
export async function retryDispatchAction(fd: FormData) {
  const s = await writer();
  const admin = adminClient();
  const id = uuid.parse(str(fd, "id"));
  const { data } = await admin.from("conversion_dispatches").select("workspace_id").eq("id", id).single();
  if (data?.workspace_id !== s.workspace.id) back("/eventos", "Não encontrado", "error");
  await retryDispatch(admin, id);
  back("/eventos", "Reenfileirado (somente este pixel)");
}

export async function runDispatchNow() {
  const s = await writer();
  const r = await processDispatches(adminClient(), { trigger: "manual", workspaceId: s.workspace.id });
  back("/eventos", "disabled" in r ? "CAPI desligado (CAPI_ENABLED=false): nada enviado" : `Enviados ${r.sent}, falhas ${r.failed}`);
}

// ----------------------------------------------------------- configurações --
export async function updateWorkspace(fd: FormData) {
  const s = await writer();
  const tz = str(fd, "timezone");
  let validTz = true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    validTz = false;
  }
  const currency = str(fd, "currency").toUpperCase();
  if (!validTz || !/^[A-Z]{3}$/.test(currency)) back("/configuracoes", "Fuso ou moeda inválidos", "error");
  await s.sb.from("workspaces").update({ name: str(fd, "name").slice(0, 120) || s.workspace.name, timezone: tz, currency }).eq("id", s.workspace.id);
  back("/configuracoes", "Configurações salvas");
}

export async function createDemo() {
  const s = await requireSession();
  const r = await seedDemo(adminClient(), s.user.id);
  (await cookies()).set(WS_COOKIE, r.workspaceId, { httpOnly: true, sameSite: "lax", path: "/" });
  await logEvent(adminClient(), { workspaceId: r.workspaceId, level: "info", code: "DEMO_SEEDED", message: `${r.orders} pedidos demo` });
  back("/", "Dados DEMO criados (workspace separado)");
}

export async function deleteDemo() {
  const s = await requireSession();
  const admin = adminClient();
  const demo = s.workspaces.find((w) => w.is_demo);
  if (demo) await admin.from("workspaces").delete().eq("id", demo.id).eq("is_demo", true);
  (await cookies()).delete(WS_COOKIE);
  back("/configuracoes", "Workspace DEMO removido");
}
