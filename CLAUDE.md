@AGENTS.md

## Contexto e convenções deste projeto

- **Para qualquer chat que vá configurar oferta, pixel ou webhook:** leia `INTEGRACAO-CHATS.md` (onde tudo está, regras do modelo, passo a passo e diagnóstico) e use o helper `node ~/.utmfy/utmfy.mjs ajuda`. Skill global: `utmfy-tracker`.
- Banco de produção (Supabase `kjstjqxebejeihlzaiky`) é compartilhado com outro app: **só o schema `utmfy`**. Migrations em produção exigem aprovação explícita do usuário.
- Antes de commitar: `npm run typecheck && npm run lint && npm test`. Push em `main` = deploy na Vercel; confirme **Ready**.
