-- ============================================================================
-- Migración 003 — Recuperación de contraseña por email
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

-- ── 1. Tokens de recuperación ───────────────────────────────────────────────
--
-- Se guarda el SHA-256 del token, nunca el token en claro. El valor real viaja
-- solamente en el email. Si alguien llegara a leer esta tabla, vería hashes
-- inservibles: no podría usar los enlaces pendientes.
--
create table if not exists public.tokens_recuperacion (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  token_hash  varchar(64) not null,
  expira_en   timestamptz not null,
  usado_en    timestamptz,
  ip          varchar(64),
  creado_en   timestamptz not null default now()
);

-- El lookup se hace por hash, así que este índice es el que importa.
create unique index if not exists tokens_recuperacion_hash_key
  on public.tokens_recuperacion (token_hash);

create index if not exists tokens_recuperacion_usuario_idx
  on public.tokens_recuperacion (usuario_id);

create index if not exists tokens_recuperacion_expira_idx
  on public.tokens_recuperacion (expira_en);

comment on table public.tokens_recuperacion is
  'Enlaces de restablecimiento de contraseña. Un solo uso, vencimiento corto.';

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
-- Igual que el resto: solo el backend entra. Que el rol anon pudiera leer esta
-- tabla sería equivalente a regalar el acceso a todas las cuentas.
alter table public.tokens_recuperacion enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'tokens_recuperacion'
      and policyname = 'service_role_full_access_tokens_recuperacion'
  ) then
    create policy service_role_full_access_tokens_recuperacion
      on public.tokens_recuperacion for all
      using (auth.role() = 'service_role');
  end if;
end $$;

-- ── 3. Limpieza automática ──────────────────────────────────────────────────
-- Los tokens vencidos o ya usados no sirven para nada. Se borran a diario para
-- que la tabla no crezca sin control.
select cron.unschedule('purga-tokens-recuperacion')
where exists (select 1 from cron.job where jobname = 'purga-tokens-recuperacion');

select cron.schedule(
  'purga-tokens-recuperacion',
  '15 5 * * *',
  $$ delete from public.tokens_recuperacion
     where expira_en < now() - interval '7 days' or usado_en is not null $$
);

-- ── 4. Verificación ─────────────────────────────────────────────────────────

-- Las cinco tablas tienen que figurar con rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- Las tres tareas programadas.
select jobname, schedule, active from cron.job order by jobname;

-- Para auditar recuperaciones más adelante:
--
--   select creado_en, usuario_email, accion, ip
--   from public.auditoria
--   where accion like 'recuperacion%'
--   order by creado_en desc;
