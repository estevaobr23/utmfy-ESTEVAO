import { Card, Code, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/core/dates";
import { listOffers } from "@/lib/queries";
import { requireWorkspace } from "@/lib/session";
import { DiagnosticTool } from "./tool";

export default async function DiagnosticPage() {
  const s = await requireWorkspace();
  const offers = await listOffers(s.sb, s.workspace.id);
  const { data: sessions } = await s.sb
    .from("tracking_sessions")
    .select("session_id, last_seen_at, landing_url, utm_source, utm_campaign, utm_content, ad_id, fbclid, fbc, fbp, pageviews, checkout_clicks, offers(name)")
    .eq("workspace_id", s.workspace.id)
    .order("last_seen_at", { ascending: false })
    .limit(15);
  return (
    <>
      <PageHeader title="Diagnóstico de tracking" subtitle="Cole uma URL de anúncio/landing e veja o que foi detectado, o que falta e o que o tracker enviaria à Cakto." />
      <Card><DiagnosticTool offers={offers} /></Card>
      <h2 className="mb-2 mt-6 text-sm font-semibold">Últimas sessões recebidas pelo tracker</h2>
      <Table>
        <thead><tr><Th>Visto</Th><Th>Oferta</Th><Th>Sessão (callback)</Th><Th>source / campanha / anúncio</Th><Th>ad_id</Th><Th>fbclid/fbc/fbp</Th><Th right>Views</Th><Th right>Cliques checkout</Th></tr></thead>
        <tbody>
          {(sessions ?? []).map((t) => (
            <tr key={t.session_id}>
              <Td className="whitespace-nowrap text-xs">{formatDateTime(t.last_seen_at, s.workspace.timezone)}</Td>
              <Td className="text-xs">{(t.offers as unknown as { name: string } | null)?.name ?? "—"}</Td>
              <Td><Code>{t.session_id}</Code></Td>
              <Td className="max-w-72 truncate text-xs">{[t.utm_source, t.utm_campaign, t.utm_content].filter(Boolean).join(" / ") || <span className="text-rose-600">sem UTM</span>}</Td>
              <Td className="font-mono text-xs">{t.ad_id ?? "—"}</Td>
              <Td className="text-xs">{t.fbclid ? "✓" : "—"} / {t.fbc ? "✓" : "—"} / {t.fbp ? "✓" : "—"}</Td>
              <Td right>{t.pageviews}</Td>
              <Td right>{t.checkout_clicks}</Td>
            </tr>
          ))}
          {!sessions?.length && <tr><Td className="text-slate-400">Nenhuma sessão ainda — instale o script (Ofertas → Configurar → Passo 7).</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
