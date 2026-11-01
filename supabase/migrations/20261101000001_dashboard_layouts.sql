-- Layout do painel por usuário e workspace (modo edição do Resumo): ordem, largura e blocos ocultos.
-- Só cria objetos novos no schema utmfy. Cada usuário lê e grava apenas o próprio layout.

create table if not exists utmfy.dashboard_layouts (
  workspace_id uuid not null references utmfy.workspaces(id) on delete cascade,
  user_id      uuid not null,
  page         text not null check (page ~ '^[a-z0-9-]{1,40}$'),
  layout       jsonb not null check (jsonb_typeof(layout) = 'array' and pg_column_size(layout) < 8192),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, user_id, page)
);

alter table utmfy.dashboard_layouts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'utmfy' and tablename = 'dashboard_layouts' and policyname = 'dashboard_layouts_own') then
    create policy dashboard_layouts_own on utmfy.dashboard_layouts for all to authenticated
      using (user_id = auth.uid() and utmfy.is_member(workspace_id))
      with check (user_id = auth.uid() and utmfy.is_member(workspace_id));
  end if;
end $$;
grant select, insert, update, delete on utmfy.dashboard_layouts to authenticated, service_role;
revoke all on utmfy.dashboard_layouts from anon;
