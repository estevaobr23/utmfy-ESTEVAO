-- Grants para o PostgREST servir o schema "utmfy" (schemas criados por migration
-- não recebem as concessões automáticas que "public" tem). RLS continua sendo a
-- autorização real para "authenticated"; "anon" não acessa nenhuma tabela.

grant usage on schema utmfy to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema utmfy to authenticated, service_role;
grant usage, select on all sequences in schema utmfy to authenticated, service_role;
grant execute on all functions in schema utmfy to authenticated, service_role;

alter default privileges in schema utmfy grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema utmfy grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema utmfy grant execute on functions to authenticated, service_role;

revoke all on all tables in schema utmfy from anon;
revoke all on all sequences in schema utmfy from anon;
revoke all on all functions in schema utmfy from anon;
