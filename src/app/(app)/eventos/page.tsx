import { retryDispatchAction, runDispatchNow } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Code, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/core/dates";
import { env } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";

const TONE: Record<string, "ok" | "warn" | "error" | "muted" | "info"> = { sent: "ok", pending: "warn", sending: "info", failed: "error", skipped: "muted" };
const LOG_TONE: Record<string, "info" | "warn" | "error"> = { info: "info", warn: "warn", error: "error" };

export default async function EventsPage({ searchParams }: PageProps<"/eventos">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  const pixel = typeof sp.pixel === "string" && /^[0-9a-f-]{36}$/.test(sp.pixel) ? sp.pixel : null;
  const code = typeof sp.code === "string" && /^[A-Z_]{3,40}$/.test(sp.code) ? sp.code : null;

  let dq = s.sb
    .from("conversion_dispatches")
    .select("id, event_name, event_id, status, attempts, last_http_status, last_error, created_at, sent_at, orders(ref_id, external_order_id), pixels(name, external_pixel_id)")
    .eq("workspace_id", s.workspace.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (pixel) dq = dq.eq("pixel_id", pixel);
  let lq = s.sb.from("integration_logs").select("id, level, code, provider, message, context, created_at").eq("workspace_id", s.workspace.id).order("created_at", { ascending: false }).limit(100);
  if (code) lq = lq.eq("code", code);
  const [{ data: dispatches }, { data: logs }] = await Promise.all([dq, lq]);

  return (
    <>
      <PageHeader title="Eventos" subtitle="Log operacional: envios server-side por pixel e eventos técnicos das integrações." />
      <Flash sp={sp} />
      {!env.capiEnabled && <Notice>CAPI desligado (<Code>CAPI_ENABLED=false</Code>): os eventos ficam pendentes e nada é enviado à Meta.</Notice>}
      <Card
        title={`Conversões (Purchase) por pixel${pixel ? " — filtrado" : ""}`}
        className="mt-4"
        actions={s.canWrite && <form action={runDispatchNow}><SubmitButton variant="secondary">Processar fila agora</SubmitButton></form>}
      >
        <Table>
          <thead><tr><Th>Criado</Th><Th>Evento</Th><Th>Pedido</Th><Th>Pixel</Th><Th>Status</Th><Th right>Tentativas</Th><Th right>HTTP</Th><Th>Erro</Th><Th /></tr></thead>
          <tbody>
            {(dispatches ?? []).map((d) => {
              const o = d.orders as unknown as { ref_id: string | null; external_order_id: string } | null;
              const p = d.pixels as unknown as { name: string; external_pixel_id: string } | null;
              return (
                <tr key={d.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(d.created_at, s.workspace.timezone)}</Td>
                  <Td>{d.event_name}<div className="font-mono text-[10px] text-slate-400">{d.event_id}</div></Td>
                  <Td><Code>{o?.ref_id ?? o?.external_order_id.slice(0, 8)}</Code></Td>
                  <Td className="text-xs">{p?.name}<div className="font-mono text-[10px] text-slate-400">{p?.external_pixel_id}</div></Td>
                  <Td><Badge tone={TONE[d.status] ?? "muted"}>{d.status}</Badge>{d.sent_at && <div className="text-[10px] text-slate-400">{formatDateTime(d.sent_at, s.workspace.timezone)}</div>}</Td>
                  <Td right>{d.attempts}</Td>
                  <Td right>{d.last_http_status ?? "—"}</Td>
                  <Td className="max-w-64 text-xs text-rose-700">{d.last_error}</Td>
                  <Td>{s.canWrite && (d.status === "failed" || d.status === "skipped") && <form action={retryDispatchAction}><input type="hidden" name="id" value={d.id} /><SubmitButton variant="secondary">Reprocessar</SubmitButton></form>}</Td>
                </tr>
              );
            })}
            {!dispatches?.length && <tr><Td className="text-slate-400">Nenhum evento. Vendas aprovadas de ofertas com pixel ativo geram um evento por pixel.</Td></tr>}
          </tbody>
        </Table>
      </Card>

      <Card title={`Logs das integrações${code ? ` — ${code}` : ""}`} className="mt-4" actions={code && <a href="/eventos" className="text-xs text-sky-700">limpar filtro</a>}>
        <Table>
          <thead><tr><Th>Quando</Th><Th>Nível</Th><Th>Código</Th><Th>Mensagem</Th><Th>Contexto</Th></tr></thead>
          <tbody>
            {(logs ?? []).map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(l.created_at, s.workspace.timezone)}</Td>
                <Td><Badge tone={LOG_TONE[l.level]}>{l.level}</Badge></Td>
                <Td><a href={`/eventos?code=${l.code}`} className="font-mono text-xs hover:underline">{l.code}</a></Td>
                <Td className="max-w-80 text-xs">{l.message}</Td>
                <Td className="max-w-96">
                  <pre className="whitespace-pre-wrap break-all font-mono text-[10px] text-slate-500">
                    {Object.entries((l.context ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n")}
                  </pre>
                </Td>
              </tr>
            ))}
            {!logs?.length && <tr><Td className="text-slate-400">Sem logs.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
