# SETUP

## 1. Requisitos

Node 20+ (testado em 24), npm, Docker (para o Supabase local), Supabase CLI.

## 2. Ambiente local

```bash
npm install
supabase start          # sobe Postgres/Auth/Vault/Studio (Studio: http://127.0.0.1:54323)
supabase db reset       # recria o banco local e aplica supabase/migrations/*
```

Crie `.env.local` a partir de `.env.example`. Para o Supabase local use o `API_URL`, `ANON_KEY` e
`SERVICE_ROLE_KEY` impressos por `supabase start` (são chaves padrão de desenvolvimento, não secrets reais).

```bash
npm run admin:create -- --email voce@exemplo.com
# a senha gerada fica em admin-credentials.local.txt (gitignored) — guarde e apague o arquivo
npm run build && npm start      # http://localhost:3200
```

## 3. Produção (Supabase + Vercel)

### 3.1 Supabase

A organização Supabase atual já está no limite de **2 projetos gratuitos** (`cestavitrine`, `gatos-membros`).
Opções: pausar um projeto, fazer upgrade da org, ou criar outra organização. Depois:

```bash
supabase link --project-ref <REF_DO_PROJETO_NOVO>
supabase db push                 # aplica as 4 migrations
```

No painel: **Authentication → Sign In / Providers → desative “Allow new users to sign up”** (acesso só por
`npm run admin:create`). Em **Database → Extensions** habilite `pg_cron` e `pg_net` (agendamento) —
o Vault já vem habilitado.

### 3.2 Vercel

1. Importe o repositório (ou `vercel deploy`) — framework Next.js, sem configuração extra.
2. Variáveis de ambiente (Production): todas as de `.env.example`. `APP_URL` = URL pública final.
3. `CRON_SECRET`: gere com `openssl rand -hex 24`. A Vercel envia `Authorization: Bearer $CRON_SECRET`
   automaticamente nos crons de `vercel.json`.
4. Rode o admin apontando para produção:
   `NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run admin:create -- --email voce@...`

### 3.3 Agendamentos

| Rotina | Rota | Frequência sugerida |
| - | - | - |
| Meta (hoje + ontem + retroativo `META_LOOKBACK_DAYS`) | `/api/cron/meta-sync` | 15 min |
| Reconciliação Cakto (pedidos atualizados em 3 dias) | `/api/cron/cakto-reconcile` | 1 h |
| Fila CAPI (só com `CAPI_ENABLED=true`) | `/api/cron/capi-dispatch` | 5 min |

- `vercel.json` agenda `/api/cron/all` 1×/dia (limite do plano Hobby).
- Para 15 min: rode `supabase/sql/pg_cron_schedule.sql` no SQL Editor (usa `pg_net` + segredo no Vault).
- Os botões **ATUALIZAR DADOS DA META** e **SINCRONIZAR CAKTO** fazem o mesmo sob demanda.

## 4. Primeira configuração (no app)

Siga o onboarding de cada oferta (Ofertas → abrir oferta):

1. Criar oferta → 2. Associar produto/oferta Cakto → 3. Conectar Meta → 4. Selecionar conta de anúncio →
5. Pixel → 6. Copiar parâmetros de URL → 7. Copiar script do tracker → 8. Testar → 9. Dashboard ativo.

Contas de anúncio em moeda diferente do workspace (ex.: USD com vendas em BRL): defina o **câmbio manual**
em Contas Meta. Sem isso o gasto dessa conta fica fora do ROAS (e o Health Check acusa).
