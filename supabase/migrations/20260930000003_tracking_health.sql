-- Sessões do tracker e consultas de saúde.

-- Upsert atômico de sessão do tracker (service_role). first_touch nunca é
-- sobrescrito; last_touch só muda quando a visita traz parâmetros novos.
create or replace function utmfy.track_session(p jsonb)
returns void language plpgsql security definer set search_path = utmfy as $$
declare
  v_lt jsonb := coalesce(p->'last_touch', '{}'::jsonb);
  v_has_lt boolean := v_lt <> '{}'::jsonb;
begin
  insert into utmfy.tracking_sessions as t (
    workspace_id, offer_id, session_id, landing_url, referrer_host, first_touch, last_touch,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, fbc, fbp,
    campaign_id, adset_id, ad_id, placement, user_agent, pageviews, checkout_clicks
  ) values (
    (p->>'workspace_id')::uuid, nullif(p->>'offer_id', '')::uuid, p->>'session_id', p->>'landing_url', p->>'referrer_host',
    coalesce(p->'first_touch', '{}'::jsonb), v_lt,
    v_lt->>'utm_source', v_lt->>'utm_medium', v_lt->>'utm_campaign', v_lt->>'utm_term', v_lt->>'utm_content',
    v_lt->>'fbclid', p->>'fbc', p->>'fbp', p->>'campaign_id', p->>'adset_id', p->>'ad_id', p->>'placement',
    left(p->>'user_agent', 400),
    case when p->>'event' = 'pageview' then 1 else 0 end,
    case when p->>'event' = 'checkout_click' then 1 else 0 end
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
    pageviews       = t.pageviews + excluded.pageviews,
    checkout_clicks = t.checkout_clicks + excluded.checkout_clicks;
end $$;
revoke all on function utmfy.track_session(jsonb) from public, anon, authenticated;

-- Painel de saúde por oferta (ou workspace inteiro com p_offer null).
create or replace function utmfy.integration_health(p_workspace uuid, p_offer uuid default null)
returns jsonb language sql stable security invoker set search_path = utmfy as $$
  select jsonb_build_object(
    'cakto', (select to_jsonb(c) - 'workspace_id' from utmfy.cakto_connections c where c.workspace_id = p_workspace limit 1),
    'last_webhook', (
      select jsonb_build_object('received_at', e.received_at, 'status', e.processing_status, 'event', e.event_name)
        from utmfy.webhook_events e
       where e.workspace_id = p_workspace
         and (p_offer is null or exists (select 1 from utmfy.orders o where o.workspace_id = p_workspace
                                          and o.external_order_id = e.external_order_id and o.offer_id = p_offer))
       order by e.received_at desc limit 1),
    'webhook_failures_24h', (select count(*) from utmfy.webhook_events e where e.workspace_id = p_workspace
                               and e.processing_status in ('failed', 'rejected') and e.received_at > now() - interval '24 hours'),
    'meta_connection', (select jsonb_build_object('status', m.status, 'last_sync_at', m.last_sync_at, 'last_error', m.last_error, 'token_hint', m.token_hint)
                          from utmfy.meta_connections m where m.workspace_id = p_workspace order by m.created_at limit 1),
    'meta_accounts', (
      select coalesce(jsonb_agg(jsonb_build_object('account_id', a.account_id, 'name', a.account_name, 'last_sync_at', a.last_sync_at,
                                                   'last_error', a.last_error, 'active', a.active)), '[]'::jsonb)
        from utmfy.meta_ad_accounts a
       where a.workspace_id = p_workspace
         and (case when p_offer is null then a.active
                   else exists (select 1 from utmfy.offer_ad_accounts oa where oa.ad_account_id = a.id and oa.offer_id = p_offer) end)),
    'last_insight_import', (select max(i.imported_at) from utmfy.meta_insights_daily i where i.workspace_id = p_workspace),
    'tracker', (select jsonb_build_object('sessions_24h', count(*), 'last_seen_at', max(t.last_seen_at),
                                          'with_utm_24h', count(*) filter (where t.utm_source is not null))
                  from utmfy.tracking_sessions t
                 where t.workspace_id = p_workspace and (p_offer is null or t.offer_id = p_offer)
                   and t.last_seen_at > now() - interval '24 hours'),
    'tracker_ever', (select count(*) from utmfy.tracking_sessions t where t.workspace_id = p_workspace and (p_offer is null or t.offer_id = p_offer)),
    'pixels', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where px.active),
                                         'server', count(*) filter (where px.server_tracking_enabled))
                 from utmfy.pixels px
                where px.workspace_id = p_workspace
                  and (p_offer is null or exists (select 1 from utmfy.offer_pixels op where op.pixel_id = px.id and op.offer_id = p_offer and op.active))),
    'orders_7d', (
      select jsonb_build_object(
        'paid', count(*) filter (where o.paid_at is not null),
        'without_ad_id', count(*) filter (where o.paid_at is not null and a.ad_id is null),
        'untracked', count(*) filter (where o.paid_at is not null and coalesce(a.attribution_status, 'UNKNOWN') in ('UNTRACKED', 'UNKNOWN')),
        'macro_unresolved', count(*) filter (where a.untracked_reason = 'macro_unresolved'),
        'unmapped_offer', count(*) filter (where o.offer_id is null),
        'last_order_at', max(o.created_at))
        from utmfy.orders o left join utmfy.order_attribution a on a.order_id = o.id
       where o.workspace_id = p_workspace and (p_offer is null or o.offer_id = p_offer)
         and o.created_at > now() - interval '7 days'),
    'dispatch_failures', (select count(*) from utmfy.conversion_dispatches d where d.workspace_id = p_workspace and d.status = 'failed'),
    'last_jobs', (select coalesce(jsonb_agg(j order by j.started_at desc), '[]'::jsonb) from (
                    select distinct on (kind) kind, status, started_at, finished_at, error, stats
                      from utmfy.sync_jobs where workspace_id = p_workspace order by kind, started_at desc) j)
  )
$$;
grant execute on function utmfy.integration_health(uuid, uuid) to authenticated;
