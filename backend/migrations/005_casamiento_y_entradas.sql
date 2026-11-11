-- ============================================================================
-- Migración 005 — Casamientos, forma de carga y DNI opcional
--
--   · Nuevo tipo de evento: casamiento.
--   · La forma de cargar los invitados pasa a ser una propiedad del evento
--     (modo_carga), separada del tipo:
--       individual → una persona por fila, su QR a su correo (cumpleaños de 15)
--       familia    → una familia con N entradas a un solo correo (egresados)
--     El casamiento puede usar cualquiera de las dos: se elige al crearlo.
--   · DNI: sigue siendo obligatorio en los cumpleaños de 15 (lo valida el
--     backend); en los casamientos es opcional, así que la base deja de exigirlo.
--   · Tipo de entrada (cena + baile / solo baile): la columna ya existe desde la
--     migración 004. Los invitados individuales cargados hasta hoy tienen
--     'cena', que incluye el baile, así que no cambia nada para ellos.
--
-- Ejecutar en el SQL Editor de Supabase ANTES de desplegar el backend nuevo.
-- Es compatible con la versión actual y se puede volver a correr sin problema.
-- ============================================================================

-- ── 1. Tipo de evento: casamiento ───────────────────────────────────────────
alter table public.eventos drop constraint if exists eventos_tipo_check;
alter table public.eventos
  add constraint eventos_tipo_check check (tipo in ('quince', 'casamiento', 'egresados'));

comment on column public.eventos.tipo is
  'quince, casamiento o egresados. Define textos y reglas (p. ej. DNI obligatorio en quince).';

-- ── 2. Forma de carga ───────────────────────────────────────────────────────
alter table public.eventos
  add column if not exists modo_carga varchar(12) not null default 'individual';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eventos_modo_carga_check') then
    alter table public.eventos
      add constraint eventos_modo_carga_check check (modo_carga in ('individual', 'familia'));
  end if;
end $$;

-- Los eventos de egresados que ya existen se cargan por familia.
update public.eventos set modo_carga = 'familia' where tipo = 'egresados' and modo_carga <> 'familia';

comment on column public.eventos.modo_carga is
  'individual: una persona por fila con su QR. familia: N entradas por familia a un solo correo.';

-- ── 3. DNI opcional fuera de los cumpleaños de 15 ───────────────────────────
-- Antes: una entrada sin familia tenía que tener DNI y apellido. Ahora solo
-- se exige el apellido; el DNI obligatorio para los 15 lo controla el backend.
-- El índice único (evento_id, dni) sigue evitando DNI repetidos cuando hay DNI.
alter table public.invitados drop constraint if exists invitados_dni_si_no_es_grupo;
alter table public.invitados drop constraint if exists invitados_apellido_si_no_es_grupo;
alter table public.invitados
  add constraint invitados_apellido_si_no_es_grupo
  check (grupo_id is not null or apellido is not null);

-- ── 4. Verificación ─────────────────────────────────────────────────────────
select tipo, modo_carga, count(*) as eventos
from public.eventos
group by tipo, modo_carga
order by tipo;
