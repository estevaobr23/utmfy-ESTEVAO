"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startRefresh } from "@/app/actions";

type Phase = "idle" | "starting" | "running";
type Status = { running: boolean; done: boolean; rateLimited: boolean; errors: string[] };

const POLL_MS = 700;
/** Se o acompanhamento não fechar (função morta, etc.), libera o botão mesmo assim. */
const GIVE_UP_MS = 150_000;

/**
 * "Atualizar" sem travar a tela: a ação responde na hora, o trabalho roda em segundo plano
 * e este botão só acompanha o andamento; ao terminar, recarrega os números.
 */
export function RefreshButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | null>(null);
  const tick = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    if (tick.current) window.clearInterval(tick.current);
    timer.current = tick.current = null;
  };
  useEffect(() => stop, []);

  const finish = (status: Status | null) => {
    stop();
    setPhase("idle");
    if (!status) setNote({ text: "Demorou mais que o esperado; os números podem estar parciais.", tone: "warn" });
    else if (status.rateLimited) setNote({ text: "A Meta limitou as consultas — os dados mostrados são os últimos salvos. Tente de novo em alguns minutos.", tone: "warn" });
    else if (status.errors.length) setNote({ text: status.errors[0], tone: "warn" });
    else setNote({ text: "Atualizado agora", tone: "ok" });
    router.refresh();
  };

  const follow = (since: string) => {
    const startedAt = Date.now();
    setPhase("running");
    setElapsed(0);
    tick.current = window.setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    timer.current = window.setInterval(async () => {
      if (Date.now() - startedAt > GIVE_UP_MS) return finish(null);
      try {
        const res = await fetch(`/api/sync-status?since=${encodeURIComponent(since)}`, { cache: "no-store" });
        if (!res.ok) return;
        const status = (await res.json()) as Status;
        if (status.done) finish(status);
      } catch {
        /* rede instável: tenta no próximo ciclo */
      }
    }, POLL_MS);
  };

  async function onClick() {
    if (phase !== "idle") return;
    setNote(null);
    setPhase("starting");
    try {
      const result = await startRefresh();
      if (result.state === "fresh") {
        setPhase("idle");
        setNote({ text: "Já estava atualizado (há instantes)", tone: "ok" });
        router.refresh();
        return;
      }
      follow(result.since);
    } catch (e) {
      setPhase("idle");
      setNote({ text: (e as Error).message || "Não foi possível iniciar a atualização.", tone: "warn" });
    }
  }

  const busy = phase !== "idle";
  return (
    <span className="inline-flex items-center gap-2">
      {note && <span className={`text-xs ${note.tone === "warn" ? "text-amber-300" : "text-[#7fe0b0]"}`} role="status">{note.text}</span>}
      <button type="button" onClick={onClick} disabled={busy} aria-busy={busy} className="inline-flex items-center rounded-md bg-[#0874f9] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0865d8] disabled:cursor-wait disabled:opacity-70">
        {busy ? `Atualizando… ${elapsed ? `${elapsed}s` : ""}` : "Atualizar"}
      </button>
    </span>
  );
}
