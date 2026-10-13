import { describe, expect, it } from "vitest";
import { ask, CLAUDE_SESSION_ID, claudeChatUrl } from "@/lib/claude-chat";

const OFFER = { id: "7ef70967-4d47-44d0-8c83-783b38847a87", name: "100 gatos", slug: "100-gatos-marcenaria" };

describe("botão Pedir ao Claude (vscode://anthropic.claude-code/open)", () => {
  it("monta o link do handler da extensão com session e prompt", () => {
    const url = claudeChatUrl("olá, mundo");
    expect(url.startsWith("vscode://anthropic.claude-code/open?")).toBe(true);
    const q = new URL(url.replace("vscode://", "https://")).searchParams;
    expect(q.get("session")).toBe(CLAUDE_SESSION_ID);
    expect(q.get("prompt")).toBe("olá, mundo");
  });

  it("codifica espaço como %20 (o handler não entende '+') e preserva quebra de linha, acento e aspas", () => {
    const prompt = 'linha 1\nlinha 2 "aspas" ação & cia';
    const url = claudeChatUrl(prompt);
    expect(url).not.toContain("+");
    expect(url).toContain("%0A");
    const q = new URL(url.replace("vscode://", "https://")).searchParams;
    expect(q.get("prompt")).toBe(prompt);
  });

  it("session vazia: abre conversa nova (sem o parâmetro)", () => {
    expect(claudeChatUrl("x", "")).not.toContain("session=");
  });

  it("as mensagens padronizadas citam a oferta, a regra do projeto e não carregam segredo", () => {
    const todas = [
      ask.novaOferta(),
      ask.webhook(OFFER, "sem_webhook"),
      ask.webhook(OFFER, "sem_produtos"),
      ask.webhook(OFFER, "ok"),
      ask.pixelOferta(OFFER, false),
      ask.pixelOferta(OFFER, true),
      ask.pixelSolto("100 GATOS", "4126700287461816"),
      ask.pixelNovo(),
      ask.problema("Saúde", "Meta Ads", "token expirado", OFFER),
      ask.livre("Painel", OFFER),
    ];
    for (const m of todas) {
      expect(m).toContain("INTEGRACAO-CHATS.md");
      expect(m).not.toMatch(/EAA[A-Za-z0-9]{20,}/); // token da Meta
      expect(m).not.toMatch(/\?o=[a-f0-9]{32}/); // token do webhook
      expect(claudeChatUrl(m).length).toBeLessThan(4000); // folga para o handler/URL do sistema
    }
    expect(ask.webhook(OFFER, "sem_webhook")).toContain("100-gatos-marcenaria");
    expect(ask.webhook(OFFER, "sem_webhook")).toContain("webhook-criar");
  });
});
