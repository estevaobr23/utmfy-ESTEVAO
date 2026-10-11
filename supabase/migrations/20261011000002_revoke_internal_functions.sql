-- O "grant execute on all functions ... to authenticated" de 20261011000000
-- reabriu funções internas que as migrations originais restringiam ao
-- service_role: gravar pedidos, gravar sessões e ler/gravar segredos do Vault.
revoke execute on function utmfy.upsert_order(jsonb) from public, anon, authenticated;
revoke execute on function utmfy.track_session(jsonb) from public, anon, authenticated;
revoke execute on function utmfy.store_secret(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function utmfy.read_secret(text, uuid) from public, anon, authenticated;

-- Funções novas não ficam abertas a usuários logados por padrão; cada uma
-- concede o que precisa explicitamente.
alter default privileges in schema utmfy revoke execute on functions from authenticated;
