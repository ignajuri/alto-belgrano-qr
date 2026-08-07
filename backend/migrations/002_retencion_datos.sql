-- ============================================================================
-- Migración 002 — Retención de datos personales (Ley 25.326)
--
-- Borra automáticamente los datos personales de los invitados (nombre,
-- apellido, DNI, email) una vez pasada la ventana de retención posterior al
-- evento, conservando solo agregados numéricos que no identifican a nadie.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- ============================================================================

-- ── 1. Agregados que sobreviven a la purga ──────────────────────────────────
-- No son datos personales: son conteos. Permiten que el dashboard siga
-- mostrando "asistieron 87 de 120" después de borrar la lista nominal.
alter table public.eventos
  add column if not exists total_invitados   integer,
  add column if not exists total_ingresados  integer,
  add column if not exists datos_purgados_en timestamptz;

comment on column public.eventos.datos_purgados_en is
  'Cuándo se borraron los datos personales de los invitados de este evento.';

-- ── 2. Función de purga ─────────────────────────────────────────────────────
--
-- IMPORTANTE sobre el valor de horas_retencion:
--
-- El QR sigue siendo válido hasta QR_HORAS_DESPUES (por defecto 24) después
-- del fin del día del evento. La retención NO puede ser menor que ese valor,
-- porque estaríamos borrando invitados cuyo QR todavía se puede escanear en la
-- puerta. 48 horas deja un margen de un día completo para reclamos ("no me
-- dejaron entrar", "¿cuántos vinieron?") sin alargar la exposición.
--
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
      -- Fin del día del evento en horario argentino, más la retención.
      and now() > ((e.fecha + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
                  + (horas_retencion * interval '1 hour')
  loop
    -- Primero congelamos los agregados, después borramos las filas.
    update public.eventos e
    set total_invitados  = (select count(*) from public.invitados i where i.evento_id = ev.id),
        total_ingresados = (select count(*) from public.invitados i where i.evento_id = ev.id and i.ingresado),
        datos_purgados_en = now()
    where e.id = ev.id;

    delete from public.invitados i where i.evento_id = ev.id;
    get diagnostics n = row_count;

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

comment on function public.purgar_invitados_vencidos(integer) is
  'Borra datos personales de invitados de eventos vencidos. Conserva agregados.';

-- ── 3. Backfill de eventos ya vencidos ──────────────────────────────────────
-- Los eventos viejos que ya están fuera de la ventana se purgan en la primera
-- corrida. Si querés revisar antes qué se va a borrar, comentá esta línea y
-- ejecutá primero la consulta de la sección 6.
select * from public.purgar_invitados_vencidos(48);

-- ── 4. Programación diaria con pg_cron ──────────────────────────────────────
create extension if not exists pg_cron;

-- pg_cron trabaja en UTC: 05:00 UTC = 02:00 en Argentina, fuera de horario
-- de eventos. Se desprograma antes por si esta migración se corre dos veces.
select cron.unschedule('purga-invitados-vencidos')
where exists (select 1 from cron.job where jobname = 'purga-invitados-vencidos');

select cron.schedule(
  'purga-invitados-vencidos',
  '0 5 * * *',
  $$ select public.purgar_invitados_vencidos(48) $$
);

-- ── 5. Retención de la auditoría ────────────────────────────────────────────
-- La auditoría no guarda datos de invitados (solo IDs y conteos), pero sí
-- emails del personal. 12 meses es razonable para investigar un incidente.
select cron.unschedule('purga-auditoria')
where exists (select 1 from cron.job where jobname = 'purga-auditoria');

select cron.schedule(
  'purga-auditoria',
  '30 5 * * 0',
  $$ delete from public.auditoria where creado_en < now() - interval '12 months' $$
);

-- ── 6. Verificación ─────────────────────────────────────────────────────────

-- Tareas programadas (deberían aparecer las dos):
select jobname, schedule, active from cron.job order by jobname;

-- Qué eventos tienen todavía datos personales y cuándo se van a purgar:
select nombre_evento,
       fecha,
       (select count(*) from public.invitados i where i.evento_id = e.id) as invitados,
       ((fecha + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires')
         + interval '48 hours' as se_purga_el,
       datos_purgados_en
from public.eventos e
order by fecha desc;

-- Últimas purgas ejecutadas:
-- select creado_en, entidad_id, detalle from public.auditoria
-- where accion = 'datos_purgados' order by creado_en desc limit 20;

-- ── Cómo cambiar la ventana de retención ────────────────────────────────────
-- Reemplazar el 48 en la tarea programada (mínimo 24, ver nota de la sección 2):
--
--   select cron.unschedule('purga-invitados-vencidos');
--   select cron.schedule('purga-invitados-vencidos', '0 5 * * *',
--     $$ select public.purgar_invitados_vencidos(72) $$);
--
-- Para ejecutar una purga a mano en cualquier momento:
--
--   select * from public.purgar_invitados_vencidos(48);
