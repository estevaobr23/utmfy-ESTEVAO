import { createDemo, deleteDemo, updateWorkspace } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Code, Field, inputCls, Notice, PageHeader } from "@/components/ui";
import { env, envStatus } from "@/lib/env";
import { requireSession } from "@/lib/session";

export default async function SettingsPage({ searchParams }: PageProps<"/configuracoes">) {
  const s = await requireSession();
  const sp = await searchParams;
  const e = envStatus();
  const ws = s.workspace;
  const hasDemo = s.workspaces.some((w) => w.is_demo);
  return (
    <>
      <PageHeader title="Configurações" />
      <Flash sp={sp} />
      {!ws && <Notice tone="warn">Seu usuário não pertence a nenhum workspace. Rode <Code>npm run admin:create</Code> ou crie os dados DEMO abaixo.</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        {ws && (
          <Card title="Workspace">
            <form action={updateWorkspace} className="grid gap-3">
              <Field label="Nome"><input name="name" defaultValue={ws.name} className={inputCls} disabled={!s.canWrite} /></Field>
              <Field label="Fuso horário do dashboard" hint="Define o que é “hoje/ontem” nos relatórios. Gasto Meta usa o fuso de cada conta."><input name="timezone" defaultValue={ws.timezone} className={inputCls} disabled={!s.canWrite} /></Field>
              <Field label="Moeda" hint="Pedidos e contas em outra moeda NÃO são somados (sem conversão automática)."><input name="currency" defaultValue={ws.currency} className={inputCls} disabled={!s.canWrite} /></Field>
              <div className="text-xs text-slate-500">slug: <Code>{ws.slug}</Code> {ws.is_demo && <Badge tone="warn">DEMO</Badge>}</div>
              {s.canWrite && <div><SubmitButton>Salvar</SubmitButton></div>}
            </form>
          </Card>
        )}
        <Card title="Variáveis de ambiente (servidor)">
          <p className="mb-2 text-xs text-slate-500">Só mostramos se existem. Valores nunca saem do servidor.</p>
          <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {Object.entries(e).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-2"><Code>{k}</Code>{v ? <Badge tone="ok">{k === "CAPI_ENABLED" ? "ligado" : "••••••"}</Badge> : <Badge tone={k.startsWith("META_APP") || k === "META_CAPI_TOKEN" || k === "CAPI_ENABLED" ? "muted" : "error"}>{k === "CAPI_ENABLED" ? "desligado" : "ausente"}</Badge>}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">APP_URL: <Code>{env.appUrl}</Code> · Graph API <Code>{env.metaGraphVersion}</Code></p>
        </Card>
        <Card title="Modo DEMO">
          <p className="mb-3 text-sm text-slate-500">Cria um workspace <b>separado</b> (“DEMO — dados fictícios”) com 2 ofertas, campanhas, gasto e vendas passando pelo pipeline real. Nunca mistura com produção; aparece com faixa amarela.</p>
          <div className="flex gap-2">
            <form action={createDemo}><SubmitButton pendingText="Gerando...">{hasDemo ? "Recriar dados DEMO" : "Criar dados DEMO"}</SubmitButton></form>
            {hasDemo && <form action={deleteDemo}><SubmitButton variant="danger">Apagar DEMO</SubmitButton></form>}
          </div>
        </Card>
        <Card title="Rotinas automáticas">
          <ul className="space-y-1 text-sm">
            <li><Code>/api/cron/meta-sync</Code> — Meta: hoje + ontem + retroativo</li>
            <li><Code>/api/cron/cakto-reconcile</Code> — reconciliação Cakto (3 dias)</li>
            <li><Code>/api/cron/capi-dispatch</Code> — fila CAPI</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Chamadas com <Code>Authorization: Bearer CRON_SECRET</Code>. Agendamento: Vercel Cron (diário, plano Hobby) + pg_cron a cada 15 min (ver SETUP.md).</p>
        </Card>
      </div>
    </>
  );
}
