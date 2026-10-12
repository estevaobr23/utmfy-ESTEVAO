-- Funil com os eventos do pixel que a Meta já devolve em `actions`:
-- visualização da página de destino (landing_page_view) e início de checkout
-- (initiate_checkout). É a mesma fonte da UTMify.
-- Não destrutiva e aditiva: duas colunas novas (NULL = ainda não coletado, ≠ 0)
-- e uma função nova. Nenhuma função, tabela ou dado existente é alterado.
-- Reversão: ver bloco "ROLLBACK" no fim do arquivo.

alter table utmfy.meta_insights_daily
  add column if not exists landing_page_views numeric,
  add column if not exists initiate_checkouts numeric;

-- Somas por anúncio no período. O escopo por oferta é aplicado pela aplicação
-- (mesmo critério do gasto); aqui só RLS de workspace, via security invoker.
create or replace function utmfy.report_pixel_rows(
  p_workspace uuid, p_from date, p_to date,
  p_account_id text default null, p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null
) returns table (
  account_id text, campaign_id text, adset_id text, ad_id text,
  landing_page_views numeric, initiate_checkouts numeric
) language sql stable security invoker set search_path = utmfy as $$
  select i.account_id, i.campaign_id, i.adset_id, i.ad_id,
         sum(i.landing_page_views), sum(i.initiate_checkouts)
    from utmfy.meta_insights_daily i
   where i.workspace_id = p_workspace
     and i.date between p_from and p_to
     and (p_account_id is null or i.account_id = p_account_id)
     and (p_campaign_id is null or i.campaign_id = p_campaign_id)
     and (p_adset_id is null or i.adset_id = p_adset_id)
     and (p_ad_id is null or i.ad_id = p_ad_id)
   group by i.account_id, i.campaign_id, i.adset_id, i.ad_id
$$;
grant execute on function utmfy.report_pixel_rows(uuid, date, date, text, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ROLLBACK (manual, se necessário):
-- drop function utmfy.report_pixel_rows(uuid, date, date, text, text, text, text);
-- alter table utmfy.meta_insights_daily drop column landing_page_views, drop column initiate_checkouts;
