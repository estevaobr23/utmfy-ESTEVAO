import Link from "next/link";
import { checkOfferWebhook } from "@/app/actions";
import { AskClaude } from "@/components/ask-claude";
import { CodeBlock, SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Code, Empty, Notice, OrderStatusBadge, PageHeader } from "@/components/ui";
import { ask } from "@/lib/claude-chat";
import { timeAgo } from "@/lib/core/dates";
import { env, envStatus } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";
import { offerWebhookUrl } from "@/lib/services/offer-webhooks";

const EVENTS = ["Compra aprovada", "Pix gerado", "Boleto gerado", "Compra recusada", "Reembolso", "Reembolso solicitado", "Chargeback"];
const DAY = 24 * 3600 * 1000;

/** O que o usuário precisa saber de cada oferta em uma palavra: funciona, falta algo, ou nada chegou ainda. */
function health(o: { hasWebhook: boolean; products: number; lastAt: string | null }) {
  if (!o.hasWebhook) return { tone: "warn" as const, label: "Falta criar o webhook na Cakto", hint: "Siga os 3 passos no fim desta página, usando a URL abaixo." };
  if (!o.products) return { tone: "warn" as const, label: "Webhook sem produtos", hint: "Na Cakto, edite o webhook e marque os produtos desta oferta." };
  if (!o.lastAt) return { tone: "info" as const, label: "Pronto, aguardando a 1ª venda", hint: "Assim que a Cakto enviar um evento, ele aparece aqui." };
  return { tone: "ok" as const, label: "Funcionando", hint: null };
}

export default async function CaktoPage({ searchParams }: PageProps<"/cakto">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  const e = envStatus();
  const now = new Date().getTime();
  const since = new Date(now - 7 * DAY).toISOString();
  const [{ data: offers }, { data: items }, { data: recent }, { data: conn }, { data: failed }] = await Promise.all([
    s.sb.from("offers").select("id, name, slug, status, webhook_token, cakto_webhook_id, cakto_webhook_checked_at").eq("workspace_id", s.workspace.id).neq("status", "archived").order("created_at"),
    s.sb.from("offer_cakto_items").select("offer_id, cakto_product_id, product_name, label").eq("workspace_id", s.workspace.id),
    s.sb.from("orders").select("offer_id, status, status_event_at, updated_at").eq("workspace_id", s.workspace.id).not("offer_id", "is", null).order("updated_at", { ascending: false }).limit(300),
    s.sb.from("cakto_connections").select("status, last_webhook_at, last_error").eq("workspace_id", s.workspace.id).maybeSingle(),
    s.sb.from("webhook_events").select("event_name, processing_status, error_message, received_at").eq("workspace_id", s.workspace.id).in("processing_status", ["failed", "rejected"]).gte("received_at", since).order("received_at", { ascending: false }).limit(50),
  ]);

  const lastByOffer = new Map<string, { status: string; at: string }>();
  for (const o of recent ?? []) {
    if (o.offer_id && !lastByOffer.has(o.offer_id)) lastByOffer.set(o.offer_id, { status: o.status, at: o.status_event_at ?? o.updated_at });
  }
  const missingCreds = (["CAKTO_CLIENT_ID", "CAKTO_CLIENT_SECRET"] as const).filter((k) => !e[k]);
  const lastWebhook = conn?.last_webhook_at ?? null;
  const stale = lastWebhook ? now - new Date(lastWebhook).getTime() > 3 * DAY : false;

  return (
    <>
      <PageHeader
        title="Webhooks da Cakto"
        subtitle="Uma URL por oferta. Cole a URL da oferta na Cakto e as vendas dela passam a aparecer no painel."
        actions={
          <>
            <AskClaude prompt={ask.novaOferta()} label="Criar oferta e webhook com o Claude" copy={false} />
            {s.canWrite && (
              <form action={checkOfferWebhook}>
                <SubmitButton variant="secondary" pendingText="Verificando...">Verificar tudo na Cakto</SubmitButton>
              </form>
            )}
          </>
        }
      />
      <Flash sp={sp} />

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#aeb8c9]">
        <span>Conexão com a Cakto:</span>
        <Badge tone={missingCreds.length || conn?.status === "error" ? "error" : conn?.status === "active" ? "ok" : "warn"}>
          {missingCreds.length ? "credenciais ausentes" : conn?.status === "error" ? "com erro" : conn?.status === "active" ? "ativa" : "sem conexão"}
        </Badge>
        <span>último evento recebido {lastWebhook ? timeAgo(lastWebhook) : "— nenhum ainda"}</span>
      </div>

      {missingCreds.length > 0 && <div className="mb-4"><Notice tone="error">Faltam no servidor: <Code>{missingCreds.join(", ")}</Code>. Sem elas o painel não consegue conferir os webhooks.</Notice></div>}
      {stale && <div className="mb-4"><Notice tone="warn">Nenhum evento da Cakto chegou há mais de 3 dias. Se você teve vendas, confira se os webhooks continuam ativos na Cakto.</Notice></div>}
      {conn?.last_error && <div className="mb-4"><Notice tone="error">{conn.last_error}</Notice></div>}
      {env.appUrl.includes("localhost") && <div className="mb-4"><Notice tone="warn">APP_URL é localhost: a Cakto não alcança essa URL. Faça o deploy antes de cadastrar.</Notice></div>}
      {(failed?.length ?? 0) > 0 && (
        <div className="mb-4">
          <Notice tone="error">
            <b>{failed!.length} evento(s) da Cakto deram erro nos últimos 7 dias.</b>{" "}
            Último: {failed![0].event_name ?? "evento"} {timeAgo(failed![0].received_at)}
            {failed![0].processing_status === "rejected" ? " — assinatura recusada" : failed![0].error_message ? ` — ${failed![0].error_message}` : ""}.
            <div className="mt-2">
              <AskClaude tone="problem" label="Resolver com o Claude" prompt={ask.problema("Webhooks Cakto", `${failed!.length} evento(s) da Cakto com erro (7 dias)`, `último: ${failed![0].event_name ?? "evento"} ${failed![0].processing_status === "rejected" ? "— assinatura recusada" : failed![0].error_message ?? ""}`)} />
            </div>
          </Notice>
        </div>
      )}

      <div className="space-y-4">
        {!offers?.length && <Empty>Nenhuma oferta ainda. Crie a primeira em <Link href="/ofertas" className="underline">Gerenciar ofertas</Link> e a URL do webhook aparece aqui.</Empty>}
        {(offers ?? []).map((o) => {
          const products = (items ?? []).filter((i) => i.offer_id === o.id);
          const last = lastByOffer.get(o.id) ?? null;
          const h = health({ hasWebhook: !!o.cakto_webhook_id, products: products.length, lastAt: last?.at ?? null });
          return (
            <Card
              key={o.id}
              title={o.name}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <AskClaude
                    tone={h.tone === "warn" ? "problem" : "default"}
                    label={h.tone === "warn" ? "Resolver com o Claude" : "Pedir ao Claude"}
                    prompt={ask.webhook({ id: o.id, name: o.name, slug: o.slug }, !o.cakto_webhook_id ? "sem_webhook" : !products.length ? "sem_produtos" : "ok")}
                    copy={false}
                  />
                  <Badge tone={h.tone}>{h.tone === "ok" ? "✓ " : h.tone === "warn" ? "⚠ " : ""}{h.label}</Badge>
                </div>
              }
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-[#8f9bb1]">URL do webhook desta oferta</div>
              <div className="mt-1">{o.webhook_token ? <CodeBlock code={offerWebhookUrl(env.appUrl, o.webhook_token)} /> : <Notice tone="warn">Esta oferta ainda não tem URL (migration pendente).</Notice>}</div>
              {h.hint && <p className="mt-2 text-sm text-amber-200">{h.hint}</p>}

              <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8f9bb1]">Produtos desta oferta</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {products.map((p) => <Badge key={`${p.cakto_product_id}`} tone="muted">{p.product_name ?? p.label ?? p.cakto_product_id}</Badge>)}
                    {!products.length && <span className="text-[#8f9bb1]">nenhum</span>}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#8f9bb1]">Último evento recebido</div>
                  <div className="mt-1 flex items-center gap-2">
                    {last ? <><OrderStatusBadge status={last.status} /><span className="text-[#aeb8c9]">{timeAgo(last.at)}</span></> : <span className="text-[#8f9bb1]">nenhum ainda</span>}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#3a4762] pt-3">
                {s.canWrite && (
                  <form action={checkOfferWebhook}>
                    <input type="hidden" name="offer_id" value={o.id} /><input type="hidden" name="back" value="cakto" />
                    <SubmitButton variant="secondary" pendingText="Verificando...">Verificar na Cakto</SubmitButton>
                  </form>
                )}
                <Link href={`/ofertas/${o.id}/integracoes`} className="text-xs text-sky-300 hover:underline">abrir oferta</Link>
                {o.cakto_webhook_checked_at && <span className="text-xs text-[#8f9bb1]">verificado {timeAgo(o.cakto_webhook_checked_at)}</span>}
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="Como criar o webhook de uma oferta nova" className="mt-6" actions={<AskClaude prompt={ask.novaOferta()} label="Fazer isso com o Claude" />}>
        <p className="mb-3 text-sm text-[#aeb8c9]">Caminho rápido: clique em <b>Fazer isso com o Claude</b>. Ele cria a oferta, o webhook e o pixel; você só confirma. O passo a passo manual abaixo continua valendo.</p>
        <ol className="space-y-3 text-sm text-[#dce2ec]">
          <li><b>1. Crie a oferta no UTMFY.</b> A URL do webhook nasce sozinha e aparece nesta página. <Link href="/ofertas" className="text-sky-300 underline">Criar oferta</Link></li>
          <li>
            <b>2. Na Cakto, vá em Integrações → Webhooks → Adicionar.</b> Cole a URL da oferta, marque <b>só os produtos dela</b> e estes eventos:
            <div className="mt-1.5 flex flex-wrap gap-1.5">{EVENTS.map((ev) => <Badge key={ev} tone="info">{ev}</Badge>)}</div>
          </li>
          <li><b>3. Volte aqui e clique em “Verificar na Cakto”.</b> Quando o selo da oferta ficar verde, falta só a primeira venda para confirmar.</li>
        </ol>
        <p className="mt-3 text-xs text-[#8f9bb1]">Atenção: produto que não está marcado no webhook vende e não aparece no painel.</p>
      </Card>
    </>
  );
}
