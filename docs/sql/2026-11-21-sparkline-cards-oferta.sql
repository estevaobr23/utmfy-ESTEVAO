-- Cards de oferta (Gerenciar ofertas): séries DIÁRIAS para o mini gráfico (sparkline) de cada card.
-- Só leitura, só o schema utmfy, `create or replace` (pode rodar de novo sem efeito colateral).
-- Não toca em nenhuma função usada pela CAPI, pelos webhooks ou pelos receptores.
-- Enquanto não for aplicada em produção, o painel funciona igual (sparkline atrás do interruptor OFFER_SPARKLINES).

-- Gasto por conjunto e DIA da conta, na moeda pedida (mesma regra de escopo e câmbio de report_spend_rows).
-- O recorte por oferta é feito no TypeScript com as MESMAS regras dos cartões (vínculos, pixel, contas exclusivas).
create or replace function utmfy.report_spend_daily_rows(
  p_workspace uuid, p_from date, p_to date, p_currency text default null
) returns table (
  account_id text, campaign_id text, campaign_name text, adset_id text, day date, spend numeric
) language sql stable security invoker set search_path = utmfy as $$
  with scope as (select * from utmfy.offer_spend_scope(p_workspace, null)),
  rows as (
    select distinct i.*, utmfy.fx_for(i.currency, i.date, p_currency, a.fx_rate) as fx
      from utmfy.meta_insights_daily i
      join scope s on s.account_id = i.account_id
       and (s.campaign_filter is null or i.campaign_name ilike '%' || s.campaign_filter || '%')
      left join utmfy.meta_ad_accounts a on a.workspace_id = i.workspace_id and a.account_id = i.account_id
     where i.workspace_id = p_workspace
       and i.date between p_from and p_to
  )
  select r.account_id, r.campaign_id, max(r.campaign_name), r.adset_id, r.date, round(coalesce(sum(r.spend * r.fx), 0), 2)
    from rows r
   where r.fx is not null
   group by r.account_id, r.campaign_id, r.adset_id, r.date
$$;

-- Vendas aprovadas por oferta e DIA (fuso do workspace), na moeda pedida (mesma regra de report_order_rows).
create or replace function utmfy.report_offer_orders_daily(
  p_workspace uuid, p_from date, p_to date, p_tz text, p_currency text default null
) returns table (
  offer_id uuid, day date, approved_count bigint, gross_revenue numeric, fees numeric,
  refunded_amount numeric, chargeback_amount numeric
) language sql stable security invoker set search_path = utmfy as $$
  with o as (
    select o.offer_id, o.offer_type, o.status, o.gross_amount, o.fees,
           (o.paid_at at time zone p_tz)::date as day,
           utmfy.fx_for(o.currency, (o.paid_at at time zone p_tz)::date, p_currency, null) as fx
      from utmfy.orders o
     where o.workspace_id = p_workspace
       and o.source <> 'test'
       and o.offer_id is not null
       and o.paid_at is not null
       and o.status in ('paid', 'refund_requested', 'disputed', 'refunded', 'chargedback')
       and (o.paid_at at time zone p_tz)::date between p_from and p_to
  )
  select offer_id, day,
         count(*) filter (where coalesce(offer_type, 'main') = 'main'),
         round(coalesce(sum(gross_amount * fx), 0), 2),
         round(coalesce(sum(fees * fx), 0), 2),
         round(coalesce(sum(gross_amount * fx) filter (where status = 'refunded'), 0), 2),
         round(coalesce(sum(gross_amount * fx) filter (where status = 'chargedback'), 0), 2)
    from o
   where fx is not null
   group by offer_id, day
$$;

grant execute on function utmfy.report_spend_daily_rows(uuid, date, date, text) to authenticated;
grant execute on function utmfy.report_offer_orders_daily(uuid, date, date, text, text) to authenticated;
