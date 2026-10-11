import { redirect } from "next/navigation";

export default async function LegacyConfigure({ params }: PageProps<"/ofertas/[id]/configurar">) {
  redirect(`/ofertas/${(await params).id}/integracoes`);
}
