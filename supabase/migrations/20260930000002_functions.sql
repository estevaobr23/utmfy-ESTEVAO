-- =============================================================================
-- Funções de domínio: máquina de estados do pedido, relatórios e helpers.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Máquina de estados do pedido
--
-- Os status normalizados são agrupados em "tiers":
--   tier 0 (pré-pagamento): pending, refused, canceled
--   tier 1 (pago/vivo):     paid, refund_requested, disputed
--   tier 2 (final):         refunded, chargedback
--
-- Regras:
--   * tier novo > tier atual   → aplica (ex.: pending → paid, paid → refunded)
--   * tier novo < tier atual   → REJEITA (evento atrasado; nunca paid → pending,
--                                 nunca refunded → paid)
--   * mesmo tier (0 ou 1)      → aplica somente se o evento não for mais antigo
--                                 que o que definiu o status atual (ex.: cartão
--                                 recusado → Pix gerado; refund_requested → paid
--                                 quando o comprador desiste do reembolso)
--   * tier 2                   → refunded → chargedback é permitido; o inverso não
-- ---------------------------------------------------------------------------
create or replace function utmfy.order_status_tier(s text)
returns integer language sql immutable as $$
  select case s
    when 'pending' then 0 when 'refused' then 0 when 'canceled' then 0
    when 'paid' then 1 when 'refund_requested' then 1 when 'disputed' then 1
    when 'refunded' then 2 when 'chargedback' then 2
    else -1 end
$$;

create or replace function utmfy.order_transition_allowed(
  cur text, cur_event_at timestamptz, nxt text, nxt_event_at timestamptz
) returns text language plpgsql immutable as $$
-- Retorna null se permitido, ou o motivo da rejeição.
declare
  ct integer := utmfy.order_status_tier(cur);
  nt integer := utmfy.order_status_tier(nxt);
begin
  if nt < 0 then return 'unknown_status'; end if;
  if cur is null then return null; end if;
  if cur = nxt then return 'same_status'; end if;
  if nt > ct then return null; end if;
  if nt < ct then return 'regression_blocked'; end if;
  -- mesmo tier
  if ct = 2 then
    if cur = 'refunded' and nxt = 'chargedback' then return null; end if;
    return 'final_status';
  end if;
  if cur_event_at is not null and nxt_event_at is not null and nxt_event_at < cur_event_at then
    return 'stale_event';
  end if;
  if cur_event_at is not null and nxt_event_at is null then
    return 'stale_event_unknown_time';
  end if;
  return null;
end $$;

-- Upsert atômico de um pedido normalizado (chamado pelo backend com service_role).
-- p: objeto com as colunas de utmfy.orders + "event_at" (timestamp do evento).
create or replace function utmfy.upsert_order(p jsonb)
returns jsonb language plpgsql security definer set search_path = utmfy as $$
declare
  v_ws         uuid := (p->>'workspace_id')::uuid;
  v_provider   text := coalesce(p->>'provider', 'cakto');
  v_ext        text := p->>'external_order_id';
  v_status     text := p->>'status';
  v_event_at   timestamptz := nullif(p->>'event_at', '')::timestamptz;
  v_source     text := coalesce(p->>'source', 'webhook');
  cur          utmfy.orders%rowtype;
  v_reason     text;
  v_inserted   boolean := false;
  v_applied    boolean := false;
  v_prev       text;
begin
  if v_ws is null or v_ext is null or v_status is null then
    raise exception 'upsert_order: workspace_id, external_order_id e status são obrigatórios';
  end if;

  select * into cur from utmfy.orders
   where workspace_id = v_ws and provider = v_provider and external_order_id = v_ext
   for update;

  if not found then
    insert into utmfy.orders (
      workspace_id, offer_id, provider, external_order_id, ref_id, product_external_id, product_name,
      offer_external_id, offer_name, checkout_id, status, raw_status, offer_type, parent_order, currency,
      base_amount, gross_amount, fees, discount, net_amount, payment_method, installments, callback,
      customer_email_sha256, customer_phone_sha256, provider_created_at, paid_at, refund_requested_at,
      refunded_at, chargedback_at, canceled_at, provider_updated_at, status_event_at, source
    ) values (
      v_ws, nullif(p->>'offer_id', '')::uuid, v_provider, v_ext, p->>'ref_id', p->>'product_external_id',
      p->>'product_name', p->>'offer_external_id', p->>'offer_name', p->>'checkout_id', v_status,
      p->>'raw_status', p->>'offer_type', nullif(p->>'parent_order', ''), coalesce(p->>'currency', 'BRL'),
      (p->>'base_amount')::numeric, (p->>'gross_amount')::numeric, (p->>'fees')::numeric,
      (p->>'discount')::numeric, (p->>'net_amount')::numeric, p->>'payment_method',
      (p->>'installments')::integer, p->>'callback', p->>'customer_email_sha256', p->>'customer_phone_sha256',
      (p->>'provider_created_at')::timestamptz, (p->>'paid_at')::timestamptz,
      (p->>'refund_requested_at')::timestamptz, (p->>'refunded_at')::timestamptz,
      (p->>'chargedback_at')::timestamptz, (p->>'canceled_at')::timestamptz,
      (p->>'provider_updated_at')::timestamptz, v_event_at, v_source
    ) returning * into cur;
    v_inserted := true;
    v_applied := true;
    insert into utmfy.order_status_history (workspace_id, order_id, from_status, to_status, raw_status, applied, reason, source, event_at)
    values (v_ws, cur.id, null, v_status, p->>'raw_status', true, 'created', v_source, v_event_at);
  else
    v_prev := cur.status;
    v_reason := utmfy.order_transition_allowed(cur.status, cur.status_event_at, v_status, v_event_at);
    v_applied := v_reason is null;

    -- Campos descritivos: completa o que faltava, nunca apaga com null.
    update utmfy.orders o set
      offer_id              = coalesce(o.offer_id, nullif(p->>'offer_id', '')::uuid),
      ref_id                = coalesce(p->>'ref_id', o.ref_id),
      product_external_id   = coalesce(p->>'product_external_id', o.product_external_id),
      product_name          = coalesce(p->>'product_name', o.product_name),
      offer_external_id     = coalesce(p->>'offer_external_id', o.offer_external_id),
      offer_name            = coalesce(p->>'offer_name', o.offer_name),
      checkout_id           = coalesce(p->>'checkout_id', o.checkout_id),
      offer_type            = coalesce(p->>'offer_type', o.offer_type),
      parent_order          = coalesce(nullif(p->>'parent_order', ''), o.parent_order),
      currency              = coalesce(p->>'currency', o.currency),
      base_amount           = coalesce((p->>'base_amount')::numeric, o.base_amount),
      gross_amount          = coalesce((p->>'gross_amount')::numeric, o.gross_amount),
      fees                  = coalesce((p->>'fees')::numeric, o.fees),
      discount              = coalesce((p->>'discount')::numeric, o.discount),
      net_amount            = coalesce((p->>'net_amount')::numeric, o.net_amount),
      payment_method        = case when v_applied then coalesce(p->>'payment_method', o.payment_method) else coalesce(o.payment_method, p->>'payment_method') end,
      installments          = coalesce((p->>'installments')::integer, o.installments),
      callback              = coalesce(o.callback, p->>'callback'),
      customer_email_sha256 = coalesce(o.customer_email_sha256, p->>'customer_email_sha256'),
      customer_phone_sha256 = coalesce(o.customer_phone_sha256, p->>'customer_phone_sha256'),
      provider_created_at   = coalesce(o.provider_created_at, (p->>'provider_created_at')::timestamptz),
      paid_at               = coalesce(o.paid_at, (p->>'paid_at')::timestamptz),
      refund_requested_at   = coalesce((p->>'refund_requested_at')::timestamptz, o.refund_requested_at),
      refunded_at           = coalesce(o.refunded_at, (p->>'refunded_at')::timestamptz),
      chargedback_at        = coalesce(o.chargedback_at, (p->>'chargedback_at')::timestamptz),
      canceled_at           = coalesce(o.canceled_at, (p->>'canceled_at')::timestamptz),
      provider_updated_at   = greatest(o.provider_updated_at, (p->>'provider_updated_at')::timestamptz),
      status                = case when v_applied then v_status else o.status end,
      raw_status            = case when v_applied then coalesce(p->>'raw_status', o.raw_status) else o.raw_status end,
      status_event_at       = case when v_applied then coalesce(v_event_at, o.status_event_at) else o.status_event_at end
    where o.id = cur.id
    returning * into cur;

    if v_reason is distinct from 'same_status' then
      insert into utmfy.order_status_history (workspace_id, order_id, from_status, to_status, raw_status, applied, reason, source, event_at)
      values (v_ws, cur.id, v_prev, v_status, p->>'raw_status', v_applied, coalesce(v_reason, 'transition'), v_source, v_event_at);
    end if;
  end if;

  return jsonb_build_object(
    'order_id', cur.id,
    'inserted', v_inserted,
    'applied', v_applied,
    'previous_status', v_prev,
    'status', cur.status,
    'reason', v_reason
  );
end $$;

revoke all on function utmfy.upsert_order(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Relatórios. As funções devolvem SOMAS BRUTAS no nível mais fino; métricas
-- derivadas (ROAS, CPA, ticket, CTR, CPC...) são calculadas num único lugar
-- no app: src/lib/core/metrics.ts.
--
-- Janela de datas: dias no fuso p_tz (padrão: fuso do workspace).
--   * pedidos aprovados → pela data de paid_at
--   * Pix gerados      → pela data de criação do pedido
--   * gasto Meta       → pela data do insight (fuso da conta de anúncio)
-- ---------------------------------------------------------------------------

-- Contas/campanhas que contam gasto para um conjunto de ofertas.
create or replace function utmfy.offer_spend_scope(p_workspace uuid, p_offer_ids uuid[])
returns table (account_id text, campaign_filter text)
language sql stable security invoker set search_path = utmfy as $$
  select a.account_id, oa.campaign_filter
    from utmfy.offer_ad_accounts oa
    join utmfy.meta_ad_accounts a on a.id = oa.ad_account_id
   where oa.workspace_id = p_workspace
     and (p_offer_ids is null or oa.offer_id = any(p_offer_ids))
  union
  -- "Todas as ofertas": contas monitoradas mesmo sem vínculo com oferta.
  select a.account_id, null::text
    from utmfy.meta_ad_accounts a
   where p_offer_ids is null and a.workspace_id = p_workspace and a.active
$$;

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
    select distinct i.*
      from utmfy.meta_insights_daily i
      join scope s on s.account_id = i.account_id
       and (s.campaign_filter is null or i.campaign_name ilike '%' || s.campaign_filter || '%')
     where i.workspace_id = p_workspace
       and i.date between p_from and p_to
       and (p_currency is null or i.currency is null or i.currency = p_currency)
       and (p_account_id is null or i.account_id = p_account_id)
       and (p_campaign_id is null or i.campaign_id = p_campaign_id)
       and (p_adset_id is null or i.adset_id = p_adset_id)
       and (p_ad_id is null or i.ad_id = p_ad_id)
  )
  select r.account_id, r.campaign_id, max(r.campaign_name), r.adset_id, max(r.adset_name), r.ad_id, max(r.ad_name),
         max(r.currency), sum(r.impressions)::bigint, sum(r.reach)::bigint, sum(r.clicks)::bigint,
         sum(r.link_clicks)::bigint, sum(r.outbound_clicks)::bigint, coalesce(sum(r.spend), 0),
         sum(r.meta_purchases), sum(r.meta_purchase_value)
    from rows r
   group by r.account_id, r.campaign_id, r.adset_id, r.ad_id
$$;

-- Pedidos agregados por (campanha, conjunto, anúncio) atribuídos.
create or replace function utmfy.report_order_rows(
  p_workspace uuid, p_offer_ids uuid[], p_from date, p_to date, p_tz text, p_currency text default null,
  p_source text default null, p_campaign_id text default null, p_adset_id text default null,
  p_ad_id text default null, p_status text default null, p_account_id text default null
) returns table (
  campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  attribution_status text,
  approved_count bigint,          -- pedidos principais aprovados (ofertas main), usado no CPA
  approved_items bigint,          -- todos os pedidos aprovados (inclui bump/upsell)
  gross_revenue numeric,          -- Σ valor cobrado dos aprovados
  fees numeric,
  refunded_count bigint, refunded_amount numeric,
  chargeback_count bigint, chargeback_amount numeric,
  refund_requested_count bigint,
  pix_generated bigint, pix_paid bigint
) language sql stable security invoker set search_path = utmfy as $$
  with o as (
    select o.*, a.campaign_id, a.campaign_name, a.adset_id, a.adset_name, a.ad_id, a.ad_name,
           coalesce(a.attribution_status, 'UNKNOWN') as attribution_status, a.utm_source, a.account_id,
           (o.paid_at is not null and o.status in ('paid', 'refund_requested', 'disputed', 'refunded', 'chargedback')
             and (o.paid_at at time zone p_tz)::date between p_from and p_to) as in_paid_window,
           (o.payment_method in ('pix', 'pix_auto')
             and (coalesce(o.provider_created_at, o.created_at) at time zone p_tz)::date between p_from and p_to) as in_pix_window
      from utmfy.orders o
      left join utmfy.order_attribution a on a.order_id = o.id
     where o.workspace_id = p_workspace
       and (p_offer_ids is null or o.offer_id = any(p_offer_ids))
       and (p_currency is null or o.currency = p_currency)
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
         coalesce(sum(gross_amount) filter (where in_paid_window), 0),
         coalesce(sum(fees) filter (where in_paid_window), 0),
         count(*) filter (where in_paid_window and status = 'refunded'),
         coalesce(sum(gross_amount) filter (where in_paid_window and status = 'refunded'), 0),
         count(*) filter (where in_paid_window and status = 'chargedback'),
         coalesce(sum(gross_amount) filter (where in_paid_window and status = 'chargedback'), 0),
         count(*) filter (where in_paid_window and status = 'refund_requested'),
         count(*) filter (where in_pix_window),
         count(*) filter (where in_pix_window and paid_at is not null)
    from o
   where in_paid_window or in_pix_window
   group by campaign_id, adset_id, ad_id, attribution_status
$$;

-- Custos extras configurados no período (estrutura futura; hoje só "fixed_monthly" pró-rata e % da receita).
create or replace function utmfy.report_other_costs(
  p_workspace uuid, p_offer_ids uuid[], p_from date, p_to date, p_gross numeric, p_sales bigint
) returns numeric language sql stable security invoker set search_path = utmfy as $$
  select coalesce(sum(
    case r.kind
      when 'fixed_monthly' then r.value * ((p_to - p_from + 1)::numeric / 30.0)
      when 'variable_pct_of_revenue' then p_gross * r.value / 100.0
      when 'tax_pct' then p_gross * r.value / 100.0
      when 'gateway_fee_pct' then p_gross * r.value / 100.0
      when 'product_cost_per_sale' then r.value * p_sales
      else 0 end), 0)
  from utmfy.cost_rules r
  where r.workspace_id = p_workspace and r.active
    and (r.offer_id is null or p_offer_ids is null or r.offer_id = any(p_offer_ids))
    and (r.starts_on is null or r.starts_on <= p_to)
    and (r.ends_on is null or r.ends_on >= p_from)
$$;

grant execute on function utmfy.report_spend_rows(uuid, uuid[], date, date, text, text, text, text, text) to authenticated;
grant execute on function utmfy.report_order_rows(uuid, uuid[], date, date, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function utmfy.report_other_costs(uuid, uuid[], date, date, numeric, bigint) to authenticated;
grant execute on function utmfy.offer_spend_scope(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Vault helpers (só service_role). Em Postgres sem Vault (testes), falham com
-- erro claro — o app usa env vars como alternativa.
-- ---------------------------------------------------------------------------
create or replace function utmfy.store_secret(p_workspace uuid, p_owner_type text, p_owner_id uuid, p_secret text)
returns void language plpgsql security definer set search_path = utmfy as $$
declare v_id uuid; v_existing uuid;
begin
  select vault_secret_id into v_existing from utmfy.secret_refs where owner_type = p_owner_type and owner_id = p_owner_id;
  if v_existing is not null then
    perform vault.update_secret(v_existing, p_secret);
  else
    v_id := vault.create_secret(p_secret, p_owner_type || ':' || p_owner_id::text, 'utmfy secret');
    insert into utmfy.secret_refs (workspace_id, owner_type, owner_id, vault_secret_id)
    values (p_workspace, p_owner_type, p_owner_id, v_id);
  end if;
end $$;

create or replace function utmfy.read_secret(p_owner_type text, p_owner_id uuid)
returns text language plpgsql security definer set search_path = utmfy as $$
declare v_secret text;
begin
  select ds.decrypted_secret into v_secret
    from utmfy.secret_refs r
    join vault.decrypted_secrets ds on ds.id = r.vault_secret_id
   where r.owner_type = p_owner_type and r.owner_id = p_owner_id;
  return v_secret;
end $$;

revoke all on function utmfy.store_secret(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function utmfy.read_secret(text, uuid) from public, anon, authenticated;
