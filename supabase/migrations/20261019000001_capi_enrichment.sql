-- CAPI completa (traqueamento avançado): o servidor passa a guardar o que a Meta usa para casar a compra com o clique.
--  * tracking_sessions: IP do cliente e localização (país/estado/cidade) vindos dos cabeçalhos da Vercel no beacon do t.js
--  * orders: hash do primeiro e do último nome (a Meta exige nome com hash; o nome em claro nunca é guardado)
--  * purge_tracking_pii(): apaga o IP após 30 dias e as sessões após 90 (LGPD / banco enxuto)
-- Só o schema utmfy. Idempotente.

alter table utmfy.tracking_sessions
  add column if not exists client_ip   text,
  add column if not exists geo_country text,
  add column if not exists geo_region  text,
  add column if not exists geo_city    text;

alter table utmfy.orders
  add column if not exists customer_fn_sha256 text,
  add column if not exists customer_ln_sha256 text;

create or replace function utmfy.track_session(p jsonb)
returns void language plpgsql security definer set search_path = utmfy as $$
declare
  v_lt jsonb := coalesce(p->'last_touch', '{}'::jsonb);
  v_has_lt boolean := v_lt <> '{}'::jsonb;
begin
  insert into utmfy.tracking_sessions as t (
    workspace_id, offer_id, session_id, landing_url, referrer_host, first_touch, last_touch,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, fbc, fbp,
    campaign_id, adset_id, ad_id, placement, user_agent, pageviews, checkout_clicks,
    client_ip, geo_country, geo_region, geo_city
  ) values (
    (p->>'workspace_id')::uuid, nullif(p->>'offer_id', '')::uuid, p->>'session_id', p->>'landing_url', p->>'referrer_host',
    coalesce(p->'first_touch', '{}'::jsonb), v_lt,
    v_lt->>'utm_source', v_lt->>'utm_medium', v_lt->>'utm_campaign', v_lt->>'utm_term', v_lt->>'utm_content',
    v_lt->>'fbclid', p->>'fbc', p->>'fbp', p->>'campaign_id', p->>'adset_id', p->>'ad_id', p->>'placement',
    left(p->>'user_agent', 400),
    case when p->>'event' = 'pageview' then 1 else 0 end,
    case when p->>'event' = 'checkout_click' then 1 else 0 end,
    left(p->>'client_ip', 64), left(p->>'geo_country', 8), left(p->>'geo_region', 64), left(p->>'geo_city', 128)
  )
  on conflict (workspace_id, session_id) do update set
    last_seen_at    = now(),
    offer_id        = coalesce(t.offer_id, excluded.offer_id),
    first_touch     = case when t.first_touch = '{}'::jsonb then excluded.first_touch else t.first_touch end,
    last_touch      = case when v_has_lt then excluded.last_touch else t.last_touch end,
    utm_source      = case when v_has_lt then excluded.utm_source else t.utm_source end,
    utm_medium      = case when v_has_lt then excluded.utm_medium else t.utm_medium end,
    utm_campaign    = case when v_has_lt then excluded.utm_campaign else t.utm_campaign end,
    utm_term        = case when v_has_lt then excluded.utm_term else t.utm_term end,
    utm_content     = case when v_has_lt then excluded.utm_content else t.utm_content end,
    fbclid          = coalesce(excluded.fbclid, t.fbclid),
    fbc             = coalesce(excluded.fbc, t.fbc),
    fbp             = coalesce(excluded.fbp, t.fbp),
    campaign_id     = case when v_has_lt then excluded.campaign_id else t.campaign_id end,
    adset_id        = case when v_has_lt then excluded.adset_id else t.adset_id end,
    ad_id           = case when v_has_lt then excluded.ad_id else t.ad_id end,
    placement       = case when v_has_lt then excluded.placement else t.placement end,
    user_agent      = coalesce(t.user_agent, excluded.user_agent),
    client_ip       = coalesce(excluded.client_ip, t.client_ip),   -- o IP mais recente (o do clique no checkout vence)
    geo_country     = coalesce(excluded.geo_country, t.geo_country),
    geo_region      = coalesce(excluded.geo_region, t.geo_region),
    geo_city        = coalesce(excluded.geo_city, t.geo_city),
    pageviews       = t.pageviews + excluded.pageviews,
    checkout_clicks = t.checkout_clicks + excluded.checkout_clicks;
end $$;
revoke all on function utmfy.track_session(jsonb) from public, anon, authenticated;

-- Retenção: IP some em 30 dias (a Meta só aceita evento de até 7 dias), sessão em 90.
create or replace function utmfy.purge_tracking_pii(p_ip_days integer default 30, p_session_days integer default 90)
returns jsonb language plpgsql security definer set search_path = utmfy as $$
declare
  v_ip integer;
  v_sessions integer;
begin
  update utmfy.tracking_sessions
     set client_ip = null, geo_city = null
   where last_seen_at < now() - make_interval(days => p_ip_days) and (client_ip is not null or geo_city is not null);
  get diagnostics v_ip = row_count;
  delete from utmfy.tracking_sessions where last_seen_at < now() - make_interval(days => p_session_days);
  get diagnostics v_sessions = row_count;
  return jsonb_build_object('ip_cleared', v_ip, 'sessions_deleted', v_sessions);
end $$;
revoke all on function utmfy.purge_tracking_pii(integer, integer) from public, anon, authenticated;
