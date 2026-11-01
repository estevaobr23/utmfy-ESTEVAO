-- Gasto da Meta por HORA (nível conjunto de anúncios), para os gráficos "Lucro por horário" e
-- "Faturamento × Investimento × Lucro por hora" do Resumo.
-- date/hour já estão no fuso do WORKSPACE (o sync converte do fuso da conta de anúncio).
-- Só cria objetos novos no schema utmfy; nada existente é alterado.

create table if not exists utmfy.meta_insights_hourly (
  workspace_id  uuid not null references utmfy.workspaces(id) on delete cascade,
  date          date not null,
  hour          smallint not null check (hour between 0 and 23),
  account_id    text not null,
  campaign_id   text not null,
  campaign_name text,
  adset_id      text not null,
  impressions   bigint not null default 0,
  clicks        bigint not null default 0,
  spend         numeric(14, 2) not null default 0,
  currency      text,
  imported_at   timestamptz not null default now(),
  primary key (workspace_id, account_id, adset_id, date, hour)
);
create index if not exists meta_insights_hourly_ws_date_idx on utmfy.meta_insights_hourly(workspace_id, date);

alter table utmfy.meta_insights_hourly enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'utmfy' and tablename = 'meta_insights_hourly' and policyname = 'meta_insights_hourly_select') then
    create policy meta_insights_hourly_select on utmfy.meta_insights_hourly for select to authenticated using (utmfy.is_member(workspace_id));
  end if;
end $$;
grant select on utmfy.meta_insights_hourly to authenticated;
grant select, insert, update, delete on utmfy.meta_insights_hourly to service_role;
revoke all on utmfy.meta_insights_hourly from anon;

-- Gasto por conjunto e hora do dia no período, já na moeda pedida (mesma regra de câmbio de report_spend_rows).
create or replace function utmfy.report_hourly_spend(
  p_workspace uuid, p_from date, p_to date, p_currency text default null,
  p_account_id text default null, p_campaign_id text default null, p_adset_id text default null
) returns table (
  account_id text, campaign_id text, campaign_name text, adset_id text, hour smallint, currency text, spend numeric
) language sql stable security invoker set search_path = utmfy as $$
  with rows as (
    select h.*, utmfy.fx_for(h.currency, h.date, p_currency, a.fx_rate) as fx
      from utmfy.meta_insights_hourly h
      left join utmfy.meta_ad_accounts a on a.workspace_id = h.workspace_id and a.account_id = h.account_id
     where h.workspace_id = p_workspace
       and h.date between p_from and p_to
       and (p_account_id is null or h.account_id = p_account_id)
       and (p_campaign_id is null or h.campaign_id = p_campaign_id)
       and (p_adset_id is null or h.adset_id = p_adset_id)
  )
  select r.account_id, r.campaign_id, max(r.campaign_name), r.adset_id, r.hour,
         coalesce(p_currency, max(r.currency)), round(coalesce(sum(r.spend * r.fx), 0), 2)
    from rows r
   where r.fx is not null
   group by r.account_id, r.campaign_id, r.adset_id, r.hour
$$;
grant execute on function utmfy.report_hourly_spend(uuid, date, date, text, text, text, text) to authenticated, service_role;
