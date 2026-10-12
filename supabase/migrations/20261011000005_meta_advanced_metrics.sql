-- Métricas avançadas da Meta (somente leitura): orçamento, estratégia de lance,
-- métricas de vídeo por anúncio/dia e alcance deduplicado por período.
-- Não destrutiva: só cria tabelas/colunas novas e uma função de relatório.
-- Reversão: ver bloco "ROLLBACK" no fim do arquivo.

-- 1) Configuração de campanha (1 linha por campanha; valores em unidade MENOR da moeda da conta)
create table if not exists utmfy.meta_campaigns (
  workspace_id          uuid not null references utmfy.workspaces(id) on delete cascade,
  account_id            text not null,
  campaign_id           text not null,
  name                  text,
  effective_status      text,
  daily_budget_minor    bigint,
  lifetime_budget_minor bigint,
  bid_strategy          text,
  currency              text,
  meta_updated_time     timestamptz,
  synced_at             timestamptz not null default now(),
  primary key (workspace_id, campaign_id)
);
create index if not exists meta_campaigns_account_idx on utmfy.meta_campaigns(workspace_id, account_id);

-- 2) Configuração de conjunto
create table if not exists utmfy.meta_adsets (
  workspace_id          uuid not null references utmfy.workspaces(id) on delete cascade,
  account_id            text not null,
  campaign_id           text not null,
  adset_id              text not null,
  name                  text,
  effective_status      text,
  daily_budget_minor    bigint,
  lifetime_budget_minor bigint,
  bid_strategy          text,
  bid_amount_minor      bigint,
  bid_constraints       jsonb,
  optimization_goal     text,
  billing_event         text,
  promoted_object       jsonb,
  currency              text,
  meta_updated_time     timestamptz,
  synced_at             timestamptz not null default now(),
  primary key (workspace_id, adset_id)
);
create index if not exists meta_adsets_campaign_idx on utmfy.meta_adsets(workspace_id, campaign_id);

-- 3) Tipo de criativo no catálogo (anúncio de imagem devolve contagens de vídeo espúrias)
alter table utmfy.meta_ads add column if not exists creative_type text;
alter table utmfy.meta_ads add column if not exists has_video boolean;

-- 4) Métricas de vídeo por anúncio/dia (fuso da conta), separadas do gasto
create table if not exists utmfy.meta_video_daily (
  workspace_id        uuid not null references utmfy.workspaces(id) on delete cascade,
  date                date not null,
  account_id          text not null,
  campaign_id         text not null,
  adset_id            text not null,
  ad_id               text not null,
  impressions         bigint not null default 0,
  video_plays         bigint,  -- video_play_actions (inclui início por autoplay)
  plays_2s_continuous bigint,  -- video_continuous_2_sec_watched_actions
  plays_3s            bigint,  -- actions[video_view] = reproduções de 3 segundos
  plays_6s            bigint,
  plays_15s           bigint,
  thruplays           bigint,
  p25                 bigint,
  p50                 bigint,
  p75                 bigint,
  p95                 bigint,
  p100                bigint,
  avg_watch_seconds   numeric(10, 2),
  imported_at         timestamptz not null default now(),
  primary key (workspace_id, account_id, ad_id, date)
);
create index if not exists meta_video_ws_date_idx on utmfy.meta_video_daily(workspace_id, date);

-- 5) Alcance deduplicado por período e nível (alcance NÃO é somável entre dias/anúncios)
create table if not exists utmfy.meta_reach_period (
  workspace_id  uuid not null references utmfy.workspaces(id) on delete cascade,
  account_id    text not null,
  level         text not null check (level in ('account', 'campaign', 'adset', 'ad')),
  object_id     text not null,
  since         date not null,
  until         date not null,
  impressions   bigint not null default 0,
  reach         bigint,
  frequency     numeric(12, 6),
  fetched_at    timestamptz not null default now(),
  primary key (workspace_id, level, object_id, since, until)
);
create index if not exists meta_reach_period_range_idx on utmfy.meta_reach_period(workspace_id, since, until);

-- RLS: membros leem; escrita só via service_role (mesmo padrão de meta_ads)
alter table utmfy.meta_campaigns enable row level security;
alter table utmfy.meta_adsets enable row level security;
alter table utmfy.meta_video_daily enable row level security;
alter table utmfy.meta_reach_period enable row level security;

do $$
declare t text;
begin
  foreach t in array array['meta_campaigns', 'meta_adsets', 'meta_video_daily', 'meta_reach_period'] loop
    if not exists (select 1 from pg_policies where schemaname = 'utmfy' and tablename = t and policyname = t || '_select') then
      execute format('create policy %1$s_select on utmfy.%1$I for select to authenticated using (utmfy.is_member(workspace_id))', t);
    end if;
    execute format('grant select on utmfy.%I to authenticated', t);
    execute format('grant select, insert, update, delete on utmfy.%I to service_role', t);
    execute format('revoke all on utmfy.%I from anon', t);
  end loop;
end $$;

-- Somas de vídeo por anúncio no período, já com o tipo de criativo do catálogo.
create or replace function utmfy.report_video_rows(
  p_workspace uuid, p_from date, p_to date, p_account_id text default null
) returns table (
  account_id text, campaign_id text, adset_id text, ad_id text, has_video boolean,
  impressions bigint, video_plays bigint, plays_2s_continuous bigint, plays_3s bigint, plays_6s bigint,
  plays_15s bigint, thruplays bigint, p25 bigint, p50 bigint, p75 bigint, p95 bigint, p100 bigint,
  watch_seconds numeric
) language sql stable security invoker set search_path = utmfy as $$
  select v.account_id, v.campaign_id, v.adset_id, v.ad_id, max(a.has_video::int)::boolean,
         sum(v.impressions)::bigint, sum(v.video_plays)::bigint, sum(v.plays_2s_continuous)::bigint,
         sum(v.plays_3s)::bigint, sum(v.plays_6s)::bigint, sum(v.plays_15s)::bigint, sum(v.thruplays)::bigint,
         sum(v.p25)::bigint, sum(v.p50)::bigint, sum(v.p75)::bigint, sum(v.p95)::bigint, sum(v.p100)::bigint,
         sum(v.avg_watch_seconds * v.video_plays)
    from utmfy.meta_video_daily v
    left join utmfy.meta_ads a on a.workspace_id = v.workspace_id and a.ad_id = v.ad_id
   where v.workspace_id = p_workspace
     and v.date between p_from and p_to
     and (p_account_id is null or v.account_id = p_account_id)
   group by v.account_id, v.campaign_id, v.adset_id, v.ad_id
$$;
revoke all on function utmfy.report_video_rows(uuid, date, date, text) from anon, public;
grant execute on function utmfy.report_video_rows(uuid, date, date, text) to authenticated, service_role;

-- ROLLBACK (manual, só se necessário — não apaga nada de gasto/vendas):
--   drop function if exists utmfy.report_video_rows(uuid, date, date, text);
--   drop table if exists utmfy.meta_reach_period;
--   drop table if exists utmfy.meta_video_daily;
--   drop table if exists utmfy.meta_adsets;
--   drop table if exists utmfy.meta_campaigns;
--   alter table utmfy.meta_ads drop column if exists has_video, drop column if exists creative_type;
