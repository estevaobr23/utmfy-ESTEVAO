# Documentação da UTMFY

Tudo organizado por assunto. **Qualquer IA/chat (Claude, Codex) começa por `04-operacao-chats/INTEGRACAO-CHATS.md`.**
Na raiz do repositório ficam só `README.md`, `CLAUDE.md` e `AGENTS.md` (as duas últimas são lidas automaticamente pelos agentes — não mover).

| Pasta | Arquivo | O que tem |
|---|---|---|
| `01-comecar/` | `SETUP.md` | instalação, deploy, agendamentos |
| | `SETUP_REQUIRED.md` | checklist do que depende do usuário |
| | `TESTING.md` | o que é testado e como testar uma venda |
| `02-arquitetura/` | `ARCHITECTURE.md` | modelo de dados, máquina de estados, fórmulas |
| | `INTEGRATIONS.md` | Cakto, Meta (leitura), CAPI |
| `03-tracking/` | `TRACKING.md` | **guia do tracking**: UTMs, `t.js`, atribuição, diagnóstico e, na seção 5, a qualidade dos eventos na Meta (EMQ, IPv6, PageView) |
| | `PLANO-TRAQUEAMENTO-AVANCADO.md` | plano, medição e andamento do Traqueamento Avançado (CAPI) |
| | `PESQUISA-ORIGINAL-TRAQUEAMENTO-AVANCADO.md` | conversa de origem (GTM/Stape → solução própria); histórico, não é guia |
| `04-operacao-chats/` | `INTEGRACAO-CHATS.md` | criar oferta, pixel, webhook, CAPI pelo `utmfy.mjs`; regras e diagnóstico |
| `05-agentes/` | `PROMPT-CODEX-VISUAL.md` | prompt do agente visual (Codex) |

Cópia de segurança: o conteúdo de `03-tracking/TRACKING.md` seção 5 também está no Super Cérebro (nó `utmfy-tracking-qualidade-eventos-meta`).
