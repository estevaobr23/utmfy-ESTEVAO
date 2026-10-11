-- 1) Webhook por oferta (modelo UTMify): cada oferta tem uma URL própria e,
--    na Cakto, o usuário escolhe quais produtos mandam eventos para ela. A
--    URL carrega um token aleatório; os produtos escolhidos na Cakto viram
--    offer_cakto_items com source = 'cakto_webhook'.
alter table utmfy.offers
  add column webhook_token text not null default replace(gen_random_uuid()::text, '-', ''),
  add column cakto_webhook_id text,
  add column cakto_webhook_checked_at timestamptz;
create unique index offers_webhook_token_idx on utmfy.offers(webhook_token);

alter table utmfy.offer_cakto_items
  add column source text not null default 'manual' check (source in ('manual', 'cakto_webhook')),
  add column product_name text;

-- O secret de cada webhook Cakto fica no Vault (nunca em tabela).
alter table utmfy.secret_refs drop constraint secret_refs_owner_type_check;
alter table utmfy.secret_refs add constraint secret_refs_owner_type_check
  check (owner_type in ('meta_connection', 'pixel', 'cakto_webhook'));

-- 2) Câmbio diário (PTAX de fechamento do Banco Central, venda): quantos
--    reais vale 1 unidade da moeda naquele dia útil.
create table utmfy.fx_rates (
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  date        date not null,
  rate        numeric(12, 6) not null check (rate > 0),
  source      text not null default 'bcb_ptax',
  fetched_at  timestamptz not null default now(),
  primary key (currency, date)
);
alter table utmfy.fx_rates enable row level security;
create policy fx_rates_select on utmfy.fx_rates for select to authenticated using (true);
create policy mcp_all on utmfy.fx_rates for all to utmfy_mcp using (true) with check (true);
grant select on utmfy.fx_rates to authenticated;
revoke all on utmfy.fx_rates from anon;

-- Cotação válida num dia: a do próprio dia ou do último dia útil anterior
-- (até 7 dias). Fallback: câmbio manual da conta. Só converte para BRL.
create or replace function utmfy.fx_for(p_currency text, p_date date, p_target text, p_manual numeric)
returns numeric language sql stable security invoker set search_path = utmfy as $$
  select case
    when p_target is null or p_currency is null or p_currency = p_target then 1::numeric
    when p_target = 'BRL' then coalesce(
      (select r.rate from utmfy.fx_rates r
        where r.currency = p_currency and r.date <= p_date and r.date >= p_date - 7
        order by r.date desc limit 1),
      p_manual)
    else p_manual
  end
$$;
grant execute on function utmfy.fx_for(text, date, text, numeric) to authenticated, service_role;

create or replace function utmfy.report_spend_rows(
  p_workspace uuid, p_offer_ids uuid[], p_from date, p_to date, p_currency text default null,
  p_account_id text default null, p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null
) returns table (
  account_id text, campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  currency text, impressions bigint, reach bigint, clicks bigint, link_clicks bigint, outbound_clicks bigint,
  spend numeric, meta_purchases numeric, meta_purchase_value numeric
) language sql stable security invoker set search_path = utmfy as $$
  with scope as (select * from utmfy.offer_spend_scope(p_workspace, p_offer_ids)),
  rows as (
    select distinct i.*, utmfy.fx_for(i.currency, i.date, p_currency, a.fx_rate) as fx
      from utmfy.meta_insights_daily i
      join scope s on s.account_id = i.account_id
       and (s.campaign_filter is null or i.campaign_name ilike '%' || s.campaign_filter || '%')
      left join utmfy.meta_ad_accounts a on a.workspace_id = i.workspace_id and a.account_id = i.account_id
     where i.workspace_id = p_workspace
       and i.date between p_from and p_to
       and (p_account_id is null or i.account_id = p_account_id)
       and (p_campaign_id is null or i.campaign_id = p_campaign_id)
       and (p_adset_id is null or i.adset_id = p_adset_id)
       and (p_ad_id is null or i.ad_id = p_ad_id)
  )
  select r.account_id, r.campaign_id, max(r.campaign_name), r.adset_id, max(r.adset_name), r.ad_id, max(r.ad_name),
         coalesce(p_currency, max(r.currency)), sum(r.impressions)::bigint, sum(r.reach)::bigint, sum(r.clicks)::bigint,
         sum(r.link_clicks)::bigint, sum(r.outbound_clicks)::bigint, round(coalesce(sum(r.spend * r.fx), 0), 2),
         sum(r.meta_purchases), round(sum(r.meta_purchase_value * r.fx), 2)
    from rows r
   where r.fx is not null
   group by r.account_id, r.campaign_id, r.adset_id, r.ad_id
$$;

create or replace function utmfy.report_spend_excluded(p_workspace uuid, p_from date, p_to date, p_currency text)
returns table (account_id text, currency text, spend numeric)
language sql stable security invoker set search_path = utmfy as $$
  select i.account_id, i.currency, round(sum(i.spend), 2)
    from utmfy.meta_insights_daily i
    join utmfy.meta_ad_accounts a on a.workspace_id = i.workspace_id and a.account_id = i.account_id
   where i.workspace_id = p_workspace and i.date between p_from and p_to
     and utmfy.fx_for(i.currency, i.date, p_currency, a.fx_rate) is null
   group by i.account_id, i.currency
$$;
