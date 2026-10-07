import { createPixel, linkPixel, setPixelToken, unlinkPixel, updatePixel } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash } from "@/components/filters";
import { Badge, Card, Code, Empty, Field, inputCls, Notice, PageHeader } from "@/components/ui";
import { env } from "@/lib/env";
import { listOffers } from "@/lib/queries";
import { requireWorkspace } from "@/lib/session";

export default async function PixelsPage({ searchParams }: PageProps<"/pixels">) {
  const s = await requireWorkspace();
  const sp = await searchParams;
  const [{ data: pixels }, { data: links }, offers, { data: dispatchStats }] = await Promise.all([
    s.sb.from("pixels").select("id, external_pixel_id, name, active, server_tracking_enabled, token_source, token_hint, test_event_code").eq("workspace_id", s.workspace.id).order("created_at"),
    s.sb.from("offer_pixels").select("offer_id, pixel_id, active").eq("workspace_id", s.workspace.id),
    listOffers(s.sb, s.workspace.id),
    s.sb.from("conversion_dispatches").select("pixel_id, status").eq("workspace_id", s.workspace.id).limit(5000),
  ]);
  const w = s.canWrite;
  const count = (pid: string, st: string) => (dispatchStats ?? []).filter((d) => d.pixel_id === pid && d.status === st).length;

  return (
    <>
      <PageHeader title="Pixels" subtitle="Pixels/datasets da Meta. Uma oferta pode ter vários pixels e um pixel pode servir várias ofertas. Cada pixel tem seu próprio histórico de envio." />
      <Flash sp={sp} />
      {!env.capiEnabled && (
        <Notice tone="info">
          Envio server-side (CAPI) está <b>desligado</b> (<Code>CAPI_ENABLED=false</Code>). Os eventos Purchase já são enfileirados por pixel em <a href="/eventos" className="underline">Eventos</a> e serão enviados quando você ligar.
        </Notice>
      )}
      <div className="mt-4 space-y-4">
        {!pixels?.length && <Empty>Nenhum pixel cadastrado.</Empty>}
        {(pixels ?? []).map((p) => {
          const linked = (links ?? []).filter((l) => l.pixel_id === p.id);
          return (
            <Card
              key={p.id}
              title={<>{p.name} <Code>{p.external_pixel_id}</Code></>}
              actions={<div className="flex gap-1">{p.active ? <Badge tone="ok">ativo</Badge> : <Badge>inativo</Badge>}{p.server_tracking_enabled ? <Badge tone="info">server-side ON</Badge> : <Badge>server-side OFF</Badge>}</div>}
            >
              <div className="grid gap-4 md:grid-cols-3">
                <div className="text-sm">
                  <div className="mb-1 font-medium">Ofertas</div>
                  <ul className="space-y-1">
                    {linked.map((l) => (
                      <li key={l.offer_id} className="flex items-center justify-between">
                        {offers.find((o) => o.id === l.offer_id)?.name ?? l.offer_id}
                        {w && (
                          <form action={unlinkPixel}>
                            <input type="hidden" name="offer_id" value={l.offer_id} /><input type="hidden" name="pixel_id" value={p.id} />
                            <button className="text-xs text-rose-700">remover</button>
                          </form>
                        )}
                      </li>
                    ))}
                    {!linked.length && <li className="text-slate-400">nenhuma</li>}
                  </ul>
                  {w && offers.length > 0 && (
                    <form action={linkPixel} className="mt-2 flex gap-1">
                      <input type="hidden" name="pixel_id" value={p.id} />
                      <select name="offer_id" className={`${inputCls} text-xs`}>{offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                      <SubmitButton variant="secondary">+</SubmitButton>
                    </form>
                  )}
                </div>
                <div className="text-sm">
                  <div className="mb-1 font-medium">Histórico de envio</div>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone="ok">enviados {count(p.id, "sent")}</Badge>
                    <Badge tone="warn">pendentes {count(p.id, "pending")}</Badge>
                    <Badge tone="error">falhas {count(p.id, "failed")}</Badge>
                    <Badge>ignorados {count(p.id, "skipped")}</Badge>
                  </div>
                  <a href={`/eventos?pixel=${p.id}`} className="mt-2 inline-block text-xs text-sky-700 hover:underline">ver eventos deste pixel</a>
                </div>
                {w && (
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap gap-1">
                      <form action={updatePixel}><input type="hidden" name="pixel_id" value={p.id} /><input type="hidden" name="active" value={String(!p.active)} /><SubmitButton variant="secondary">{p.active ? "Desativar" : "Ativar"}</SubmitButton></form>
                      <form action={updatePixel}><input type="hidden" name="pixel_id" value={p.id} /><input type="hidden" name="server_tracking_enabled" value={String(!p.server_tracking_enabled)} /><SubmitButton variant="secondary">{p.server_tracking_enabled ? "Desligar server-side" : "Ligar server-side"}</SubmitButton></form>
                    </div>
                    <div className="text-xs text-slate-500">
                      Token CAPI: {p.token_source === "none" ? "não configurado" : p.token_source === "env" ? "usa META_CAPI_TOKEN" : `•••••••• conectado (${p.token_hint ?? ""})`}
                    </div>
                    <form action={setPixelToken} className="flex gap-1">
                      <input type="hidden" name="pixel_id" value={p.id} /><input type="hidden" name="mode" value="vault" />
                      <input name="token" type="password" autoComplete="off" placeholder="Token CAPI (vai para o Vault)" className={`${inputCls} text-xs`} />
                      <SubmitButton variant="secondary">Salvar</SubmitButton>
                    </form>
                    <form action={setPixelToken}><input type="hidden" name="pixel_id" value={p.id} /><input type="hidden" name="mode" value="env" /><button className="text-xs text-sky-700 underline">usar META_CAPI_TOKEN do ambiente</button></form>
                    <form action={updatePixel} className="flex gap-1">
                      <input type="hidden" name="pixel_id" value={p.id} />
                      <input name="test_event_code" defaultValue={p.test_event_code ?? ""} placeholder="test_event_code (opcional)" className={`${inputCls} text-xs`} />
                      <SubmitButton variant="secondary">ok</SubmitButton>
                    </form>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {w && (
        <Card title="Cadastrar pixel" className="mt-6 max-w-xl">
          <form action={createPixel} className="flex flex-wrap items-end gap-3">
            <Field label="ID do pixel/dataset"><input name="external_pixel_id" required pattern="[0-9]{5,30}" className={inputCls} /></Field>
            <Field label="Nome"><input name="name" className={inputCls} placeholder="Pixel principal" /></Field>
            <SubmitButton>Cadastrar</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
