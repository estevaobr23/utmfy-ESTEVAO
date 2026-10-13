import Link from "next/link";
import { addCaktoItem, checkOfferWebhook, linkPixel, removeCaktoItem, saveMetaBindings, unlinkAdAccount, unlinkPixel } from "@/app/actions";
import { AskClaude } from "@/components/ask-claude";
import { CodeBlock, SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Code, Field, inputCls, Notice, SectionTitle } from "@/components/ui";
import { ask } from "@/lib/claude-chat";
import { timeAgo } from "@/lib/core/dates";
import { env } from "@/lib/env";
import { requireOffer } from "@/lib/offer-context";
import { caktoApi, caktoConfigured, type CaktoProduct } from "@/lib/services/cakto-client";
import { offerWebhookUrl } from "@/lib/services/offer-webhooks";
import { adsetPixelId } from "@/lib/core/offer-pixel-scope";
import { loadPixelDerivation } from "@/lib/services/offer-auto-link";

const EVENTS = ["Compra aprovada", "Pix gerado", "Compra recusada", "Reembolso", "Reembolso solicitado", "Chargeback"];

export default async function OfferIntegrations({ params, searchParams }: PageProps<"/ofertas/[id]/integracoes">) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, workspace, offer, canWrite: w } = await requireOffer(id);

  const [{ data: items }, { data: links }, { data: accounts }, { data: pixelLinks }, { data: pixels }, { data: ads }, bindingResult, adsetResult] = await Promise.all([
    sb.from("offer_cakto_items").select("*").eq("offer_id", id).order("created_at"),
    sb.from("offer_ad_accounts").select("ad_account_id, campaign_filter, meta_ad_accounts(account_id, account_name)").eq("offer_id", id),
    sb.from("meta_ad_accounts").select("id, account_id, account_name, active").eq("workspace_id", workspace.id).order("account_name"),
    sb.from("offer_pixels").select("pixel_id, active, pixels(name, external_pixel_id)").eq("offer_id", id),
    sb.from("pixels").select("id, name, external_pixel_id").eq("workspace_id", workspace.id),
    sb.from("meta_ads").select("account_id, campaign_id, campaign_name").eq("workspace_id", workspace.id).limit(5000),
    sb.from("offer_meta_bindings").select("ad_account_id, level, object_id, status, source").eq("offer_id", id).eq("status", "confirmed"),
    sb.from("meta_adsets").select("account_id, campaign_id, adset_id, name, promoted_object").eq("workspace_id", workspace.id).limit(5000),
  ]);
  const campaigns = [...new Map((ads ?? []).map((ad) => [`${ad.account_id}:${ad.campaign_id}`, ad])).values()].sort((a, b) => (a.campaign_name ?? a.campaign_id).localeCompare(b.campaign_name ?? b.campaign_id, "pt-BR"));
  const bindings = bindingResult.data ?? [];
  const bindingsUnavailable = !!bindingResult.error;
  const adsets = adsetResult.data ?? [];
  const primaryPixelId = ((pixelLinks ?? [])[0]?.pixels as unknown as { external_pixel_id?: string } | null)?.external_pixel_id ?? null;
  const promotedPixel = adsetPixelId;
  // Regra automática: conjuntos que otimizam para o pixel desta oferta pertencem a ela.
  const derivation = await loadPixelDerivation(sb, workspace.id);
  const mineAdsets = new Set((derivation?.bindings ?? []).filter((b) => b.offerId === id).map((b) => `${b.accountId}:${b.objectId}`));
  const autoAdsets = adsets.filter((adset) => mineAdsets.has(`${adset.account_id}:${adset.adset_id}`));
  const autoCampaignIds = new Set(autoAdsets.map((adset) => `${adset.account_id}:${adset.campaign_id}`));
  const autoCampaigns = campaigns.filter((campaign) => autoCampaignIds.has(`${campaign.account_id}:${campaign.campaign_id}`));
  const sharedPixels = (derivation?.ambiguousPixels ?? []).filter((pixel) => primaryPixelId === pixel);

  let products: CaktoProduct[] = [];
  let productsError: string | null = null;
  if (w && caktoConfigured()) {
    try {
      products = (await caktoApi.listProducts()).items.filter((p) => p.status !== "deleted");
    } catch (e) {
      productsError = (e as Error).message;
    }
  }
  const token = offer.webhook_token as string | undefined;
  const webhookId = offer.cakto_webhook_id as string | null;
  const checkedAt = offer.cakto_webhook_checked_at as string | null;

  return (
    <>
      <SectionTitle title="Integrações" subtitle="Vínculos desta oferta. As conexões gerais da Meta e da Cakto ficam em Administração e servem todas as ofertas." />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Produtos Cakto (webhook da oferta)"
          actions={<AskClaude tone={webhookId && (items?.length ?? 0) ? "default" : "problem"} label={webhookId ? "Pedir ao Claude" : "Criar webhook com o Claude"} prompt={ask.webhook({ id, name: offer.name, slug: offer.slug }, !webhookId ? "sem_webhook" : !items?.length ? "sem_produtos" : "ok")} copy={false} />}
        >
          {token ? (
            <>
              <p className="mb-2 text-sm text-slate-500">
                Na Cakto, em <b>Integrações → Webhooks → Adicionar</b>, cole esta URL e <b>marque os produtos desta oferta</b>. Eventos: {EVENTS.join(", ")}.
              </p>
              <CodeBlock code={offerWebhookUrl(env.appUrl, token)} />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {webhookId ? (
                  <Badge tone="ok">webhook encontrado na Cakto (#{webhookId})</Badge>
                ) : (
                  <Badge tone="warn">{checkedAt ? "não encontrado na Cakto" : "ainda não verificado"}</Badge>
                )}
                {checkedAt && <span>verificado {timeAgo(checkedAt)}</span>}
                {w && (
                  <form action={checkOfferWebhook}>
                    <input type="hidden" name="offer_id" value={id} />
                    <SubmitButton variant="secondary" pendingText="Verificando...">Verificar na Cakto</SubmitButton>
                  </form>
                )}
              </div>
            </>
          ) : (
            <Notice tone="warn">URL de webhook por oferta indisponível: a migration do banco ainda não foi aplicada.</Notice>
          )}
          <ul className="my-3 space-y-1 text-sm">
            {(items ?? []).map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                <span>
                  {it.product_name ?? it.label ?? <Code>{it.cakto_product_id}</Code>}
                  {it.cakto_offer_id && <> · oferta <Code>{it.cakto_offer_id}</Code></>}{" "}
                  <Badge tone={it.source === "cakto_webhook" ? "info" : "muted"}>{it.source === "cakto_webhook" ? "via webhook" : "manual"}</Badge>
                </span>
                {w && it.source !== "cakto_webhook" && (
                  <form action={removeCaktoItem}>
                    <input type="hidden" name="id" value={it.id} /><input type="hidden" name="offer_id" value={id} />
                    <button className="text-xs text-rose-700">remover</button>
                  </form>
                )}
              </li>
            ))}
            {!items?.length && <li className="text-slate-400">Nenhum produto ainda — crie o webhook na Cakto e clique em Verificar.</li>}
          </ul>
          {w && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-slate-500">Avançado: vincular produto manualmente</summary>
              <form action={addCaktoItem} className="mt-2 grid gap-2">
                <input type="hidden" name="offer_id" value={id} />
                {products.length > 0 ? (
                  <Field label="Produto (da sua conta Cakto)">
                    <select name="cakto_product_id" className={inputCls}>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="ID do produto Cakto" hint={productsError ? `API Cakto: ${productsError}` : caktoConfigured() ? undefined : "Configure CAKTO_CLIENT_ID/SECRET para listar seus produtos aqui."}>
                    <input name="cakto_product_id" required placeholder="cd287b31-d4b7-..." className={inputCls} />
                  </Field>
                )}
                <Field label="ID da oferta Cakto (opcional)" hint="O código do link pay.cakto.com.br/XXXX"><input name="cakto_offer_id" placeholder="a8BcHrY" className={inputCls} /></Field>
                <div><SubmitButton>Associar</SubmitButton></div>
              </form>
            </details>
          )}
        </Card>

        <Card
          title="Gasto Meta (automático pelo pixel)"
          actions={!primaryPixelId || sharedPixels.length ? <AskClaude tone="problem" label="Resolver com o Claude" prompt={ask.problema("Integrações da oferta", "Gasto Meta sem pixel exclusivo", !primaryPixelId ? "a oferta não tem pixel ligado" : `o pixel ${primaryPixelId} também está em outra oferta`, { id, name: offer.name, slug: offer.slug })} copy={false} /> : undefined}
        >
          {!primaryPixelId ? (
            <Notice tone="warn">Vincule o pixel desta oferta (card abaixo). Com ele, toda campanha que otimiza para esse pixel conta aqui sozinha — sem selecionar campanha.</Notice>
          ) : sharedPixels.length ? (
            <Notice tone="warn">O pixel {primaryPixelId} também está vinculado a outra oferta, então o gasto não pode ser separado. Use um pixel exclusivo para cada oferta.</Notice>
          ) : (
            <>
              <p className="mb-2 text-sm text-[#aeb8c9]">
                Pixel <Code>{primaryPixelId}</Code>: campanhas e conjuntos que usam esse pixel entram nesta oferta automaticamente, inclusive os novos (a cada sincronização da Meta).
              </p>
              <div className="mb-2 flex flex-wrap gap-2 text-xs"><Badge tone="ok">{autoCampaigns.length} campanha(s)</Badge><Badge tone="ok">{autoAdsets.length} conjunto(s)</Badge></div>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-[#e2e7ef]">
                {autoCampaigns.map((campaign) => <li key={`${campaign.account_id}:${campaign.campaign_id}`} className="truncate">{campaign.campaign_name ?? "Sem nome"} <Code>{campaign.campaign_id}</Code></li>)}
                {!autoCampaigns.length && <li className="text-[#8f9bb1]">Nenhum conjunto sincronizado usa esse pixel ainda. Suba um anúncio com ele e sincronize a Meta.</li>}
              </ul>
            </>
          )}
        </Card>

        <details className="lg:col-span-2">
          <summary className="cursor-pointer text-sm text-[#9ca8bb]">Avançado: vínculo manual de campanhas (só para exceções, o pixel já faz isso sozinho)</summary>
        <Card title="Contas, campanhas e conjuntos (Meta)">
          <p className="mb-3 text-sm text-[#aeb8c9]">Use só para campanha sem pixel de conversão. Conjuntos com o pixel de uma oferta sempre pertencem a ela, independente do que for marcado aqui.</p>
          {bindingsUnavailable && <div className="mb-3"><Notice tone="warn">A migration de associações explícitas ainda não foi aplicada. Os vínculos legados continuam preservados.</Notice></div>}
          {accounts?.length ? <div className="space-y-3">
            {accounts.map((account) => {
              const linked = (links ?? []).find((item) => item.ad_account_id === account.id);
              const confirmedCampaigns = new Set(bindings.filter((item) => item.ad_account_id === account.id && item.level === "campaign").map((item) => item.object_id));
              const confirmedAdsets = new Set(bindings.filter((item) => item.ad_account_id === account.id && item.level === "adset").map((item) => item.object_id));
              if (bindingsUnavailable && linked?.campaign_filter) linked.campaign_filter.split(",").forEach((campaignId: string) => confirmedCampaigns.add(campaignId.trim()));
              const accountCampaigns = campaigns.filter((campaign) => campaign.account_id === account.account_id);
              const accountAdsets = adsets.filter((adset) => adset.account_id === account.account_id);
              const suggestedAdsets = new Set(accountAdsets.filter((adset) => primaryPixelId && promotedPixel(adset.promoted_object) === primaryPixelId).map((adset) => adset.adset_id));
              const suggestedCampaigns = new Set(accountAdsets.filter((adset) => suggestedAdsets.has(adset.adset_id)).map((adset) => adset.campaign_id));
              return <details key={account.id} open={!!linked} className="rounded-md border border-[#3d4a65] bg-[#202b43]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span><b>{account.account_name ?? account.account_id}</b> <Code>act_{account.account_id}</Code></span>
                  <span className="flex items-center gap-2">{linked ? <Badge tone={confirmedCampaigns.size || confirmedAdsets.size ? "ok" : "warn"}>{confirmedCampaigns.size + confirmedAdsets.size || "pendente"}</Badge> : <Badge>não vinculada</Badge>}</span>
                </summary>
                <form action={saveMetaBindings} className="border-t border-[#3d4a65] p-3">
                  <input type="hidden" name="offer_id" value={id} /><input type="hidden" name="ad_account_id" value={account.id} />
                  <div className="grid gap-4 md:grid-cols-2">
                    <fieldset><legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#9ca8bb]">Campanhas</legend><div className="max-h-56 space-y-1 overflow-y-auto">
                      {accountCampaigns.map((campaign) => <label key={campaign.campaign_id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-[#2b3853]"><input type="checkbox" name="campaign_ids" value={campaign.campaign_id} defaultChecked={confirmedCampaigns.has(campaign.campaign_id)} className="mt-0.5" /><span className="min-w-0"><span className="block truncate text-[#e2e7ef]">{campaign.campaign_name ?? "Sem nome"}</span><Code>{campaign.campaign_id}</Code>{suggestedCampaigns.has(campaign.campaign_id) && <span className="ml-2 text-emerald-300">sugerida pelo pixel</span>}</span></label>)}
                      {!accountCampaigns.length && <p className="text-xs text-[#8f9bb1]">Nenhuma campanha sincronizada.</p>}
                    </div></fieldset>
                    <fieldset><legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#9ca8bb]">Conjuntos (mais específico)</legend><div className="max-h-56 space-y-1 overflow-y-auto">
                      {accountAdsets.map((adset) => <label key={adset.adset_id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-[#2b3853]"><input type="checkbox" name="adset_ids" value={adset.adset_id} defaultChecked={confirmedAdsets.has(adset.adset_id)} className="mt-0.5" /><span className="min-w-0"><span className="block truncate text-[#e2e7ef]">{adset.name ?? "Sem nome"}</span><Code>{adset.adset_id}</Code>{suggestedAdsets.has(adset.adset_id) && <span className="ml-2 text-emerald-300">pixel {primaryPixelId}</span>}</span></label>)}
                      {!accountAdsets.length && <p className="text-xs text-[#8f9bb1]">Nenhum conjunto sincronizado.</p>}
                    </div></fieldset>
                  </div>
                  <details className="mt-3 rounded border border-[#3d4a65] p-2 text-xs text-[#aeb8c9]"><summary className="cursor-pointer">Associação manual por ID</summary><div className="mt-2 grid gap-2 md:grid-cols-2"><label>IDs de campanhas<input name="campaign_ids" inputMode="numeric" placeholder="IDs separados por vírgula" className={`${inputCls} mt-1 w-full`} /></label><label>IDs de conjuntos<input name="adset_ids" inputMode="numeric" placeholder="IDs separados por vírgula" className={`${inputCls} mt-1 w-full`} /></label></div></details>
                  {w && <div className="mt-3 flex items-center justify-between gap-2"><SubmitButton pendingText="Salvando vínculos…">Salvar vínculos</SubmitButton>{linked && <button formAction={unlinkAdAccount} className="text-xs text-rose-300">Desassociar conta</button>}</div>}
                </form>
              </details>;
            })}
          </div> : <Notice tone="warn">Nenhuma conta importada. Em <Link className="underline" href="/meta">Conexão Meta</Link>, clique em Descobrir contas.</Notice>}
        </Card>
        </details>

        <Card
          title="Pixel principal"
          actions={<AskClaude tone={pixelLinks?.length ? "default" : "problem"} label={pixelLinks?.length ? "Pedir ao Claude" : "Criar pixel com o Claude"} prompt={ask.pixelOferta({ id, name: offer.name, slug: offer.slug }, !!pixelLinks?.length)} copy={false} />}
        >
          <ul className="mb-3 space-y-1 text-sm">
            {(pixelLinks ?? []).map((l) => {
              const p = l.pixels as unknown as { name: string; external_pixel_id: string } | null;
              return (
                <li key={l.pixel_id} className="flex items-center justify-between rounded border border-slate-100 px-2 py-1">
                  <span>{p?.name} <Code>{p?.external_pixel_id}</Code></span>
                  {w && (
                    <form action={unlinkPixel}>
                      <input type="hidden" name="offer_id" value={id} /><input type="hidden" name="pixel_id" value={l.pixel_id} /><input type="hidden" name="back" value="offer" />
                      <button className="text-xs text-rose-700">remover</button>
                    </form>
                  )}
                </li>
              );
            })}
            {!pixelLinks?.length && <li className="text-slate-400">Nenhum pixel vinculado.</li>}
          </ul>
          {w && (pixels?.length ? (
            <form action={linkPixel} className="flex items-end gap-2">
              <input type="hidden" name="offer_id" value={id} /><input type="hidden" name="back" value="offer" />
              <select name="pixel_id" className={inputCls}>{pixels.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.external_pixel_id})</option>)}</select>
              <SubmitButton>Vincular pixel</SubmitButton>
            </form>
          ) : <Notice>Cadastre pixels em <Link href="/pixels" className="underline">Administração → Pixels</Link>.</Notice>)}
        </Card>
      </div>
    </>
  );
}
