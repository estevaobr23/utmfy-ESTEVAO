# UTMFY Tracker

Plataforma privada de tracking e atribuição de vendas:

```
ANÚNCIO (Meta) → CLIQUE → UTM → PÁGINA (tracker) → CHECKOUT (Cakto) → VENDA → ATRIBUIÇÃO → GASTO → ROAS
```

- **Receita, vendas e status = Cakto** (webhook em tempo real + API para sincronizar/reconciliar).
- **Gasto e estrutura de anúncios = Meta Ads** (Marketing API v26.0; leitura, **exceto o orçamento diário**, que o lápis da tabela edita na Meta).
- **Atribuição = UTMs recebidas pela Cakto + sessão do nosso tracker** (`callback`). IDs mandam; nomes só descrevem.
- Multi-oferta, multi-conta, multi-pixel. Dashboard por oferta e consolidado.

Pendências que dependem de você: **[docs/01-comecar/SETUP_REQUIRED.md](docs/01-comecar/SETUP_REQUIRED.md)**.

**Configurar oferta / pixel / webhook (qualquer chat):** **[docs/04-operacao-chats/INTEGRACAO-CHATS.md](docs/04-operacao-chats/INTEGRACAO-CHATS.md)** · helper `node ~/.utmfy/utmfy.mjs ajuda`.

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

Tudo está em [docs/](docs/README.md), por assunto (índice completo lá):

- **01-comecar** — [SETUP](docs/01-comecar/SETUP.md) (instalação, deploy, agendamentos) · [SETUP_REQUIRED](docs/01-comecar/SETUP_REQUIRED.md) (o que depende de você) · [TESTING](docs/01-comecar/TESTING.md)
- **02-arquitetura** — [ARCHITECTURE](docs/02-arquitetura/ARCHITECTURE.md) (modelo de dados, estados, fórmulas) · [INTEGRATIONS](docs/02-arquitetura/INTEGRATIONS.md) (Cakto, Meta, CAPI)
- **03-tracking** — [TRACKING](docs/03-tracking/TRACKING.md) (**guia do tracking**: UTMs, tracker, atribuição, qualidade dos eventos na Meta) · [PLANO-TRAQUEAMENTO-AVANCADO](docs/03-tracking/PLANO-TRAQUEAMENTO-AVANCADO.md)
- **04-operacao-chats** — [INTEGRACAO-CHATS](docs/04-operacao-chats/INTEGRACAO-CHATS.md) (oferta, pixel, webhook, CAPI: o guia que qualquer chat/IA lê primeiro)
- **05-agentes** — [PROMPT-CODEX-VISUAL](docs/05-agentes/PROMPT-CODEX-VISUAL.md)
