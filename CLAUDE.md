@AGENTS.md

## Contexto e convenções deste projeto

- **Pixel e webhook só por prompt (desde 13/10/2026):** ninguém cria à mão; o chat roda `node ~/.utmfy/utmfy.mjs oferta-nova --nome "X" --produto <ID_CAKTO>` (simulação primeiro, `--confirmar` só com o ok do usuário). Regras, limites e estado de validação: seção 2.1 do `INTEGRACAO-CHATS.md`.
- **Para qualquer chat que vá configurar oferta, pixel ou webhook:** leia `INTEGRACAO-CHATS.md` (onde tudo está, regras do modelo, passo a passo e diagnóstico) e use o helper `node ~/.utmfy/utmfy.mjs ajuda`. Skill global: `utmfy-tracker`.
- Banco de produção (Supabase `kjstjqxebejeihlzaiky`) é compartilhado com outro app: **só o schema `utmfy`**. Migrations em produção exigem aprovação explícita do usuário.
- Antes de commitar: `npm run typecheck && npm run lint && npm test`. Push em `main` = deploy na Vercel; confirme **Ready**.
