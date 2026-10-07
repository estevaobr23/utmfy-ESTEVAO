import { notFound } from "next/navigation";
import { addCaktoItem, linkAdAccount, linkPixel, removeCaktoItem, unlinkAdAccount, unlinkPixel, updateOffer } from "@/app/actions";
import { CodeBlock, SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Code, Field, inputCls, LinkButton, Notice, PageHeader } from "@/components/ui";
import { env } from "@/lib/env";
import { caktoApi, caktoConfigured, type CaktoProduct } from "@/lib/services/cakto-client";
import { requireWorkspace } from "@/lib/session";

export default async function ConfigureOffer({ params, searchParams }: PageProps<"/ofertas/[id]/configurar">) {
  const s = await requireWorkspace();
  const { id } = await params;
  const sp = await searchParams;
  const { data: offer } = await s.sb.from("offers").select("*").eq("id", id).eq("workspace_id", s.workspace.id).maybeSingle();
  if (!offer) notFound();

  const [{ data: items }, { data: links }, { data: accounts }, { data: pixelLinks }, { data: pixels }] = await Promise.all([
    s.sb.from("offer_cakto_items").select("*").eq("offer_id", id).order("created_at"),
    s.sb.from("offer_ad_accounts").select("ad_account_id, campaign_filter, meta_ad_accounts(account_id, account_name)").eq("offer_id", id),
    s.sb.from("meta_ad_accounts").select("id, account_id, account_name, active").eq("workspace_id", s.workspace.id).order("account_name"),
    s.sb.from("offer_pixels").select("pixel_id, active, pixels(name, external_pixel_id)").eq("offer_id", id),
    s.sb.from("pixels").select("id, name, external_pixel_id").eq("workspace_id", s.workspace.id),
  ]);

  let products: CaktoProduct[] = [];
  let productsError: string | null = null;
  if (caktoConfigured()) {
    try {
      products = (await caktoApi.listProducts()).items;
    } catch (e) {
      productsError = (e as Error).message;
    }
  }

  const snippet = `<script src="${env.appUrl}/t.js" data-offer="${offer.id}" async></script>`;
  const w = s.canWrite;

  return (
    <>
      <PageHeader title={`Configurar · ${offer.name}`} actions={<LinkButton href={`/ofertas/${id}`}>Ver dashboard</LinkButton>} />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Dados da oferta">
          <form action={updateOffer} className="grid gap-3">
            <input type="hidden" name="offer_id" value={offer.id} />
            <Field label="Nome"><input name="name" defaultValue={offer.name} className={inputCls} /></Field>
            <Field label="Status">
              <select name="status" defaultValue={offer.status} className={inputCls}>
                <option value="active">ativa</option><option value="paused">pausada</option><option value="archived">arquivada</option>
              </select>
            </Field>
            <Field label="URL do checkout (Cakto)" hint="Usada no Diagnóstico de Tracking."><input name="checkout_url" defaultValue={offer.checkout_url ?? ""} placeholder="https://pay.cakto.com.br/xxxx" className={inputCls} /></Field>
            <Field label="URL da página de vendas"><input name="landing_url" defaultValue={offer.landing_url ?? ""} placeholder="https://..." className={inputCls} /></Field>
            <Field label="Notas"><textarea name="notes" defaultValue={offer.notes ?? ""} rows={2} className={inputCls} /></Field>
            {w && <div><SubmitButton>Salvar</SubmitButton></div>}
          </form>
        </Card>

        <Card title="Passo 2 — Produtos/ofertas Cakto">
          <p className="mb-3 text-sm text-slate-500">
            Vendas destes produtos (ou ofertas específicas) entram nesta oferta. Com só o produto, todas as ofertas dele (inclusive bump/upsell do mesmo produto) são incluídas.
          </p>
          <ul className="mb-3 space-y-1 text-sm">
            {(items ?? []).map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                <span>
                  {it.label && <b>{it.label} · </b>}produto <Code>{it.cakto_product_id}</Code>
                  {it.cakto_offer_id ? <> · oferta <Code>{it.cakto_offer_id}</Code></> : <Badge>todas as ofertas</Badge>}
                </span>
                {w && (
                  <form action={removeCaktoItem}>
                    <input type="hidden" name="id" value={it.id} /><input type="hidden" name="offer_id" value={id} />
                    <button className="text-xs text-rose-700">remover</button>
                  </form>
                )}
              </li>
            ))}
            {!items?.length && <li className="text-slate-400">Nenhum produto associado — vendas não serão ligadas a esta oferta.</li>}
          </ul>
          {w && (
            <form action={addCaktoItem} className="grid gap-2">
              <input type="hidden" name="offer_id" value={id} />
              {products.length > 0 ? (
                <Field label="Produto (da sua conta Cakto)">
                  <select name="cakto_product_id" className={inputCls}>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.id.slice(0, 8)}…)</option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="ID do produto Cakto" hint={productsError ? `API Cakto: ${productsError}` : caktoConfigured() ? undefined : "Configure CAKTO_CLIENT_ID/SECRET para listar seus produtos aqui."}>
                  <input name="cakto_product_id" required placeholder="cd287b31-d4b7-..." className={inputCls} />
                </Field>
              )}
              <Field label="ID da oferta Cakto (opcional)" hint="O código do link pay.cakto.com.br/XXXX"><input name="cakto_offer_id" placeholder="a8BcHrY" className={inputCls} /></Field>
              <Field label="Rótulo (opcional)"><input name="label" className={inputCls} /></Field>
              <div><SubmitButton>Associar</SubmitButton></div>
            </form>
          )}
        </Card>

        <Card title="Passo 4 — Contas de anúncio (Meta)">
          <ul className="mb-3 space-y-1 text-sm">
            {(links ?? []).map((l) => {
              const a = l.meta_ad_accounts as unknown as { account_id: string; account_name: string | null } | null;
              return (
                <li key={l.ad_account_id} className="flex items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                  <span>{a?.account_name ?? "?"} <Code>act_{a?.account_id}</Code>{l.campaign_filter && <> · campanhas contendo <Code>{l.campaign_filter}</Code></>}</span>
                  {w && (
                    <form action={unlinkAdAccount}>
                      <input type="hidden" name="offer_id" value={id} /><input type="hidden" name="ad_account_id" value={l.ad_account_id} />
                      <button className="text-xs text-rose-700">remover</button>
                    </form>
                  )}
                </li>
              );
            })}
            {!links?.length && <li className="text-slate-400">Nenhuma conta associada — sem gasto nesta oferta.</li>}
          </ul>
          {w && (accounts?.length ? (
            <form action={linkAdAccount} className="grid gap-2">
              <input type="hidden" name="offer_id" value={id} />
              <Field label="Conta">
                <select name="ad_account_id" className={inputCls}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name ?? a.account_id} (act_{a.account_id}){a.active ? "" : " — não monitorada"}</option>)}
                </select>
              </Field>
              <Field label="Filtro de campanha (opcional)" hint="Se a conta serve várias ofertas: só campanhas cujo NOME contém este texto contam gasto aqui.">
                <input name="campaign_filter" placeholder="[CESTA]" className={inputCls} />
              </Field>
              <div><SubmitButton>Associar conta</SubmitButton></div>
            </form>
          ) : <Notice tone="warn">Nenhuma conta importada. Vá em <a className="underline" href="/meta">Contas Meta</a> e clique em Descobrir contas.</Notice>)}
        </Card>

        <Card title="Passo 5 — Pixels">
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
            {!pixelLinks?.length && <li className="text-slate-400">Nenhum pixel associado.</li>}
          </ul>
          {w && (pixels?.length ? (
            <form action={linkPixel} className="flex items-end gap-2">
              <input type="hidden" name="offer_id" value={id} /><input type="hidden" name="back" value="offer" />
              <select name="pixel_id" className={inputCls}>{pixels.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.external_pixel_id})</option>)}</select>
              <SubmitButton>Associar pixel</SubmitButton>
            </form>
          ) : <Notice>Cadastre pixels em <a href="/pixels" className="underline">Pixels</a>.</Notice>)}
        </Card>
      </div>

      <div id="tracker" className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Passo 6 — Parâmetros de URL da Meta">
          <p className="mb-2 text-sm text-slate-500">Cole no campo “Parâmetros de URL” de cada anúncio. Detalhes em <a href="/utms" className="underline">Configuração de UTMs</a>.</p>
          <CodeBlock code="utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}" />
        </Card>
        <Card title="Passo 7 — Tracker Script">
          <p className="mb-2 text-sm text-slate-500">Cole antes do <Code>&lt;/body&gt;</Code> de TODAS as páginas do funil (vendas, obrigado, etc.). Ele guarda as UTMs e as repassa ao link da Cakto com <Code>callback</Code> = id da sessão.</p>
          <CodeBlock code={snippet} />
          {env.appUrl.includes("localhost") && <p className="mt-2 text-xs text-amber-700">APP_URL aponta para localhost: após o deploy, gere o script de novo com a URL pública.</p>}
        </Card>
      </div>
    </>
  );
}
