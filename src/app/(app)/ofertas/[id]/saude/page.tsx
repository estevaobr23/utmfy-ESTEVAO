import { redirect } from "next/navigation";

export default async function LegacyHealth({ params }: PageProps<"/ofertas/[id]/saude">) {
  redirect(`/ofertas/${(await params).id}/tracking`);
}
