-- Pedidos em outra moeda (ex.: USD) passam a ser CONVERTIDOS para a moeda do workspace (BRL),
-- com a mesma cotação diária (PTAX, utmfy.fx_for) que o gasto da Meta já usa, em vez de serem
-- descartados do relatório. A data da cotação é o dia do pagamento no fuso do workspace.
-- Sem cotação disponível para a moeda, o pedido segue fora da soma (como antes).
create or replace function utmfy.report_order_rows(
  p_workspace uuid, p_offer_ids uuid[], p_from date, p_to date, p_tz text, p_currency text default null,
  p_source text default null, p_campaign_id text default null, p_adset_id text default null,
  p_ad_id text default null, p_status text default null, p_account_id text default null
) returns table (
  campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  attribution_status text,
  approved_count bigint,
  approved_items bigint,
  gross_revenue numeric,
  fees numeric,
  refunded_count bigint, refunded_amount numeric,
  chargeback_count bigint, chargeback_amount numeric,
  refund_requested_count bigint,
  pix_generated bigint, pix_paid bigint
) language sql stable security invoker set search_path = utmfy as $$
  with o as (
    select o.*, a.campaign_id, a.campaign_name, a.adset_id, a.adset_name, a.ad_id, a.ad_name,
           coalesce(a.attribution_status, 'UNKNOWN') as attribution_status, a.utm_source, a.account_id,
           utmfy.fx_for(o.currency, (coalesce(o.paid_at, o.provider_created_at, o.created_at) at time zone p_tz)::date, p_currency, null) as fx,
           (o.paid_at is not null and o.status in ('paid', 'refund_requested', 'disputed', 'refunded', 'chargedback')
             and (o.paid_at at time zone p_tz)::date between p_from and p_to) as in_paid_window,
           (o.payment_method in ('pix', 'pix_auto')
             and (coalesce(o.provider_created_at, o.created_at) at time zone p_tz)::date between p_from and p_to) as in_pix_window
      from utmfy.orders o
      left join utmfy.order_attribution a on a.order_id = o.id
     where o.workspace_id = p_workspace
       and o.source <> 'test'
       and (p_offer_ids is null or o.offer_id = any(p_offer_ids))
       and (p_source is null or lower(a.utm_source) = lower(p_source))
       and (p_campaign_id is null or a.campaign_id = p_campaign_id)
       and (p_adset_id is null or a.adset_id = p_adset_id)
       and (p_ad_id is null or a.ad_id = p_ad_id)
       and (p_status is null or o.status = p_status)
       and (p_account_id is null or a.account_id = p_account_id)
  )
  select campaign_id, max(campaign_name), adset_id, max(adset_name), ad_id, max(ad_name), attribution_status,
         count(*) filter (where in_paid_window and coalesce(offer_type, 'main') = 'main'),
         count(*) filter (where in_paid_window),
         round(coalesce(sum(gross_amount * fx) filter (where in_paid_window), 0), 2),
         round(coalesce(sum(fees * fx) filter (where in_paid_window), 0), 2),
         count(*) filter (where in_paid_window and status = 'refunded'),
         round(coalesce(sum(gross_amount * fx) filter (where in_paid_window and status = 'refunded'), 0), 2),
         count(*) filter (where in_paid_window and status = 'chargedback'),
         round(coalesce(sum(gross_amount * fx) filter (where in_paid_window and status = 'chargedback'), 0), 2),
         count(*) filter (where in_paid_window and status = 'refund_requested'),
         count(*) filter (where in_pix_window),
         count(*) filter (where in_pix_window and paid_at is not null)
    from o
   where fx is not null and (in_paid_window or in_pix_window)
   group by campaign_id, adset_id, ad_id, attribution_status
$$;
