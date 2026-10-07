# UTMFY Tracker

Plataforma privada de tracking e atribuição de vendas:

```
ANÚNCIO (Meta) → CLIQUE → UTM → PÁGINA (tracker) → CHECKOUT (Cakto) → VENDA → ATRIBUIÇÃO → GASTO → ROAS
```

- **Receita, vendas e status = Cakto** (webhook em tempo real + API para sincronizar/reconciliar).
- **Gasto e estrutura de anúncios = Meta Ads** (integração **somente leitura**, Marketing API v26.0).
- **Atribuição = UTMs recebidas pela Cakto + sessão do nosso tracker** (`callback`). IDs mandam; nomes só descrevem.
- Multi-oferta, multi-conta, multi-pixel. Dashboard por oferta e consolidado.

Pendências que dependem de você: **[SETUP_REQUIRED.md](SETUP_REQUIRED.md)**.

## Rodar localmente

```bash
npm install
supabase start            # Postgres + Auth + Vault locais (Docker)
supabase db reset         # aplica supabase/migrations
cp .env.example .env.local   # preencha (a saída do `supabase start` tem URL/keys locais)
npm run admin:create -- --email voce@exemplo.com   # senha vai para admin-credentials.local.txt
npm run build && npm start   # http://localhost:3200
```

Sem credenciais reais: **Configurações → Criar dados DEMO** (workspace separado, faixa amarela).

## Comandos

| Comando | O que faz |
| - | - |
| `npm run dev` | dev server na porta 3200 |
| `npm test` | 114 testes (unitários + banco em PGlite + integração no Supabase local) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run admin:create -- --email x@y` | cria usuário owner + workspace `principal` |
| `npm run webhook:test -- --event purchase_approved --order XYZ --product <id>` | envia webhook Cakto **assinado** para o app |
| `node scripts/e2e-smoke.mjs` | E2E no navegador (Playwright) contra o app rodando |

## Telas

Login · Dashboard geral · Ofertas · Dashboard da oferta (com onboarding) · Campanhas (Campanha → Conjunto → Anúncio) ·
Pedidos · Não rastreadas (com motivo) · Pixels · Contas Meta · Integração Cakto · Configuração de UTMs ·
Diagnóstico de tracking · Eventos · Configurações · Health check (geral e por oferta).

## Documentação

- [SETUP.md](SETUP.md) — instalação, deploy e agendamentos
- [ARCHITECTURE.md](ARCHITECTURE.md) — modelo de dados, máquina de estados, fórmulas
- [TRACKING.md](TRACKING.md) — padrão de UTMs, tracker JS, atribuição, diagnóstico
- [INTEGRATIONS.md](INTEGRATIONS.md) — Cakto, Meta (read-only), CAPI
- [TESTING.md](TESTING.md) — o que é testado e como testar uma venda
- [SETUP_REQUIRED.md](SETUP_REQUIRED.md) — checklist do que depende de você
