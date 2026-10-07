import { Card, Code, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { META_MACROS, TEMPLATE_EXPLANATION } from "@/lib/core/utm-template";
import { requireWorkspace } from "@/lib/session";
import { TemplateTool } from "./template-tool";

export default async function UtmsPage() {
  await requireWorkspace();
  return (
    <>
      <PageHeader title="Configuração de tracking" subtitle="Template de parâmetros de URL para anúncios da Meta, no padrão NOME|ID que o motor de atribuição entende." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Gerador">
          <TemplateTool />
        </Card>
        <Card title="O que cada parâmetro faz">
          <Table>
            <thead><tr><Th>Parâmetro</Th><Th>Valor</Th><Th>Por quê</Th></tr></thead>
            <tbody>
              {TEMPLATE_EXPLANATION.map((t) => (
                <tr key={t.param}><Td><Code>{t.param}</Code></Td><Td className="font-mono text-xs">{t.value}</Td><Td className="text-xs">{t.why}</Td></tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 space-y-2">
            <Notice>
              <b>IDs mandam.</b> A atribuição usa o número depois do <Code>|</Code>. Renomear campanhas não quebra nada; trocar o template, sim.
            </Notice>
            <Notice tone="warn">
              Onde colar: no nível do <b>anúncio</b>, campo <b>Parâmetros de URL</b> (não na URL do site). Não inclua <Code>fbclid</Code>: a Meta adiciona sozinha.
              Depois de publicar, confira um clique real em <a className="underline" href="/diagnostico">Diagnóstico de tracking</a>.
            </Notice>
          </div>
        </Card>
      </div>
      <Card title="Macros dinâmicas suportadas pela Meta" className="mt-4">
        <ul className="grid gap-1 text-sm md:grid-cols-2">
          {META_MACROS.map((m) => (
            <li key={m.macro}><Code>{m.macro}</Code> — {m.desc}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Fonte: Central de Ajuda da Meta, “Parâmetros de URL dinâmicos”. Sintaxe com chaves duplas, minúsculas e ponto. Uma macro que aparece literal (ex.: <Code>{"{{campaign.name}}"}</Code>) na venda indica template errado ou anúncio de formato que não resolve a macro.
        </p>
      </Card>
    </>
  );
}
