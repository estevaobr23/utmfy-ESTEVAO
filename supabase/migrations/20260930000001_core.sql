-- =============================================================================
-- UTMFY TRACKER — schema principal
-- Receita/vendas/status = Cakto. Gasto/estrutura de anúncios = Meta (read-only).
-- Tudo é escopado por workspace e protegido por RLS. Escritas de dados de
-- integração (pedidos, eventos, insights) só acontecem com service_role.
--
-- Roda num schema próprio ("utmfy") dentro de um projeto Supabase que já
-- hospeda outros sistemas (schema "public" da área de membros, schema
-- "mineracao"), para caber no limite de projetos ativos do plano free.
-- =============================================================================

create schema if not exists utmfy;
-- pgcrypto já está instalada (schema "extensions") neste projeto; gen_random_uuid() é global.

-- ---------------------------------------------------------------------------
-- Workspaces e membros
-- ---------------------------------------------------------------------------
create table utmfy.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  is_demo     boolean not null default false,
  timezone    text not null default 'America/Sao_Paulo',
  currency    text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table utmfy.workspace_members (
  workspace_id uuid not null references utmfy.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner', 'admin', 'viewer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on utmfy.workspace_members(user_id);

create or replace function utmfy.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = utmfy as $$
  select exists (select 1 from utmfy.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid())
$$;

create or replace function utmfy.can_write(ws uuid)
returns boolean language sql stable security definer set search_path = utmfy as $$
  select exists (
    select 1 from utmfy.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  )
$$;

create or replace function utmfy.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Ofertas e mapeamento Cakto (uma oferta interna pode ter N produtos/ofertas Cakto)
-- ---------------------------------------------------------------------------
create table utmfy.offers (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references utmfy.workspaces(id) on delete cascade,
  name          text not null check (length(name) between 1 and 120),
  slug          text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  status        text not null default 'active' check (status in ('active', 'paused', 'archived')),
  currency      text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  timezone      text not null default 'America/Sao_Paulo',
  checkout_url  text,
  landing_url   text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (workspace_id, id)
);
create trigger offers_touch before update on utmfy.offers for each row execute function utmfy.touch_updated_at();

create table utmfy.offer_cakto_items (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references utmfy.workspaces(id) on delete cascade,
  offer_id          uuid not null,
  cakto_product_id  text not null check (length(cakto_product_id) between 1 and 255),
  cakto_offer_id    text check (cakto_offer_id is null or length(cakto_offer_id) between 1 and 255),
  checkout_id       text,
  label             text,
  created_at        timestamptz not null default now(),
  foreign key (workspace_id, offer_id) references utmfy.offers(workspace_id, id) on delete cascade
);
-- Um mesmo produto/oferta Cakto só pode apontar para UMA oferta interna.
create unique index offer_cakto_items_unique
  on utmfy.offer_cakto_items(workspace_id, cakto_product_id, coalesce(cakto_offer_id, ''));
create index offer_cakto_items_offer_idx on utmfy.offer_cakto_items(offer_id);

-- ---------------------------------------------------------------------------
-- Conexões (NUNCA guardam secrets; tokens vivem em env vars ou no Supabase Vault)
-- ---------------------------------------------------------------------------
create table utmfy.cakto_connections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references utmfy.workspaces(id) on delete cascade,
  name             text not null default 'Cakto',
  status           text not null default 'pending' check (status in ('pending', 'active', 'error', 'disabled')),
  client_id_hint   text,
  webhook_ids      text[] not null default '{}',
  last_webhook_at  timestamptz,
  last_api_ok_at   timestamptz,
  last_sync_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id)
);
create trigger cakto_connections_touch before update on utmfy.cakto_connections for each row execute function utmfy.touch_updated_at();

create table utmfy.meta_connections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references utmfy.workspaces(id) on delete cascade,
  name             text not null default 'Meta',
  token_source     text not null default 'env' check (token_source in ('env', 'vault')),
  token_hint       text,
  meta_user_name   text,
  scopes           text[] not null default '{}',
  status           text not null default 'pending'
                   check (status in ('pending', 'active', 'token_expired', 'no_permission', 'error', 'disabled')),
  expires_at       timestamptz,
  last_sync_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger meta_connections_touch before update on utmfy.meta_connections for each row execute function utmfy.touch_updated_at();

create table utmfy.meta_ad_accounts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references utmfy.workspaces(id) on delete cascade,
  connection_id   uuid references utmfy.meta_connections(id) on delete set null,
  account_id      text not null check (account_id ~ '^[0-9]{1,30}$'), -- sem o prefixo act_
  account_name    text,
  currency        text,
  timezone        text,
  account_status  integer,
  active          boolean not null default false,  -- monitorada?
  last_sync_at    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, account_id),
  unique (workspace_id, id)
);
create trigger meta_ad_accounts_touch before update on utmfy.meta_ad_accounts for each row execute function utmfy.touch_updated_at();

-- Uma conta pode servir várias ofertas. campaign_filter (opcional) restringe
-- quais campanhas daquela conta contam gasto para a oferta (substring, sem
-- distinção de maiúsculas, no nome da campanha).
create table utmfy.offer_ad_accounts (
  workspace_id     uuid not null references utmfy.workspaces(id) on delete cascade,
  offer_id         uuid not null,
  ad_account_id    uuid not null,
  campaign_filter  text,
  created_at       timestamptz not null default now(),
  primary key (offer_id, ad_account_id),
  foreign key (workspace_id, offer_id) references utmfy.offers(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ad_account_id) references utmfy.meta_ad_accounts(workspace_id, id) on delete cascade
);

-- Catálogo de anúncios (campanha → conjunto → anúncio) importado da Meta.
create table utmfy.meta_ads (
  workspace_id   uuid not null references utmfy.workspaces(id) on delete cascade,
  account_id     text not null,
  campaign_id    text not null,
  campaign_name  text,
  adset_id       text not null,
  adset_name     text,
  ad_id          text not null,
  ad_name        text,
  effective_status text,
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (workspace_id, ad_id)
);
create index meta_ads_campaign_idx on utmfy.meta_ads(workspace_id, campaign_id);
create index meta_ads_adset_idx on utmfy.meta_ads(workspace_id, adset_id);

-- ---------------------------------------------------------------------------
-- Pixels (N:N com ofertas)
-- ---------------------------------------------------------------------------
create table utmfy.pixels (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references utmfy.workspaces(id) on delete cascade,
  provider                 text not null default 'meta' check (provider in ('meta')),
  external_pixel_id        text not null check (external_pixel_id ~ '^[0-9]{5,30}$'),
  name                     text not null,
  active                   boolean not null default true,
  server_tracking_enabled  boolean not null default false,
  token_source             text not null default 'none' check (token_source in ('none', 'env', 'vault')),
  token_hint               text,
  test_event_code          text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (workspace_id, provider, external_pixel_id),
  unique (workspace_id, id)
);
create trigger pixels_touch before update on utmfy.pixels for each row execute function utmfy.touch_updated_at();

create table utmfy.offer_pixels (
  workspace_id  uuid not null references utmfy.workspaces(id) on delete cascade,
  offer_id      uuid not null,
  pixel_id      uuid not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (offer_id, pixel_id),
  foreign key (workspace_id, offer_id) references utmfy.offers(workspace_id, id) on delete cascade,
  foreign key (workspace_id, pixel_id) references utmfy.pixels(workspace_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Pedidos (fonte da verdade financeira = Cakto)
-- ---------------------------------------------------------------------------
create table utmfy.orders (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references utmfy.workspaces(id) on delete cascade,
  offer_id              uuid references utmfy.offers(id) on delete set null,
  provider              text not null default 'cakto',
  external_order_id     text not null,
  ref_id                text,
  product_external_id   text,
  product_name          text,
  offer_external_id     text,
  offer_name            text,
  checkout_id           text,
  status                text not null check (status in
                          ('pending', 'refused', 'canceled', 'paid', 'refund_requested', 'disputed', 'refunded', 'chargedback')),
  raw_status            text,
  offer_type            text,
  parent_order          text,
  currency              text not null default 'BRL',
  base_amount           numeric(14, 2),
  gross_amount          numeric(14, 2),
  fees                  numeric(14, 2),
  discount              numeric(14, 2),
  net_amount            numeric(14, 2),
  payment_method        text,
  installments          integer,
  callback              text,
  customer_email_sha256 text,  -- só hash (CAPI); nunca o e-mail em claro
  customer_phone_sha256 text,
  provider_created_at   timestamptz,
  paid_at               timestamptz,
  refund_requested_at   timestamptz,
  refunded_at           timestamptz,
  chargedback_at        timestamptz,
  canceled_at           timestamptz,
  provider_updated_at   timestamptz,
  status_event_at       timestamptz,  -- timestamp do evento que definiu o status atual
  source                text not null default 'webhook' check (source in ('webhook', 'api_sync', 'reconcile', 'demo', 'test')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (workspace_id, provider, external_order_id)
);
create trigger orders_touch before update on utmfy.orders for each row execute function utmfy.touch_updated_at();
create index orders_ws_paid_idx on utmfy.orders(workspace_id, paid_at);
create index orders_ws_created_idx on utmfy.orders(workspace_id, provider_created_at);
create index orders_offer_paid_idx on utmfy.orders(offer_id, paid_at);
create index orders_ws_status_idx on utmfy.orders(workspace_id, status);
create index orders_ref_idx on utmfy.orders(workspace_id, ref_id);

create table utmfy.order_status_history (
  id            bigint generated always as identity primary key,
  workspace_id  uuid not null references utmfy.workspaces(id) on delete cascade,
  order_id      uuid not null references utmfy.orders(id) on delete cascade,
  from_status   text,
  to_status     text not null,
  raw_status    text,
  applied       boolean not null,
  reason        text,
  source        text not null,
  event_at      timestamptz,
  created_at    timestamptz not null default now()
);
create index order_status_history_order_idx on utmfy.order_status_history(order_id, created_at);

create table utmfy.order_attribution (
  order_id            uuid primary key references utmfy.orders(id) on delete cascade,
  workspace_id        uuid not null references utmfy.workspaces(id) on delete cascade,
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  utm_term            text,
  utm_content         text,
  sck                 text,
  fbc                 text,
  fbp                 text,
  session_id          text,
  account_id          text,
  campaign_id         text,
  campaign_name       text,
  adset_id            text,
  adset_name          text,
  ad_id               text,
  ad_name             text,
  placement           text,
  attribution_status  text not null default 'UNKNOWN' check (attribution_status in
                        ('EXACT_ID', 'UTM_PARSED', 'NAME_MATCH', 'ORGANIC', 'DIRECT', 'UNTRACKED', 'UNKNOWN')),
  attribution_method  text,
  untracked_reason    text,
  issues              jsonb not null default '[]',
  raw_parameters      jsonb not null default '{}',
  attributed_at       timestamptz not null default now()
);
create index order_attribution_ad_idx on utmfy.order_attribution(workspace_id, ad_id);
create index order_attribution_campaign_idx on utmfy.order_attribution(workspace_id, campaign_id);
create index order_attribution_status_idx on utmfy.order_attribution(workspace_id, attribution_status);

-- ---------------------------------------------------------------------------
-- Webhooks recebidos (auditoria + idempotência)
-- ---------------------------------------------------------------------------
create table utmfy.webhook_events (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid references utmfy.workspaces(id) on delete cascade,
  provider            text not null default 'cakto',
  event_name          text,
  external_order_id   text,
  dedupe_key          text not null,
  payload             jsonb not null,           -- já sem `secret` e com PII reduzida
  signature_verified  boolean not null default false,
  signature_method    text,                     -- header_hmac | body_secret | none
  delivery_timestamp  timestamptz,
  received_at         timestamptz not null default now(),
  processed_at        timestamptz,
  processing_status   text not null default 'received'
                      check (processing_status in ('received', 'processed', 'ignored', 'failed', 'rejected')),
  error_message       text,
  attempts            integer not null default 0,
  unique (provider, dedupe_key)
);
create index webhook_events_ws_received_idx on utmfy.webhook_events(workspace_id, received_at desc);
create index webhook_events_order_idx on utmfy.webhook_events(provider, external_order_id);

-- ---------------------------------------------------------------------------
-- Meta Insights (nível de anúncio, por dia na timezone da conta)
-- ---------------------------------------------------------------------------
create table utmfy.meta_insights_daily (
  workspace_id         uuid not null references utmfy.workspaces(id) on delete cascade,
  date                 date not null,
  account_id           text not null,
  campaign_id          text not null,
  campaign_name        text,
  adset_id             text not null,
  adset_name           text,
  ad_id                text not null,
  ad_name              text,
  impressions          bigint not null default 0,
  reach                bigint,
  clicks               bigint not null default 0,
  link_clicks          bigint,
  outbound_clicks      bigint,
  spend                numeric(14, 2) not null default 0,
  currency             text,
  meta_purchases       numeric(14, 2),  -- conversões REPORTADAS pela Meta (métrica separada)
  meta_purchase_value  numeric(14, 2),
  imported_at          timestamptz not null default now(),
  primary key (workspace_id, account_id, ad_id, date)
);
create index meta_insights_ws_date_idx on utmfy.meta_insights_daily(workspace_id, date);
create index meta_insights_campaign_idx on utmfy.meta_insights_daily(workspace_id, campaign_id, date);

-- ---------------------------------------------------------------------------
-- Tracker próprio (somente o necessário para atribuição)
-- ---------------------------------------------------------------------------
create table utmfy.tracking_sessions (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references utmfy.workspaces(id) on delete cascade,
  offer_id         uuid references utmfy.offers(id) on delete set null,
  session_id       text not null check (session_id ~ '^[A-Za-z0-9._~-]{8,64}$'),
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  landing_url      text,
  referrer_host    text,
  first_touch      jsonb not null default '{}',
  last_touch       jsonb not null default '{}',
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  utm_term         text,
  utm_content      text,
  fbclid           text,
  fbc              text,
  fbp              text,
  campaign_id      text,
  adset_id         text,
  ad_id            text,
  placement        text,
  user_agent       text,
  pageviews        integer not null default 0,
  checkout_clicks  integer not null default 0,
  unique (workspace_id, session_id)
);
create index tracking_sessions_ws_seen_idx on utmfy.tracking_sessions(workspace_id, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- CAPI (preparado): um dispatch por (pedido, pixel, evento)
-- ---------------------------------------------------------------------------
create table utmfy.conversion_dispatches (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references utmfy.workspaces(id) on delete cascade,
  order_id          uuid not null references utmfy.orders(id) on delete cascade,
  pixel_id          uuid not null references utmfy.pixels(id) on delete cascade,
  event_name        text not null,
  event_id          text not null,
  status            text not null default 'pending'
                    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts          integer not null default 0,
  last_http_status  integer,
  last_error        text,
  next_attempt_at   timestamptz not null default now(),
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (order_id, pixel_id, event_name),
  unique (pixel_id, event_id)
);
create trigger conversion_dispatches_touch before update on utmfy.conversion_dispatches for each row execute function utmfy.touch_updated_at();
create index conversion_dispatches_queue_idx on utmfy.conversion_dispatches(status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- Observabilidade
-- ---------------------------------------------------------------------------
create table utmfy.integration_logs (
  id            bigint generated always as identity primary key,
  workspace_id  uuid references utmfy.workspaces(id) on delete cascade,
  level         text not null check (level in ('info', 'warn', 'error')),
  code          text not null,          -- ex.: META_SYNC_FAILED, ATTRIBUTION_FAILED
  provider      text,
  message       text,
  context       jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index integration_logs_ws_idx on utmfy.integration_logs(workspace_id, created_at desc);
create index integration_logs_code_idx on utmfy.integration_logs(code, created_at desc);

create table utmfy.sync_jobs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references utmfy.workspaces(id) on delete cascade,
  kind          text not null check (kind in
                  ('cakto_sync', 'cakto_reconcile', 'meta_accounts', 'meta_catalog', 'meta_insights', 'capi_dispatch', 'reattribute', 'demo_seed')),
  status        text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  trigger       text not null default 'manual' check (trigger in ('manual', 'cron', 'system')),
  params        jsonb not null default '{}',
  stats         jsonb not null default '{}',
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index sync_jobs_ws_idx on utmfy.sync_jobs(workspace_id, started_at desc);

create table utmfy.reconciliation_changes (
  id                 bigint generated always as identity primary key,
  workspace_id       uuid not null references utmfy.workspaces(id) on delete cascade,
  sync_job_id        uuid references utmfy.sync_jobs(id) on delete set null,
  order_id           uuid references utmfy.orders(id) on delete set null,
  external_order_id  text not null,
  change_type        text not null check (change_type in
                       ('missing_order', 'status_changed', 'refund_applied', 'chargeback_applied', 'amount_changed')),
  before             jsonb,
  after              jsonb,
  created_at         timestamptz not null default now()
);
create index reconciliation_changes_ws_idx on utmfy.reconciliation_changes(workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Custos (estrutura para o futuro; ainda não entra em nenhuma fórmula por padrão)
-- ---------------------------------------------------------------------------
create table utmfy.cost_rules (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references utmfy.workspaces(id) on delete cascade,
  offer_id      uuid references utmfy.offers(id) on delete cascade,
  kind          text not null check (kind in
                  ('gateway_fee_pct', 'tax_pct', 'product_cost_per_sale', 'fixed_monthly', 'variable_pct_of_revenue')),
  label         text,
  value         numeric(14, 4) not null,
  active        boolean not null default true,
  starts_on     date,
  ends_on       date,
  created_at    timestamptz not null default now()
);

-- =============================================================================
-- RLS
-- =============================================================================
alter table utmfy.workspaces enable row level security;
alter table utmfy.workspace_members enable row level security;
alter table utmfy.offers enable row level security;
alter table utmfy.offer_cakto_items enable row level security;
alter table utmfy.cakto_connections enable row level security;
alter table utmfy.meta_connections enable row level security;
alter table utmfy.meta_ad_accounts enable row level security;
alter table utmfy.offer_ad_accounts enable row level security;
alter table utmfy.meta_ads enable row level security;
alter table utmfy.pixels enable row level security;
alter table utmfy.offer_pixels enable row level security;
alter table utmfy.orders enable row level security;
alter table utmfy.order_status_history enable row level security;
alter table utmfy.order_attribution enable row level security;
alter table utmfy.webhook_events enable row level security;
alter table utmfy.meta_insights_daily enable row level security;
alter table utmfy.tracking_sessions enable row level security;
alter table utmfy.conversion_dispatches enable row level security;
alter table utmfy.integration_logs enable row level security;
alter table utmfy.sync_jobs enable row level security;
alter table utmfy.reconciliation_changes enable row level security;
alter table utmfy.cost_rules enable row level security;

create policy ws_select on utmfy.workspaces for select to authenticated using (utmfy.is_member(id));
create policy ws_update on utmfy.workspaces for update to authenticated using (utmfy.can_write(id)) with check (utmfy.can_write(id));
create policy wm_select on utmfy.workspace_members for select to authenticated using (utmfy.is_member(workspace_id));

-- Tabelas de configuração: membros leem, owner/admin escrevem.
do $$
declare t text;
begin
  foreach t in array array['offers', 'offer_cakto_items', 'offer_ad_accounts', 'pixels', 'offer_pixels', 'cost_rules'] loop
    execute format('create policy %1$s_select on utmfy.%1$I for select to authenticated using (utmfy.is_member(workspace_id))', t);
    execute format('create policy %1$s_insert on utmfy.%1$I for insert to authenticated with check (utmfy.can_write(workspace_id))', t);
    execute format('create policy %1$s_update on utmfy.%1$I for update to authenticated using (utmfy.can_write(workspace_id)) with check (utmfy.can_write(workspace_id))', t);
    execute format('create policy %1$s_delete on utmfy.%1$I for delete to authenticated using (utmfy.can_write(workspace_id))', t);
  end loop;
  -- meta_ad_accounts: só "active" é editável pelo painel (o resto vem da sincronização).
  execute 'create policy meta_ad_accounts_select on utmfy.meta_ad_accounts for select to authenticated using (utmfy.is_member(workspace_id))';
  execute 'create policy meta_ad_accounts_update on utmfy.meta_ad_accounts for update to authenticated using (utmfy.can_write(workspace_id)) with check (utmfy.can_write(workspace_id))';
  -- Dados de integração: somente leitura para membros; escrita só via service_role.
  foreach t in array array['cakto_connections', 'meta_connections', 'meta_ads', 'orders', 'order_status_history',
                           'order_attribution', 'webhook_events', 'meta_insights_daily', 'tracking_sessions',
                           'conversion_dispatches', 'integration_logs', 'sync_jobs', 'reconciliation_changes'] loop
    execute format('create policy %1$s_select on utmfy.%1$I for select to authenticated using (utmfy.is_member(workspace_id))', t);
  end loop;
end $$;

-- Referências a secrets do Vault ficam numa tabela SEM policy: só service_role lê.
create table utmfy.secret_refs (
  workspace_id     uuid not null references utmfy.workspaces(id) on delete cascade,
  owner_type       text not null check (owner_type in ('meta_connection', 'pixel')),
  owner_id         uuid not null,
  vault_secret_id  uuid not null,
  created_at       timestamptz not null default now(),
  primary key (owner_type, owner_id)
);
alter table utmfy.secret_refs enable row level security;
revoke all on utmfy.secret_refs from anon, authenticated;

-- anon não lê nada diretamente (o tracker público escreve via route handler com service_role).
revoke all on all tables in schema utmfy from anon;
