-- ===========================================================================
-- Clasificación del inversionista · #14 · R03 J-0315, campo 6
--
-- EJECUTADO el 6 de octubre de 2026 por Claudio Bustamante, a mano, en el SQL
-- Editor de Supabase. Este archivo es el registro de lo que se corrió: del
-- `begin` al `commit` es byte a byte el script ejecutado
-- (14B_clasificacion_inversionista.sql, md5 cb53b42e86b7941fce25d91402394cbd);
-- solo cambió la cabecera.
--
-- POR QUÉ
--
-- El campo 6 del R03 J-0315 pide la clasificación del inversionista según el
-- catálogo de la CNBV: 201 Institucional · 202 Calificado · 203 Sofisticado ·
-- 204 Ninguno. Hoy toda la cartera se reporta 203 por circunstancia, no porque
-- el expediente lo diga. El día que entre un cliente que no lo sea, el reporte
-- saldría mal en silencio.
--
-- PRINCIPIO (mismo patrón que ocupacion_pb y el Art. 17): el sistema LEE la
-- clasificación de un campo con procedencia; nunca la asume. NULL ≠ 204:
-- NULL significa «no determinada», y 204 es una determinación.
--
-- QUÉ HACE
--
-- 1. Cuatro columnas en clientes: clasificacion_inversionista ('201'…'204'),
--    clasificacion_fuente ('carta_firmada' | 'determinacion_asesor'),
--    clasificacion_fecha y clasificacion_nota.
-- 2. Backfill SIN inventar: solo los clientes con carta_sofisticado_firmada =
--    true pasan a 203 con fuente 'carta_firmada'. Todo lo demás queda NULL.
--    `false` en carta_sofisticado_firmada NO se lee como 204: la columna nació
--    con `default false`, así que ahí false significa «no consta carta», no
--    «se verificó que no es sofisticado».
-- 3. Un asiento manual en bitácora por cliente clasificado (origen
--    'migracion'), además de los que fn_bitacora escribe solo.
-- 4. Los CHECK, AL FINAL (si van antes, los estados intermedios del backfill
--    los violan):
--    - clientes_clasificacion_valida: solo los cuatro códigos del catálogo.
--    - clientes_clasificacion_procedencia: clasificación, fuente y fecha van
--      las tres o ninguna; la fuente solo puede ser una de las dos.
--    - clientes_clasificacion_carta: la fuente 'carta_firmada' solo con 203 y
--      con carta_sofisticado_firmada = true. Si alguien desmarca la carta, el
--      UPDATE falla hasta que la clasificación se redetermine: un 203 no puede
--      quedarse colgando de una carta que ya no consta.
--    - clientes_clasificacion_determinacion_motivada: la determinación del
--      asesor exige nota (el porqué).
--    - clientes_clasificacion_203_solo_por_carta: 203 (Sofisticado) SOLO puede
--      venir de carta_firmada. El asesor no puede determinar a nadie como
--      Sofisticado (decisión de Claudio, 6-oct-2026). Junto con el anterior
--      CHECK de carta: 203 ⇔ carta_firmada.
--
-- REGLA DE NEGOCIO (decisión de Claudio, 6-oct-2026): TODO cliente debe tener
-- carta. Una clasificación NULL en un cliente vigente o inactivo es alerta roja
-- en la ficha y en /tabla (se construye en el paso 2). No es un CHECK: la
-- alerta existe precisamente para los que aún no la tienen.
--
-- HISTORIFICACIÓN: clientes NO tiene espejo, y este script no se lo crea. La
-- historia de estas cuatro columnas la guarda trg_bitacora (fn_bitacora): un
-- asiento por campo cambiado, con valor anterior y nuevo, usuario y fecha.
-- Un espejo de clientes duplicaría todos sus datos personales en otra tabla
-- para historificar cuatro columnas que la bitácora ya cubre.
--
-- clasificacion_fecha es la fecha en que se REGISTRA la clasificación en el
-- expediente, no la de firma de la carta: esa fecha no consta en el CRM. Mismo
-- criterio que clientes.fecha_baja. Así lo dice el COMMENT.
--
-- DECISIONES DE CLAUDIO SOBRE LOS QUE QUEDARON SIN DETERMINAR (6-oct-2026)
--
-- - CSPFU1889: inactivo, de salida. Se queda en NULL; se dará de baja con el
--   flujo cuando sea formal.
-- - CSPFU6473: alta abandonada, cuenta eliminada. Dado de baja desde la app
--   ANTES de este script (primera escritura real después del revoke del 5-oct).
-- - CSPFU1988: carta en proceso de firma; NULL hasta que conste. Lleva renglón
--   propio en el R03 aunque comparta cuenta con CSPMU7486: el R03 reporta
--   personas.
-- - CSPMU1160: baja desde el 30-sep.
-- - LEAD-35554 (prueba del formulario de captura) se eliminó antes de este
--   script: 2026-10-06-eliminar-lead-35554.sql.
--
-- VERIFICADO DESPUÉS DE EJECUTAR
--
-- Antes de producción, en la réplica PGlite (Postgres 17.5) con la cartera
-- real (solo códigos): las guardas detienen el script si hay una carta sin
-- liga o si la cartera cambió, sin dejar nada; re-ejecutarlo falla en su
-- guarda; la prueba con rollback (14C2b) detecta la falta de cualquiera de los
-- CHECK y no deja nada (huella idéntica).
--
-- En producción, en orden: 14A, 14B (Success), 14C1, 14C2a, 14C2b, 14C2c.
--
--   14C1: 5 CHECK y 4 COMMENT; 203/carta_firmada 31 (vigente 26, inactivo 4,
--   baja 1); sin determinar CSPFU1889, CSPFU1988, CSPFU6473, CSPMU1160; 204 = 0;
--   bitácora manual 31, de trigger 124 (4 campos × 31); 35 clientes.
--
--   14C2b: ok · rollback hecho · 203 por carta 31 · sin determinar 4
--   (sin carta 4) · 204 0
--
--   Huella de las 19 tablas de public, antes (14C2a) y después (14C2c):
--     403066f00faac1c47f332cc9f592a62c = 403066f00faac1c47f332cc9f592a62c
--
-- Y por MCP, el mismo día:
--
--   chequeo                                          resultado
--   4 columnas clasificacion_*, 4 COMMENT            presentes           ✓
--   5 CHECK clientes_clasificacion_*                 validados           ✓
--   203 sin carta / carta sin 203 / 204              0 / 0 / 0           ✓
--   sin determinar                                   CSPFU1889, CSPFU1988,
--                                                    CSPFU6473, CSPMU1160 ✓
--   fecha de clasificación                           2026-10-06 (una)    ✓
--   restos de 14C2b (201/202/204 o determinación)    0                   ✓
--   bitácora manual / de trigger                     31 / 124            ✓
--   bitácora total desde el revoke del 5-oct         160 = 4 + 1 + 31 + 124 ✓
--   tablas public · secuencias                       19 · 0              ✓
--
-- Los asientos de este script dicen sql_directo: se corrió desde el SQL
-- Editor, sin JWT. Que trg_bitacora dispara también para `authenticated` sin
-- EXECUTE sobre fn_bitacora quedó probado ese mismo día con la baja de
-- CSPFU6473 desde la app: ver 2026-10-05-revoke-execute-funciones-trigger.sql.
-- ===========================================================================

begin;

-- --- 1 · Guardas -------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'clientes'
                and column_name like 'clasificacion_%') then
    raise exception 'Ya existen columnas clasificacion_* en clientes.';
  end if;
  if exists (select 1 from clientes where carta_sofisticado_firmada is true
                                      and carta_sofisticado_url is null) then
    raise exception 'Hay cartas marcadas como firmadas sin liga al documento: revisar antes de clasificar.';
  end if;
  if (select count(*) from clientes where carta_sofisticado_firmada is true) <> 31 then
    raise exception 'No son 31 los clientes con carta firmada; la cartera cambió desde la propuesta.';
  end if;
end $$;

-- --- 2 · Columnas ------------------------------------------------------------
alter table public.clientes
  add column clasificacion_inversionista text,
  add column clasificacion_fuente        text,
  add column clasificacion_fecha         date,
  add column clasificacion_nota          text;

comment on column public.clientes.clasificacion_inversionista is
  'Clasificación del inversionista para el R03 J-0315, campo 6 (catálogo CNBV): '
  '201 Institucional, 202 Calificado, 203 Sofisticado, 204 Ninguno. NULL = no '
  'determinada, que NO es lo mismo que 204. El sistema la lee de aquí; nunca la asume.';
comment on column public.clientes.clasificacion_fuente is
  'De dónde sale la clasificación: carta_firmada (carta del Anexo 1 Apartado A en '
  'expediente; solo con 203 y carta_sofisticado_firmada = true) o '
  'determinacion_asesor (con nota obligatoria). Va con la clasificación o ninguna.';
comment on column public.clientes.clasificacion_fecha is
  'Fecha en que se REGISTRA la clasificación en el expediente, no necesariamente la '
  'de firma de la carta, que no consta en el CRM. Va con la clasificación o ninguna.';
comment on column public.clientes.clasificacion_nota is
  'El porqué. Obligatoria si la fuente es determinacion_asesor.';

-- --- 3 · Backfill, sin inventar ------------------------------------------------
-- Fecha de registro en hora de CDMX: de noche, current_date en UTC ya sería
-- mañana.
update public.clientes
   set clasificacion_inversionista = '203',
       clasificacion_fuente        = 'carta_firmada',
       clasificacion_fecha         = (now() at time zone 'America/Mexico_City')::date,
       clasificacion_nota          =
         'Carta de cliente sofisticado (Anexo 1 Apartado A) en expediente: '
         'carta_sofisticado_firmada = true, con liga al documento. La fecha de firma '
         'de la carta no consta en el CRM; clasificacion_fecha es la de registro.'
 where carta_sofisticado_firmada is true;

-- --- 4 · Asientos manuales de bitácora ---------------------------------------
insert into public.bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo,
                             motivo, usuario, origen, metadata)
select 'clientes', codigo_cliente, 'clasificacion_inversionista', 'clasificacion_inversionista',
       null, '203',
       'Clasificación 203 (Sofisticado) por carta del Anexo 1 Apartado A en expediente. '
       'Backfill del #14: solo se clasificó a quien tiene carta; el resto queda sin '
       'determinar (NULL), no como 204.',
       'sql_directo', 'migracion',
       jsonb_build_object('fuente', 'carta_firmada',
                          'campo_r03', 'R03 J-0315, campo 6',
                          'script', '2026-10-06-clasificacion-inversionista.sql')
  from public.clientes
 where clasificacion_fuente = 'carta_firmada';

-- --- 5 · Los invariantes, al final ---------------------------------------------
-- Escritos con `is null` a los dos lados: un CHECK pasa cuando la expresión da
-- NULL, y la forma con `and` sueltos dejaría entrar justo los estados
-- incompletos que existe para impedir (ver 2026-09-10-procedencia-art-17.sql).
alter table public.clientes
  add constraint clientes_clasificacion_valida check (
       clasificacion_inversionista is null
    or clasificacion_inversionista in ('201', '202', '203', '204')),
  add constraint clientes_clasificacion_procedencia check (
        (clasificacion_inversionista is null) = (clasificacion_fuente is null)
    and (clasificacion_inversionista is null) = (clasificacion_fecha is null)
    and (clasificacion_fuente is null
         or clasificacion_fuente in ('carta_firmada', 'determinacion_asesor'))),
  add constraint clientes_clasificacion_carta check (
       clasificacion_fuente is distinct from 'carta_firmada'
    or (clasificacion_inversionista = '203' and carta_sofisticado_firmada is true)),
  add constraint clientes_clasificacion_determinacion_motivada check (
       clasificacion_fuente is distinct from 'determinacion_asesor'
    or (clasificacion_nota is not null and btrim(clasificacion_nota) <> '')),
  add constraint clientes_clasificacion_203_solo_por_carta check (
       clasificacion_inversionista is distinct from '203'
    or clasificacion_fuente = 'carta_firmada');

-- --- 6 · Verificación dentro de la transacción --------------------------------
do $$
begin
  if (select count(*) from clientes where clasificacion_inversionista = '203'
                                      and clasificacion_fuente = 'carta_firmada') <> 31 then
    raise exception 'No quedaron exactamente 31 clientes en 203 por carta.';
  end if;
  -- Sin determinar = exactamente los que no tienen carta, sean cuantos sean
  -- (la baja de CSPFU6473 o el DELETE de LEAD-35554 pueden correr antes).
  if (select count(*) from clientes where clasificacion_inversionista is null)
     <> (select count(*) from clientes where carta_sofisticado_firmada is not true) then
    raise exception 'Los sin determinar no son exactamente los clientes sin carta.';
  end if;
  if exists (select 1 from clientes where clasificacion_inversionista = '204') then
    raise exception 'El backfill no debe producir ningún 204.';
  end if;
  if (select count(*) from bitacora where origen = 'migracion'
        and accion = 'clasificacion_inversionista') <> 31 then
    raise exception 'No quedaron los 31 asientos manuales.';
  end if;
end $$;

commit;

-- --- Verificación · 14C1, se corrió aparte después del commit ----------------
--
-- select 'columnas clasificacion_* en clientes' as chequeo,
--        coalesce((select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
--                    from information_schema.columns
--                   where table_schema = 'public' and table_name = 'clientes'
--                     and column_name like 'clasificacion_%'), '—') as valor
-- union all
-- select 'CHECK clientes_clasificacion_*',
--        coalesce((select string_agg(conname, ', ' order by conname) from pg_constraint
--                   where conrelid = 'public.clientes'::regclass and contype = 'c'
--                     and conname like 'clientes_clasificacion_%'), '—')
-- union all
-- select 'COMMENT en las 4 columnas',
--        (select count(*) from pg_attribute
--          where attrelid = 'public.clientes'::regclass and attname like 'clasificacion_%'
--            and col_description(attrelid, attnum) is not null)::text
-- union all
-- select 'carta true / false / null',
--        (select count(*) filter (where carta_sofisticado_firmada is true) || ' / ' ||
--                count(*) filter (where carta_sofisticado_firmada is false) || ' / ' ||
--                count(*) filter (where carta_sofisticado_firmada is null) from clientes)
-- union all
-- select 'carta true sin liga', (select count(*) from clientes
--                                 where carta_sofisticado_firmada is true and carta_sofisticado_url is null)::text
-- union all
-- select 'clasificación · ' || s.status,
--        (select coalesce(string_agg(k || ' ' || n, ' · ' order by k), '—') from (
--           select coalesce((to_jsonb(c) ->> 'clasificacion_inversionista') || '/' ||
--                           (to_jsonb(c) ->> 'clasificacion_fuente'), 'sin determinar') k, count(*) n
--             from clientes c where c.status = s.status group by 1) x)
--   from (select distinct status from clientes) s
-- union all
-- select 'sin determinar (códigos)',
--        coalesce((select string_agg(codigo_cliente, ', ' order by codigo_cliente) from clientes c
--                   where to_jsonb(c) ->> 'clasificacion_inversionista' is null), '—')
-- union all
-- select '204 (no debe haber ninguno)',
--        (select count(*) from clientes c where to_jsonb(c) ->> 'clasificacion_inversionista' = '204')::text
-- union all
-- select 'bitácora manual clasificacion_inversionista',
--        (select count(*) from bitacora where origen = 'migracion' and accion = 'clasificacion_inversionista')::text
-- union all
-- select 'bitácora de trigger sobre clasificacion_*',
--        (select count(*) from bitacora where origen = 'trigger' and entidad = 'clientes'
--            and campo like 'clasificacion_%')::text
-- union all
-- select 'triggers en clientes', (select string_agg(tgname, ', ') from pg_trigger
--                                  where tgrelid = 'public.clientes'::regclass and not tgisinternal)
-- union all
-- select 'total clientes', (select count(*) from clientes)::text;
