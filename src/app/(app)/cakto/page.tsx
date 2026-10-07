import { syncCaktoNow } from "@/app/actions";
import { CodeBlock, SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Code, Field, inputCls, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { addDays, formatDateTime, timeAgo, todayIn } from "@/lib/core/dates";
import { env, envStatus } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";

const EVENTS = ["purchase_approved", "pix_gerado", "purchase_refused", "refund", "refund_requested", "chargeback", "boleto_gerado"];

export default async function CaktoPage({ searchParams }: PageProps<"/cakto">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  const e = envStatus();
  const [{ data: conn }, { data: events }, { data: changes }, { data: jobs }] = await Promise.all([
    s.sb.from("cakto_connections").select("*").eq("workspace_id", s.workspace.id).maybeSingle(),
    s.sb.from("webhook_events").select("id, event_name, external_order_id, processing_status, signature_method, received_at, error_message").eq("workspace_id", s.workspace.id).order("received_at", { ascending: false }).limit(20),
    s.sb.from("reconciliation_changes").select("external_order_id, change_type, before, after, created_at").eq("workspace_id", s.workspace.id).order("created_at", { ascending: false }).limit(20),
    s.sb.from("sync_jobs").select("kind, status, trigger, started_at, stats, error").eq("workspace_id", s.workspace.id).in("kind", ["cakto_sync", "cakto_reconcile"]).order("started_at", { ascending: false }).limit(6),
  ]);
  const webhookUrl = `${env.appUrl}/api/webhooks/cakto?ws=${s.workspace.slug}`;
  const today = todayIn(s.workspace.timezone);

  return (
    <>
      <PageHeader title="Integração Cakto" subtitle="A Cakto é a fonte da verdade de receita, vendas e status. Webhook em tempo real + API para sincronizar e reconciliar." />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Credenciais (servidor)">
          <ul className="space-y-1 text-sm">
            {(["CAKTO_CLIENT_ID", "CAKTO_CLIENT_SECRET", "CAKTO_WEBHOOK_SECRETS"] as const).map((k) => (
              <li key={k} className="flex justify-between"><Code>{k}</Code>{e[k] ? <Badge tone="ok">•••••••• configurado</Badge> : <Badge tone="error">ausente</Badge>}</li>
            ))}
          </ul>
          <div className="mt-3 text-xs text-slate-500">
            Status: <Badge tone={conn?.status === "active" ? "ok" : conn?.status === "error" ? "error" : "warn"}>{conn?.status ?? "sem conexão"}</Badge>
            {" · "}último webhook {timeAgo(conn?.last_webhook_at)} · última API {timeAgo(conn?.last_api_ok_at)}
            {conn?.last_error && <div className="text-rose-700">{conn.last_error}</div>}
          </div>
        </Card>

        <Card title="Webhook">
          <p className="mb-2 text-sm text-slate-500">Cadastre esta URL na Cakto (Integrações → Webhooks) para os produtos desta operação, com os eventos:</p>
          <CodeBlock code={webhookUrl} />
          <div className="mt-2 flex flex-wrap gap-1">{EVENTS.map((ev) => <Code key={ev}>{ev}</Code>)}</div>
          <p className="mt-2 text-xs text-slate-500">
            Validação: HMAC-SHA256 em <Code>X-Cakto-Signature</Code> + <Code>X-Cakto-Timestamp</Code> (tolerância 5 min).{" "}
            {env.caktoAllowBodySecret ? "Fallback pelo campo secret do corpo: permitido." : "Fallback pelo corpo: desativado."} Copie o secret de cada webhook para <Code>CAKTO_WEBHOOK_SECRETS</Code> (separados por vírgula).
          </p>
          {env.appUrl.includes("localhost") && <Notice tone="warn">APP_URL é localhost: a Cakto não alcança. Faça o deploy (ou use um túnel) antes de cadastrar.</Notice>}
        </Card>
      </div>

      <Card title="Sincronizar Cakto / Reconciliar" className="mt-4">
        <p className="mb-3 text-sm text-slate-500">
          Busca na API os pedidos <b>atualizados</b> no período e aplica pela mesma máquina de estados do webhook. Recupera vendas perdidas, reembolsos e chargebacks não processados.
          A reconciliação automática roda pelo cron (últimos 3 dias).
        </p>
        {s.canWrite && (
          <form action={syncCaktoNow} className="flex flex-wrap items-end gap-2">
            <Field label="De"><input type="date" name="from" defaultValue={addDays(today, -2)} className={inputCls} /></Field>
            <Field label="Até"><input type="date" name="to" defaultValue={today} className={inputCls} /></Field>
            <Field label="Modo">
              <select name="mode" className={inputCls}><option value="sync">Sincronizar</option><option value="reconcile">Reconciliar (registra divergências)</option></select>
            </Field>
            <SubmitButton pendingText="Sincronizando...">SINCRONIZAR CAKTO</SubmitButton>
          </form>
        )}
        <ul className="mt-3 space-y-1 text-xs text-slate-600">
          {(jobs ?? []).map((j, i) => (
            <li key={i}><Badge tone={j.status === "success" ? "ok" : j.status === "partial" ? "warn" : j.status === "running" ? "info" : "error"}>{j.status}</Badge> {j.kind} ({j.trigger}) · {timeAgo(j.started_at)} · {JSON.stringify(j.stats)}{j.error && <span className="text-rose-700"> · {j.error}</span>}</li>
          ))}
        </ul>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold">Últimos webhooks</h2>
          <Table>
            <thead><tr><Th>Recebido</Th><Th>Evento</Th><Th>Pedido</Th><Th>Status</Th></tr></thead>
            <tbody>
              {(events ?? []).map((ev) => (
                <tr key={ev.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(ev.received_at, s.workspace.timezone)}</Td>
                  <Td className="text-xs">{ev.event_name}<div className="text-[10px] text-slate-400">{ev.signature_method}</div></Td>
                  <Td className="font-mono text-[10px]">{ev.external_order_id?.slice(0, 13)}</Td>
                  <Td><Badge tone={ev.processing_status === "processed" ? "ok" : ev.processing_status === "failed" ? "error" : "muted"}>{ev.processing_status}</Badge>{ev.error_message && <div className="text-[10px] text-rose-700">{ev.error_message}</div>}</Td>
                </tr>
              ))}
              {!events?.length && <tr><Td className="text-slate-400">nenhum</Td></tr>}
            </tbody>
          </Table>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold">Log de reconciliação</h2>
          <Table>
            <thead><tr><Th>Quando</Th><Th>Pedido</Th><Th>Mudança</Th></tr></thead>
            <tbody>
              {(changes ?? []).map((c, i) => (
                <tr key={i}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(c.created_at, s.workspace.timezone)}</Td>
                  <Td className="font-mono text-[10px]">{c.external_order_id.slice(0, 13)}</Td>
                  <Td className="text-xs"><Badge tone="info">{c.change_type}</Badge> {(c.before as { status?: string } | null)?.status ?? "∅"} → {(c.after as { status?: string } | null)?.status}</Td>
                </tr>
              ))}
              {!changes?.length && <tr><Td className="text-slate-400">nenhuma divergência registrada</Td></tr>}
            </tbody>
          </Table>
        </div>
      </div>
    </>
  );
}
