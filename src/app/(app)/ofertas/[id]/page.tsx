import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardView } from "@/components/dashboard";
import { Flash } from "@/components/filters";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { envStatus } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";

export default async function OfferDashboard({ params, searchParams }: PageProps<"/ofertas/[id]">) {
  const s = await requireWorkspace();
  const { id } = await params;
  const sp = await searchParams;
  const { data: offer } = await s.sb.from("offers").select("id, name, slug, status").eq("id", id).eq("workspace_id", s.workspace.id).maybeSingle();
  if (!offer) notFound();

  const [items, accounts, pixels, sessions, webhook, sessionsWithAd, meta] = await Promise.all([
    s.sb.from("offer_cakto_items").select("id", { count: "exact", head: true }).eq("offer_id", id),
    s.sb.from("offer_ad_accounts").select("ad_account_id", { count: "exact", head: true }).eq("offer_id", id),
    s.sb.from("offer_pixels").select("pixel_id", { count: "exact", head: true }).eq("offer_id", id).eq("active", true),
    s.sb.from("tracking_sessions").select("id", { count: "exact", head: true }).eq("offer_id", id),
    s.sb.from("orders").select("id", { count: "exact", head: true }).eq("offer_id", id),
    s.sb.from("tracking_sessions").select("id", { count: "exact", head: true }).eq("offer_id", id).not("ad_id", "is", null),
    s.sb.from("meta_connections").select("status").eq("workspace_id", s.workspace.id),
  ]);
  const env = envStatus();
  const metaOk = (meta.data ?? []).some((m) => m.status === "active") || env.META_ACCESS_TOKEN;
  const steps: [string, boolean, string, string][] = [
    ["Criar oferta", true, `/ofertas/${id}/configurar`, "feito"],
    ["Associar produto/oferta da Cakto", (items.count ?? 0) > 0, `/ofertas/${id}/configurar`, `${items.count ?? 0} associado(s)`],
    ["Conectar conta Meta", !!metaOk, "/meta", metaOk ? "conectada" : "pendente"],
    ["Selecionar conta de anúncio", (accounts.count ?? 0) > 0, `/ofertas/${id}/configurar`, `${accounts.count ?? 0} conta(s)`],
    ["Cadastrar/selecionar pixel", (pixels.count ?? 0) > 0, `/ofertas/${id}/configurar`, `${pixels.count ?? 0} pixel(s)`],
    ["Copiar código de UTMs", (sessionsWithAd.count ?? 0) > 0, "/utms", (sessionsWithAd.count ?? 0) > 0 ? "UTMs com ad_id chegando" : "aguardando cliques com UTM"],
    ["Copiar Tracker Script", (sessions.count ?? 0) > 0, `/ofertas/${id}/configurar#tracker`, `${sessions.count ?? 0} sessão(ões)`],
    ["Testar integração", (webhook.count ?? 0) > 0, "/diagnostico", `${webhook.count ?? 0} pedido(s) recebidos`],
  ];
  const done = steps.filter((x) => x[1]).length;
  steps.push(["Dashboard ativo", done === steps.length, `/ofertas/${id}`, done === steps.length ? "tudo pronto" : `${done}/${steps.length} etapas`]);

  return (
    <>
      <PageHeader
        title={offer.name}
        subtitle={<>Dashboard da oferta · <span className="font-mono">{offer.slug}</span></>}
        actions={<><LinkButton href={`/ofertas/${id}/configurar`}>Configurar</LinkButton><LinkButton href={`/ofertas/${id}/saude`}>Saúde</LinkButton></>}
      />
      <Flash sp={sp} />
      <details className="mb-4 rounded-lg border border-slate-200 bg-white" open={done < steps.length - 1}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Onboarding · {done}/{steps.length - 1} etapas</summary>
        <ol className="grid gap-1 px-4 pb-4 md:grid-cols-3">
          {steps.map(([label, ok, href, detail], i) => (
            <li key={label} className="flex items-start gap-2 text-sm">
              <span className={ok ? "text-emerald-600" : "text-slate-400"}>{ok ? "✓" : "○"}</span>
              <span>
                <Link href={href} className="font-medium hover:underline">Passo {i + 1}: {label}</Link>
                <span className="block text-xs text-slate-500">{detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </details>
      <DashboardView sb={s.sb} ws={s.workspace} sp={sp} offerId={id} basePath={`/ofertas/${id}`} />
      <Card title="Atalhos" className="mt-6">
        <div className="flex flex-wrap gap-2 text-sm">
          <LinkButton href={`/pedidos?offer=${id}`}>Pedidos</LinkButton>
          <LinkButton href={`/nao-rastreadas?offer=${id}`}>Não rastreadas</LinkButton>
          <LinkButton href={`/campanhas?offer=${id}`}>Campanhas</LinkButton>
        </div>
      </Card>
    </>
  );
}
