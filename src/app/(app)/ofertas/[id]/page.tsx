import { redirect } from "next/navigation";

export default async function OfferIndex({ params, searchParams }: PageProps<"/ofertas/[id]">) {
  const { id } = await params;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string" && k !== "offer") sp.set(k, v);
  const q = sp.toString();
  redirect(`/ofertas/${id}/resumo${q ? `?${q}` : ""}`);
}
