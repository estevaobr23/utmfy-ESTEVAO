-- Ciclo de vida seguro das ofertas e associações explícitas com objetos Meta.
-- Não destrutiva: cria uma tabela e uma RPC; nenhum dado existente é apagado.

create table if not exists utmfy.offer_meta_bindings (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references utmfy.workspaces(id) on delete cascade,
  offer_id       uuid not null,
  ad_account_id  uuid not null,
  level          text not null check (level in ('campaign', 'adset')),
  object_id      text not null check (object_id ~ '^[0-9]{1,30}$'),
  source         text not null default 'manual' check (source in ('manual', 'pixel_suggested', 'legacy')),
  status         text not null default 'confirmed' check (status in ('suggested', 'confirmed', 'conflict')),
  verified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (workspace_id, offer_id) references utmfy.offers(workspace_id, id) on delete cascade,
  foreign key (workspace_id, ad_account_id) references utmfy.meta_ad_accounts(workspace_id, id) on delete cascade,
  foreign key (offer_id, ad_account_id) references utmfy.offer_ad_accounts(offer_id, ad_account_id) on delete cascade,
  unique (offer_id, ad_account_id, level, object_id)
);

create unique index if not exists offer_meta_binding_confirmed_owner
  on utmfy.offer_meta_bindings(workspace_id, ad_account_id, level, object_id)
  where status = 'confirmed';
create index if not exists offer_meta_bindings_offer_idx
  on utmfy.offer_meta_bindings(offer_id, status, level);
create trigger offer_meta_bindings_touch before update on utmfy.offer_meta_bindings
  for each row execute function utmfy.touch_updated_at();

alter table utmfy.offer_meta_bindings enable row level security;
create policy offer_meta_bindings_select on utmfy.offer_meta_bindings
  for select to authenticated using (utmfy.is_member(workspace_id));
create policy offer_meta_bindings_insert on utmfy.offer_meta_bindings
  for insert to authenticated with check (utmfy.can_write(workspace_id));
create policy offer_meta_bindings_update on utmfy.offer_meta_bindings
  for update to authenticated using (utmfy.can_write(workspace_id)) with check (utmfy.can_write(workspace_id));
create policy offer_meta_bindings_delete on utmfy.offer_meta_bindings
  for delete to authenticated using (utmfy.can_write(workspace_id));
grant select, insert, update, delete on utmfy.offer_meta_bindings to authenticated, service_role;
revoke all on utmfy.offer_meta_bindings from anon;

-- Converte somente filtros legados que já são listas inequívocas de IDs.
insert into utmfy.offer_meta_bindings
  (workspace_id, offer_id, ad_account_id, level, object_id, source, status, verified_at)
select l.workspace_id, l.offer_id, l.ad_account_id, 'campaign', ids.object_id, 'legacy', 'confirmed', now()
from utmfy.offer_ad_accounts l
cross join lateral unnest(string_to_array(l.campaign_filter, ',')) as ids(object_id)
where l.campaign_filter ~ '^[0-9]{1,30}(,[0-9]{1,30})*$'
on conflict do nothing;

create or replace function utmfy.delete_empty_offer(p_offer uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = utmfy, public
as $$
declare
  v_offer utmfy.offers%rowtype;
  v_orders bigint;
  v_sessions bigint;
begin
  select * into v_offer from utmfy.offers where id = p_offer for update;
  if not found then
    raise exception 'offer_not_found';
  end if;
  if not utmfy.can_write(v_offer.workspace_id) then
    raise exception 'offer_forbidden';
  end if;
  if p_confirmation is distinct from v_offer.name then
    raise exception 'offer_confirmation_mismatch';
  end if;

  select count(*) into v_orders from utmfy.orders where offer_id = p_offer;
  select count(*) into v_sessions from utmfy.tracking_sessions where offer_id = p_offer;
  if v_orders > 0 or v_sessions > 0 then
    raise exception 'offer_has_history: orders=%, sessions=%', v_orders, v_sessions;
  end if;

  -- Remove somente a referência exclusiva do webhook. Contas, pixels e dados
  -- Meta são compartilhados e não são apagados; apenas seus vínculos em cascade.
  delete from utmfy.secret_refs where owner_type = 'cakto_webhook' and owner_id = p_offer;
  delete from utmfy.offers where id = p_offer;

  return jsonb_build_object('deleted', true, 'offer_id', p_offer);
end $$;

revoke all on function utmfy.delete_empty_offer(uuid, text) from public, anon;
grant execute on function utmfy.delete_empty_offer(uuid, text) to authenticated, service_role;

create or replace function utmfy.replace_offer_meta_bindings(
  p_offer uuid,
  p_ad_account uuid,
  p_campaign_ids text[] default '{}',
  p_adset_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = utmfy, public
as $$
declare
  v_workspace uuid;
  v_account_workspace uuid;
  v_conflicts bigint;
begin
  select workspace_id into v_workspace from utmfy.offers where id = p_offer for update;
  if not found then raise exception 'offer_not_found'; end if;
  if not utmfy.can_write(v_workspace) then raise exception 'offer_forbidden'; end if;
  select workspace_id into v_account_workspace from utmfy.meta_ad_accounts where id = p_ad_account;
  if v_account_workspace is distinct from v_workspace then raise exception 'account_not_found'; end if;
  if exists (select 1 from unnest(coalesce(p_campaign_ids, '{}')) id where id !~ '^[0-9]{1,30}$')
     or exists (select 1 from unnest(coalesce(p_adset_ids, '{}')) id where id !~ '^[0-9]{1,30}$') then
    raise exception 'invalid_meta_id';
  end if;

  select count(*) into v_conflicts
  from utmfy.offer_meta_bindings b
  where b.workspace_id = v_workspace and b.ad_account_id = p_ad_account and b.status = 'confirmed'
    and b.offer_id <> p_offer
    and ((b.level = 'campaign' and b.object_id = any(coalesce(p_campaign_ids, '{}')))
      or (b.level = 'adset' and b.object_id = any(coalesce(p_adset_ids, '{}'))));
  if v_conflicts > 0 then raise exception 'meta_binding_conflict'; end if;

  insert into utmfy.offer_ad_accounts (workspace_id, offer_id, ad_account_id, campaign_filter)
  values (v_workspace, p_offer, p_ad_account, nullif(array_to_string(coalesce(p_campaign_ids, '{}'), ','), ''))
  on conflict (offer_id, ad_account_id) do update
    set campaign_filter = excluded.campaign_filter;

  delete from utmfy.offer_meta_bindings where offer_id = p_offer and ad_account_id = p_ad_account;
  insert into utmfy.offer_meta_bindings (workspace_id, offer_id, ad_account_id, level, object_id, source, status, verified_at)
  select v_workspace, p_offer, p_ad_account, 'campaign', id, 'manual', 'confirmed', now()
  from (select distinct unnest(coalesce(p_campaign_ids, '{}')) id) ids;
  insert into utmfy.offer_meta_bindings (workspace_id, offer_id, ad_account_id, level, object_id, source, status, verified_at)
  select v_workspace, p_offer, p_ad_account, 'adset', id, 'manual', 'confirmed', now()
  from (select distinct unnest(coalesce(p_adset_ids, '{}')) id) ids;

  return jsonb_build_object('campaigns', cardinality(coalesce(p_campaign_ids, '{}')), 'adsets', cardinality(coalesce(p_adset_ids, '{}')));
end $$;

revoke all on function utmfy.replace_offer_meta_bindings(uuid, uuid, text[], text[]) from public, anon;
grant execute on function utmfy.replace_offer_meta_bindings(uuid, uuid, text[], text[]) to authenticated, service_role;

-- ROLLBACK (manual, se necessário):
-- drop function utmfy.delete_empty_offer(uuid, text);
-- drop function utmfy.replace_offer_meta_bindings(uuid, uuid, text[], text[]);
-- drop table utmfy.offer_meta_bindings;
