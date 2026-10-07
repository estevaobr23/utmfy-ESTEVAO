-- Câmbio EXPLÍCITO por conta de anúncio (ex.: conta em USD, vendas em BRL).
-- Nada é convertido automaticamente: sem fx_rate, o gasto de conta em outra
-- moeda fica FORA dos relatórios (e o Health Check avisa).

alter table public.meta_ad_accounts
  add column fx_rate numeric(12, 6) check (fx_rate is null or fx_rate > 0),
  add column fx_note text;

comment on column public.meta_ad_accounts.fx_rate is
  'Multiplicador manual moeda-da-conta → moeda-do-workspace (ex.: 5.60 para USD→BRL, já com IOF se desejar).';

create or replace function public.report_spend_rows(
  p_workspace uuid, p_offer_ids uuid[], p_from date, p_to date, p_currency text default null,
  p_account_id text default null, p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null
) returns table (
  account_id text, campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  currency text, impressions bigint, reach bigint, clicks bigint, link_clicks bigint, outbound_clicks bigint,
  spend numeric, meta_purchases numeric, meta_purchase_value numeric
) language sql stable security invoker set search_path = public as $$
  with scope as (select * from public.offer_spend_scope(p_workspace, p_offer_ids)),
  rows as (
    select distinct i.*,
           case
             when p_currency is null or i.currency is null or i.currency = p_currency then 1::numeric
             else a.fx_rate
           end as fx
      from public.meta_insights_daily i
      join scope s on s.account_id = i.account_id
       and (s.campaign_filter is null or i.campaign_name ilike '%' || s.campaign_filter || '%')
      left join public.meta_ad_accounts a on a.workspace_id = i.workspace_id and a.account_id = i.account_id
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
   where r.fx is not null  -- moeda diferente sem câmbio configurado: excluído
   group by r.account_id, r.campaign_id, r.adset_id, r.ad_id
$$;

-- Gasto que ficou de fora por falta de câmbio (para alertas).
create or replace function public.report_spend_excluded(p_workspace uuid, p_from date, p_to date, p_currency text)
returns table (account_id text, currency text, spend numeric)
language sql stable security invoker set search_path = public as $$
  select i.account_id, i.currency, round(sum(i.spend), 2)
    from public.meta_insights_daily i
    join public.meta_ad_accounts a on a.workspace_id = i.workspace_id and a.account_id = i.account_id
   where i.workspace_id = p_workspace and i.date between p_from and p_to
     and i.currency is not null and i.currency <> p_currency and a.fx_rate is null
   group by i.account_id, i.currency
$$;
grant execute on function public.report_spend_excluded(uuid, date, date, text) to authenticated;
