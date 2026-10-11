-- Acesso SQL do servidor MCP (/api/mcp), autorizado pelo dono do projeto.
-- O SQL vindo do assistente roda como "utmfy_mcp", que só enxerga o schema
-- utmfy: o mesmo banco hospeda a área de membros (public) e a mineração
-- (mineracao), que ficam inacessíveis, assim como o Vault. DDL não é permitido
-- (o papel não é dono de nada) — mudança de schema continua sendo migration.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'utmfy_mcp') then
    create role utmfy_mcp nologin;
  end if;
end $$;

grant utmfy_mcp to service_role;

grant usage on schema utmfy to utmfy_mcp;
grant select, insert, update, delete on all tables in schema utmfy to utmfy_mcp;
grant usage, select on all sequences in schema utmfy to utmfy_mcp;
grant execute on all functions in schema utmfy to utmfy_mcp;
alter default privileges in schema utmfy grant select, insert, update, delete on tables to utmfy_mcp;
alter default privileges in schema utmfy grant usage, select on sequences to utmfy_mcp;
alter default privileges in schema utmfy grant execute on functions to utmfy_mcp;

revoke all on utmfy.secret_refs from utmfy_mcp;
revoke execute on function utmfy.store_secret(uuid, text, uuid, text) from utmfy_mcp;
revoke execute on function utmfy.read_secret(text, uuid) from utmfy_mcp;

-- As policies existentes são "to authenticated"; o papel do MCP precisa das suas.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'utmfy' and tablename <> 'secret_refs' loop
    execute format('drop policy if exists mcp_all on utmfy.%I', t);
    execute format('create policy mcp_all on utmfy.%I for all to utmfy_mcp using (true) with check (true)', t);
  end loop;
end $$;

-- Leitura: subselect (bloqueia CTE de escrita) + transação somente leitura.
create or replace function utmfy.mcp_query(q text, max_rows integer default 500)
returns jsonb language plpgsql security invoker as $$
declare r jsonb;
begin
  perform set_config('role', 'utmfy_mcp', true);
  perform set_config('search_path', 'utmfy, extensions', true);
  perform set_config('statement_timeout', '15s', true);
  perform set_config('transaction_read_only', 'on', true);
  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) s limit %s) t',
    q, least(greatest(coalesce(max_rows, 500), 1), 5000)
  ) into r;
  return r;
end $$;

create or replace function utmfy.mcp_exec(q text)
returns jsonb language plpgsql security invoker as $$
declare n bigint;
begin
  perform set_config('role', 'utmfy_mcp', true);
  perform set_config('search_path', 'utmfy, extensions', true);
  perform set_config('statement_timeout', '30s', true);
  execute q;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'row_count', n);
end $$;

revoke all on function utmfy.mcp_query(text, integer) from public, anon, authenticated, utmfy_mcp;
revoke all on function utmfy.mcp_exec(text) from public, anon, authenticated, utmfy_mcp;
grant execute on function utmfy.mcp_query(text, integer) to service_role;
grant execute on function utmfy.mcp_exec(text) to service_role;
