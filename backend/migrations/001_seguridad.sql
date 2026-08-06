-- ============================================================================
-- Migración 001 — Endurecimiento de seguridad
-- Ejecutar UNA VEZ en el SQL Editor de Supabase ANTES de desplegar el backend.
-- Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================================

-- ── 1. Revocación de sesiones y bloqueo por fuerza bruta ────────────────────
-- password_changed_at: todo JWT emitido antes de esta marca queda inválido.
-- intentos_fallidos / bloqueado_hasta: bloqueo temporal de cuenta en el login.
alter table public.usuarios
  add column if not exists password_changed_at timestamptz not null default now(),
  add column if not exists intentos_fallidos   integer     not null default 0,
  add column if not exists bloqueado_hasta     timestamptz,
  add column if not exists ultimo_acceso       timestamptz;

-- ── 2. Normalización de emails ──────────────────────────────────────────────
-- La app siempre guarda el email en minúsculas; este índice impide que existan
-- "Juan@x.com" y "juan@x.com" como dos cuentas distintas.
update public.usuarios set email = lower(trim(email)) where email <> lower(trim(email));

create unique index if not exists usuarios_email_lower_key
  on public.usuarios (lower(email));

-- ── 3. Integridad de los invitados ──────────────────────────────────────────
-- El qr_token es la credencial de acceso: tiene que ser único sí o sí.
create unique index if not exists invitados_qr_token_key
  on public.invitados (qr_token);

-- Un mismo DNI no puede estar dos veces en el mismo evento.
-- Si esto falla, hay duplicados previos: correr primero la consulta del final.
create unique index if not exists invitados_evento_dni_key
  on public.invitados (evento_id, dni);

create index if not exists invitados_evento_id_idx
  on public.invitados (evento_id);

-- ── 4. Flags booleanos NOT NULL ─────────────────────────────────────────────
-- Imprescindible para el UPDATE atómico que evita usar el mismo QR dos veces:
-- la condición "ingresado = false" no matchea filas con NULL.
update public.invitados set ingresado  = false where ingresado  is null;
update public.invitados set qr_enviado = false where qr_enviado is null;

alter table public.invitados
  alter column ingresado  set default false,
  alter column ingresado  set not null,
  alter column qr_enviado set default false,
  alter column qr_enviado set not null;

-- ── 5. Tabla de auditoría ───────────────────────────────────────────────────
create table if not exists public.auditoria (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid references public.usuarios(id) on delete set null,
  usuario_email varchar(255),
  accion        varchar(64) not null,
  entidad       varchar(64),
  entidad_id    varchar(64),
  detalle       jsonb,
  ip            varchar(64),
  creado_en     timestamptz not null default now()
);

create index if not exists auditoria_creado_en_idx on public.auditoria (creado_en desc);
create index if not exists auditoria_usuario_idx   on public.auditoria (usuario_id);
create index if not exists auditoria_accion_idx    on public.auditoria (accion);

-- RLS: igual que el resto de las tablas, solo el backend (service_role) entra.
alter table public.auditoria enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'auditoria'
      and policyname = 'service_role_full_access_auditoria'
  ) then
    create policy service_role_full_access_auditoria
      on public.auditoria for all
      using (auth.role() = 'service_role');
  end if;
end $$;

-- ── 6. Verificación ─────────────────────────────────────────────────────────
-- Debe devolver rowsecurity = true para las CUATRO tablas.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- Si el índice único de (evento_id, dni) falló, esto lista los duplicados
-- que hay que resolver a mano antes de volver a correr la migración:
--
--   select evento_id, dni, count(*)
--   from public.invitados
--   group by evento_id, dni
--   having count(*) > 1;
