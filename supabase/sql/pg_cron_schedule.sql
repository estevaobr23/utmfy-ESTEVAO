-- =============================================================================
-- Agendamento a cada 15 min via pg_cron + pg_net (Supabase). NÃO é migration:
-- rode UMA vez no SQL Editor do projeto de produção depois do deploy,
-- trocando APP_URL. O CRON_SECRET fica no Vault (nunca em texto na tabela).
--
-- 1) Database → Extensions: habilite pg_cron e pg_net.
-- 2) Guarde o segredo no Vault (mesmo valor da env CRON_SECRET da Vercel):
--      select vault.create_secret('<CRON_SECRET>', 'utmfy_cron_secret');
-- 3) Rode o bloco abaixo.
-- =============================================================================

create or replace function utmfy.utmfy_call_cron(job text)
returns bigint language plpgsql security definer set search_path = utmfy as $$
declare
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'utmfy_cron_secret');
begin
  return net.http_post(
    url := 'https://APP_URL/api/cron/' || job,             -- <<< troque APP_URL
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 300000
  );
end $$;
revoke all on function utmfy.utmfy_call_cron(text) from public, anon, authenticated;

select cron.schedule('utmfy-meta-sync',       '*/15 * * * *', $$select utmfy.utmfy_call_cron('meta-sync')$$);
select cron.schedule('utmfy-cakto-reconcile', '7 * * * *',    $$select utmfy.utmfy_call_cron('cakto-reconcile')$$);
select cron.schedule('utmfy-capi-dispatch',   '*/5 * * * *',  $$select utmfy.utmfy_call_cron('capi-dispatch')$$);

-- Conferir:   select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 20;
-- Remover:    select cron.unschedule('utmfy-meta-sync');
