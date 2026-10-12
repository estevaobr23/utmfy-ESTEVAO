import Link from "next/link";
import { addCaktoItem, checkOfferWebhook, linkAdAccount, linkPixel, removeCaktoItem, unlinkAdAccount, unlinkPixel } from "@/app/actions";
import { CodeBlock, SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Code, Field, inputCls, Notice, SectionTitle } from "@/components/ui";
import { timeAgo } from "@/lib/core/dates";
import { env } from "@/lib/env";
import { requireOffer } from "@/lib/offer-context";
import { caktoApi, caktoConfigured, type CaktoProduct } from "@/lib/services/cakto-client";
import { offerWebhookUrl } from "@/lib/services/offer-webhooks";

const EVENTS = ["Compra aprovada", "Pix gerado", "Compra recusada", "Reembolso", "Reembolso solicitado", "Chargeback"];

export default async function OfferIntegrations({ params, searchParams }: PageProps<"/ofertas/[id]/integracoes">) {
  const { id } = await params;
  const sp = await searchParams;
  const { sb, workspace, offer, canWrite: w } = await requireOffer(id);

  const [{ data: items }, { data: links }, { data: accounts }, { data: pixelLinks }, { data: pixels }, { data: ads }] = await Promise.all([
    sb.from("offer_cakto_items").select("*").eq("offer_id", id).order("created_at"),
    sb.from("offer_ad_accounts").select("ad_account_id, campaign_filter, meta_ad_accounts(account_id, account_name)").eq("offer_id", id),
    sb.from("meta_ad_accounts").select("id, account_id, account_name, active").eq("workspace_id", workspace.id).order("account_name"),
    sb.from("offer_pixels").select("pixel_id, active, pixels(name, external_pixel_id)").eq("offer_id", id),
    sb.from("pixels").select("id, name, external_pixel_id").eq("workspace_id", workspace.id),
    sb.from("meta_ads").select("account_id, campaign_id, campaign_name").eq("workspace_id", workspace.id).limit(5000),
  ]);
  const campaigns = [...new Map((ads ?? []).map((ad) => [ad.campaign_id, ad])).values()].sort((a, b) => (a.campaign_name ?? a.campaign_id).localeCompare(b.campaign_name ?? b.campaign_id, "pt-BR"));

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
        <Card title="Produtos Cakto (webhook da oferta)">
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

        <Card title="Contas de anúncio (Meta)">
          <ul className="mb-3 space-y-1 text-sm">
            {(links ?? []).map((l) => {
              const a = l.meta_ad_accounts as unknown as { account_id: string; account_name: string | null } | null;
              return (
                <li key={l.ad_account_id} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                  <span>{a?.account_name ?? "?"} <Code>act_{a?.account_id}</Code>{l.campaign_filter ? <> · campanhas <Code>{l.campaign_filter}</Code></> : <> · <Badge tone="warn">associação pendente · gasto excluído</Badge></>}</span>
                  {w && (
                    <form action={unlinkAdAccount}>
                      <input type="hidden" name="offer_id" value={id} /><input type="hidden" name="ad_account_id" value={l.ad_account_id} />
                      <button className="text-xs text-rose-700">remover</button>
                    </form>
                  )}
                </li>
              );
            })}
            {!links?.length && <li className="text-slate-400">Nenhuma conta vinculada — o gasto desta oferta fica desconhecido.</li>}
          </ul>
          {w && (accounts?.length ? (
            <form action={linkAdAccount} className="grid gap-2">
              <input type="hidden" name="offer_id" value={id} />
              <Field label="Conta">
                <select name="ad_account_id" className={inputCls}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name ?? a.account_id} (act_{a.account_id}){a.active ? "" : " — não monitorada"}</option>)}
                </select>
              </Field>
              <Field label="IDs das campanhas" hint="Separe IDs por vírgula. Se ficar vazio, a conta será salva como pendente e nenhum gasto entrará na oferta.">
                <input name="campaign_filter" inputMode="numeric" placeholder="120249039838020650, 120249040128310650" className={inputCls} />
              </Field>
              <details className="rounded border border-[#394761] bg-[#202b43] p-2 text-xs">
                <summary className="cursor-pointer text-[#aab4c6]">Ver campanhas descobertas e seus IDs</summary>
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {campaigns.map((campaign) => <div key={campaign.campaign_id} className="flex items-center justify-between gap-3 border-b border-[#34415d] py-1"><span className="truncate">{campaign.campaign_name ?? "Sem nome"}</span><Code>{campaign.campaign_id}</Code></div>)}
                  {!campaigns.length && <p className="text-[#8f9bb1]">Nenhuma campanha sincronizada.</p>}
                </div>
              </details>
              <div><SubmitButton>Vincular conta</SubmitButton></div>
            </form>
          ) : <Notice tone="warn">Nenhuma conta importada. Em <Link className="underline" href="/meta">Conexão Meta</Link>, clique em Descobrir contas.</Notice>)}
        </Card>

        <Card title="Pixel principal">
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
