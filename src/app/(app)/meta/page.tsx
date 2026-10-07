import { discoverMetaAccounts, setFxRate, syncMetaNow, toggleAccount } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Code, Empty, Field, inputCls, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/core/dates";
import { env, envStatus } from "@/lib/env";
import { requireWorkspace } from "@/lib/session";

export default async function MetaPage({ searchParams }: PageProps<"/meta">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  const [{ data: conns }, { data: accounts }, { data: links }, { data: jobs }] = await Promise.all([
    s.sb.from("meta_connections").select("id, name, token_source, token_hint, meta_user_name, status, last_sync_at, last_error, expires_at").eq("workspace_id", s.workspace.id).order("created_at"),
    s.sb.from("meta_ad_accounts").select("id, account_id, account_name, currency, timezone, account_status, active, last_sync_at, last_error, fx_rate").eq("workspace_id", s.workspace.id).order("account_name"),
    s.sb.from("offer_ad_accounts").select("ad_account_id, offers(name)").eq("workspace_id", s.workspace.id),
    s.sb.from("sync_jobs").select("kind, status, started_at, finished_at, stats, error").eq("workspace_id", s.workspace.id).in("kind", ["meta_insights", "meta_accounts"]).order("started_at", { ascending: false }).limit(8),
  ]);
  const e = envStatus();
  const w = s.canWrite;

  return (
    <>
      <PageHeader title="Contas Meta" subtitle={<>Integração <b>somente leitura</b> (Marketing API {env.metaGraphVersion}). O sistema nunca altera campanhas, orçamentos, status ou anúncios.</>} />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Passo 3 — Conexão">
          {!conns?.length && !e.META_ACCESS_TOKEN && <Notice tone="warn">Nenhuma conexão. Defina <Code>META_ACCESS_TOKEN</Code> (token de System User com <Code>ads_read</Code>) ou conecte via OAuth.</Notice>}
          <ul className="space-y-2 text-sm">
            {(conns ?? []).map((c) => (
              <li key={c.id} className="rounded border border-slate-100 p-2">
                <div className="flex items-center justify-between">
                  <b>{c.name}</b>
                  <Badge tone={c.status === "active" ? "ok" : c.status === "pending" ? "warn" : "error"}>{c.status}</Badge>
                </div>
                <div className="text-xs text-slate-500">
                  Meta Token: •••••••• {c.status === "active" ? "conectado" : ""} {c.token_hint && `(${c.token_hint})`} · origem {c.token_source === "env" ? "variável de ambiente" : "Supabase Vault"}
                  {c.meta_user_name && ` · ${c.meta_user_name}`}
                  {c.expires_at && ` · expira ${formatDateTime(c.expires_at, s.workspace.timezone)}`}
                </div>
                {c.last_error && <div className="text-xs text-rose-700">{c.last_error}</div>}
              </li>
            ))}
            {!conns?.length && e.META_ACCESS_TOKEN && <li className="text-xs text-slate-500">META_ACCESS_TOKEN encontrado — a conexão será criada ao descobrir contas.</li>}
          </ul>
          {w && (
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={discoverMetaAccounts}><SubmitButton pendingText="Buscando...">Descobrir contas</SubmitButton></form>
              {e.META_APP_ID && e.META_APP_SECRET ? (
                <a href="/api/meta/oauth/start" className="rounded-md bg-white px-3 py-1.5 text-sm ring-1 ring-slate-300">Conectar com Facebook (ads_read)</a>
              ) : (
                <span className="self-center text-xs text-slate-400">OAuth: defina META_APP_ID/META_APP_SECRET</span>
              )}
            </div>
          )}
        </Card>

        <Card title="Sincronização">
          <p className="mb-3 text-sm text-slate-500">
            Automática (cron): hoje + ontem + retroativo de {env.metaLookbackDays} dia(s) para capturar revisões da Meta. Períodos &gt; 7 dias usam relatório assíncrono.
          </p>
          {w && (
            <form action={syncMetaNow} className="flex flex-wrap items-end gap-2">
              <Field label="De (opcional)"><input type="date" name="since" className={inputCls} /></Field>
              <Field label="Até (opcional)"><input type="date" name="until" className={inputCls} /></Field>
              <SubmitButton pendingText="Sincronizando...">Atualizar dados da Meta</SubmitButton>
            </form>
          )}
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {(jobs ?? []).map((j, i) => (
              <li key={i}>
                <Badge tone={j.status === "success" ? "ok" : j.status === "running" ? "info" : j.status === "partial" ? "warn" : "error"}>{j.status}</Badge> {j.kind} · {timeAgo(j.started_at)}
                {j.stats && typeof j.stats === "object" && "insights" in j.stats ? ` · ${String((j.stats as Record<string, unknown>).insights)} linhas` : ""}
                {j.error && <span className="text-rose-700"> · {j.error}</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Passo 4 — Contas de anúncio</h2>
      {!accounts?.length ? (
        <Empty>Nenhuma conta importada. Clique em “Descobrir contas”.</Empty>
      ) : (
        <Table>
          <thead><tr><Th>Conta</Th><Th>Moeda / fuso</Th><Th>Ofertas</Th><Th>Última sync</Th><Th>Monitorar</Th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <Td>{a.account_name}<div className="font-mono text-xs text-slate-400">act_{a.account_id}</div>{a.account_status !== null && a.account_status !== 1 && <Badge tone="warn">status {a.account_status}</Badge>}</Td>
                <Td>
                  {a.currency} · {a.timezone}
                  {a.currency && a.currency !== s.workspace.currency && (
                    <div className="mt-1">
                      {a.fx_rate ? <Badge tone="info">câmbio manual: 1 {a.currency} = {Number(a.fx_rate)} {s.workspace.currency}</Badge> : <Badge tone="warn">moeda ≠ {s.workspace.currency}: gasto NÃO somado</Badge>}
                      {w && (
                        <form action={setFxRate} className="mt-1 flex gap-1">
                          <input type="hidden" name="id" value={a.id} />
                          <input name="fx_rate" defaultValue={a.fx_rate ?? ""} placeholder={`1 ${a.currency} = ? ${s.workspace.currency}`} className={`${inputCls} w-36 text-xs`} />
                          <SubmitButton variant="secondary">salvar</SubmitButton>
                        </form>
                      )}
                    </div>
                  )}
                </Td>
                <Td className="text-xs">{(links ?? []).filter((l) => l.ad_account_id === a.id).map((l) => (l.offers as unknown as { name: string } | null)?.name).join(", ") || <span className="text-slate-400">nenhuma</span>}</Td>
                <Td className="text-xs">{timeAgo(a.last_sync_at)}{a.last_error && <div className="text-rose-700">{a.last_error}</div>}</Td>
                <Td>
                  {w ? (
                    <form action={toggleAccount}>
                      <input type="hidden" name="id" value={a.id} /><input type="hidden" name="active" value={String(!a.active)} />
                      <SubmitButton variant={a.active ? "secondary" : "primary"}>{a.active ? "Monitorando ✓" : "Monitorar"}</SubmitButton>
                    </form>
                  ) : a.active ? "sim" : "não"}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-2 text-xs text-slate-500">Associe as contas às ofertas em Ofertas → Configurar. Uma conta pode servir várias ofertas (use o filtro de nome de campanha).</p>
    </>
  );
}
