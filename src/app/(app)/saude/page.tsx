import Link from "next/link";
import { AskClaude } from "@/components/ask-claude";
import { HealthList, loadHealth } from "@/components/health";
import { Card, PageHeader } from "@/components/ui";
import { ask } from "@/lib/claude-chat";
import { listOffers } from "@/lib/queries";
import { requireWorkspace } from "@/lib/session";

export default async function HealthPage() {
  const s = await requireWorkspace();
  const [{ items }, offers] = await Promise.all([loadHealth(s.sb, s.workspace.id), listOffers(s.sb, s.workspace.id)]);
  const perOffer = await Promise.all(offers.map(async (o) => ({ o, h: await loadHealth(s.sb, s.workspace.id, o.id) })));
  return (
    <>
      <PageHeader title="Health check" subtitle="Estado de cada integração. Use para achar rapidamente onde o tracking quebrou." />
      <HealthList items={items} />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {perOffer.map(({ o, h }) => {
          const worst = h.items.some((i) => i.level === "error") ? "✕" : h.items.some((i) => i.level === "warn") ? "⚠" : "✓";
          return (
            <Card
              key={o.id}
              title={<Link href={`/ofertas/${o.id}/saude`} className="hover:underline">{worst} {o.name}</Link>}
              actions={worst !== "✓" ? <AskClaude tone="problem" label="Resolver com o Claude" copy={false} prompt={ask.problema("Saúde das integrações", `${o.name}: ${h.items.filter((i) => i.level !== "ok").map((i) => i.name).join(", ")}`, h.items.filter((i) => i.level !== "ok").map((i) => `${i.name}: ${i.detail}`).join(" | "), { id: o.id, name: o.name, slug: o.slug })} /> : undefined}
            >
              <ul className="space-y-1 text-sm">
                {h.items.filter((i) => i.level !== "ok").map((i) => <li key={i.name}><b>{i.name}:</b> {i.detail}</li>)}
                {h.items.every((i) => i.level === "ok") && <li className="text-emerald-700">Tudo OK</li>}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}
