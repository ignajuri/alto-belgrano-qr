-- ============================================================================
-- Migración 004 — Fiestas de egresados (entradas por familia, cena y baile)
--
-- Agrega un segundo tipo de evento sin cambiar cómo funcionan los
-- cumpleaños de 15:
--
--   · quince     → un invitado por fila, con DNI, un QR por correo (como hoy).
--   · egresados  → una familia (grupo) compra N entradas de cena y/o baile;
--                  cada entrada es una fila de `invitados` con su propio QR y
--                  todas las de la familia llegan juntas a un único correo.
--
-- El escáner sigue validando siempre una entrada individual, así que la
-- protección contra doble uso no cambia.
--
-- Ejecutar en el SQL Editor de Supabase ANTES de desplegar el backend nuevo.
-- Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================================

-- ── 1. Tipo de evento y horario del baile ───────────────────────────────────
alter table public.eventos
  add column if not exists tipo         varchar(20) not null default 'quince',
  add column if not exists inicio_baile timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_tipo_check') then
    alter table public.eventos
      add constraint eventos_tipo_check check (tipo in ('quince', 'egresados'));
  end if;
end $$;

comment on column public.eventos.tipo is
  'quince: un invitado por fila con DNI. egresados: entradas por familia (cena/baile).';
comment on column public.eventos.inicio_baile is
  'Desde cuándo se aceptan entradas de baile. NULL = sin restricción horaria.';

-- ── 2. Grupos (familias que compran entradas) ───────────────────────────────
-- El correo identifica a la familia dentro del evento: es lo que permite volver
-- a subir el Excel y detectar que "los Pérez" ya estaban, aunque haya dos
-- familias con el mismo apellido.
create table if not exists public.grupos (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  nombre     varchar(160) not null,
  email      varchar(255) not null,
  telefono   varchar(40),
  creado_en  timestamptz not null default now()
);

create unique index if not exists grupos_evento_email_key
  on public.grupos (evento_id, lower(email));

create index if not exists grupos_evento_id_idx
  on public.grupos (evento_id);

alter table public.grupos enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'grupos'
      and policyname = 'service_role_full_access_grupos'
  ) then
    create policy service_role_full_access_grupos
      on public.grupos for all
      using (auth.role() = 'service_role');
  end if;
end $$;

-- ── 3. Entradas: grupo, tipo y número ───────────────────────────────────────
alter table public.invitados
  add column if not exists grupo_id     uuid references public.grupos(id) on delete cascade,
  add column if not exists tipo_entrada varchar(10) not null default 'cena',
  add column if not exists numero       integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invitados_tipo_entrada_check') then
    alter table public.invitados
      add constraint invitados_tipo_entrada_check check (tipo_entrada in ('cena', 'baile'));
  end if;
end $$;

create index if not exists invitados_grupo_id_idx
  on public.invitados (grupo_id);

-- Una familia no puede tener dos veces la "entrada 3".
create unique index if not exists invitados_grupo_numero_key
  on public.invitados (grupo_id, numero)
  where grupo_id is not null;

-- Las entradas de egresados no tienen DNI ni apellido. El índice único de
-- (evento_id, dni) de la migración 001 sigue funcionando: Postgres permite
-- varios NULL en un índice único, así que solo restringe a los que tienen DNI.
alter table public.invitados
  alter column dni      drop not null,
  alter column apellido drop not null;

-- Los cumpleaños de 15 siguen exigiendo DNI: una entrada sin grupo tiene que
-- traerlo, como hasta ahora.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invitados_dni_si_no_es_grupo') then
    alter table public.invitados
      add constraint invitados_dni_si_no_es_grupo
      check (grupo_id is not null or (dni is not null and apellido is not null));
  end if;
end $$;

-- ── 4. Purga de datos personales: incluir las familias ──────────────────────
-- Misma función que la migración 002, ahora también borra los grupos (nombre
-- de la familia, correo y teléfono son datos personales).
create or replace function public.purgar_invitados_vencidos(horas_retencion integer default 48)
returns table (
  evento_id           uuid,
  nombre_evento       varchar,
  invitados_borrados  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  ev record;
  n  integer;
begin
  for ev in
    select e.id, e.nombre_evento, e.fecha
    from public.eventos e
    where e.datos_purgados_en is null
      and now() > ((e.fecha + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
                  + (horas_retencion * interval '1 hour')
  loop
    update public.eventos e
    set total_invitados  = (select count(*) from public.invitados i where i.evento_id = ev.id),
        total_ingresados = (select count(*) from public.invitados i where i.evento_id = ev.id and i.ingresado),
        datos_purgados_en = now()
    where e.id = ev.id;

    delete from public.invitados i where i.evento_id = ev.id;
    get diagnostics n = row_count;

    delete from public.grupos g where g.evento_id = ev.id;

    insert into public.auditoria (accion, entidad, entidad_id, detalle)
    values ('datos_purgados', 'eventos', ev.id::text,
            jsonb_build_object('invitados_borrados', n, 'horas_retencion', horas_retencion));

    evento_id := ev.id;
    nombre_evento := ev.nombre_evento;
    invitados_borrados := n;
    return next;
  end loop;
end;
$$;

-- ── 5. Verificación ─────────────────────────────────────────────────────────
-- Las columnas nuevas:
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'eventos'   and column_name in ('tipo', 'inicio_baile')) or
    (table_name = 'invitados' and column_name in ('grupo_id', 'tipo_entrada', 'numero', 'dni', 'apellido')) or
    (table_name = 'grupos')
  )
order by table_name, column_name;

-- RLS activo en todas las tablas (grupos incluida):
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
