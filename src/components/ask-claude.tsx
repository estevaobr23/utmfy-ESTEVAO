"use client";
import { CopyButton } from "@/components/client";
import { claudeChatUrl } from "@/lib/claude-chat";

/**
 * "Pedir ao Claude": abre o Claude Code (VS Code deste computador) na conversa do projeto, com a mensagem pronta.
 * A mensagem não é enviada sozinha: você lê e dá Enter. "Copiar" serve para colar em outro chat/computador.
 */
export function AskClaude({
  prompt, label = "Pedir ao Claude", tone = "default", copy = true,
}: { prompt: string; label?: string; tone?: "default" | "problem"; copy?: boolean }) {
  const cls = tone === "problem"
    ? "bg-amber-400/10 text-amber-200 ring-1 ring-amber-400/35 hover:bg-amber-400/20"
    : "bg-[#0874f9]/15 text-[#8cc4ff] ring-1 ring-[#0874f9]/40 hover:bg-[#0874f9]/25";
  return (
    <span className="inline-flex items-center gap-1">
      <a
        href={claudeChatUrl(prompt)}
        title="Abre o Claude Code no VS Code, na conversa deste projeto, com a mensagem pronta. Você só lê e dá Enter."
        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium ${cls}`}
      >
        <span aria-hidden>✦</span> {label}
      </a>
      {copy && <CopyButton text={prompt} label="Copiar mensagem" />}
    </span>
  );
}
