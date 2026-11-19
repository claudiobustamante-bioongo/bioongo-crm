-- ===========================================================================
-- v_comite_cartera: para una misma foto, la evaluación de la versión MÁS ALTA del motor
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: solo esquema.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026).
--
-- Réplica del repo (npm run replica, datos sintéticos): ensayo sin rastro; real
-- (1 fila, 1.1.0, un asiento); re-ejecución detenida en la guarda (md5 de la
-- vista). Cuatro mutaciones, cada una detenida por su razón: versión ordenada
-- como texto, sin ordenar por versión (como el 16-nov), la versión antes que la
-- fecha de la foto y la vista sin security_invoker. La autoprueba registra una
-- versión vieja DESPUÉS de una nueva (9.0.0 tras 10.0.0) y exige la nueva.
-- Ensayos en producción, 19-nov-2026, ambos con ROLLBACK y código de salida 0:
-- el primero con regexp_replace (antes de los registros 1.2.0); el segundo, con
-- split_part como pidió Claudio y ya con 1.1.0 y 1.2.0 en las tres fotos (md5 del
-- archivo ensayado d37972cab98c58dca39fe38dcf0da773, que solo difiere de este en
-- esta cabecera): 27 filas, todas semaforo-1.2.0 (la misma vista que antes con
-- los datos de hoy: lo comprueba la verificación); bitácora 1855 → 1856.
-- Verificado después por MCP: vista intacta (md5), bitácora en 1855, 162
-- evaluaciones.
--
-- POR QUÉ
--
-- Pedido de Claudio del 19-nov-2026, antes de registrar el semáforo 1.2.0 de
-- fotos que ya tienen el 1.1.0: la vista (migración 2026-11-16-01) toma, por
-- cuenta, la foto más reciente y, dentro de ella, la evaluación REGISTRADA más
-- tarde (evaluado_en). Si una versión vieja se registra después de una nueva
-- (p. ej. el cron aún con 1.1.0 tras un registro manual 1.2.0 de la misma foto),
-- el comité vería la vieja. Y ordenar la versión como texto pondría
-- semaforo-1.10.0 detrás de semaforo-1.9.0.
--
-- QUÉ HACE
--
-- Reemplaza la vista con el mismo SELECT y las mismas columnas; solo cambia el
-- orden del DISTINCT ON: fecha_foto desc, versión del motor COMO NÚMEROS desc
-- (string_to_array(split_part(version_motor, '-', 2), '.')::int[]; el CHECK garantiza
-- ^semaforo-N.N.N$), evaluado_en desc como desempate. Conserva
-- security_invoker y los grants (create or replace). No toca datos.
-- ===========================================================================

\if :{?modo} \else
  DO $$ BEGIN RAISE EXCEPTION 'Falta -v modo=ensayo o -v modo=real'; END $$;
\endif
\if :{?usuario} \else
  DO $$ BEGIN RAISE EXCEPTION 'Falta -v usuario=<correo>'; END $$;
\endif
SELECT :'modo' IN ('ensayo', 'real') AS modo_valido,
       :'modo' = 'real'               AS es_real,
       :'usuario' ~ '^[^@\s]+@[^@\s]+\.[a-z]+$' AS usuario_valido \gset
\if :modo_valido \else
  DO $$ BEGIN RAISE EXCEPTION 'modo debe ser ensayo o real'; END $$;
\endif
\if :usuario_valido \else
  DO $$ BEGIN RAISE EXCEPTION 'usuario no parece un correo'; END $$;
\endif

BEGIN;
SELECT set_config('request.jwt.claims',
                  json_build_object('email', :'usuario', 'canal', 'psql')::text, true) IS NOT NULL AS claims;

-- <<CUERPO
-- --- 0 · Guardas ---------------------------------------------------------------
do $$
begin
  if (select md5(pg_get_viewdef('public.v_comite_cartera'::regclass, true))) is distinct from '5b9ba96d6bebdd82095d1214e36120b8' then
    raise exception 'guarda: v_comite_cartera no es la versión del 16-nov (md5); el script no es re-ejecutable.';
  end if;
  if not exists (select 1 from public.semaforo_evaluaciones e join public.cuentas_ibkr ci using (cuenta_ibkr)) then
    raise exception 'guarda: la autoprueba necesita al menos una evaluación registrada.';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select count(*) from public.bitacora) as bitacora,
       (select count(*) from public.semaforo_evaluaciones) as evaluaciones,
       (select md5(string_agg(to_jsonb(v)::text, '' order by v.codigo_cliente)) from public.v_comite_cartera v) as vista;

-- --- 1 · La vista -------------------------------------------------------------------------
create or replace view public.v_comite_cartera with (security_invoker = true) as
select ci.codigo_cliente,
       ci.tipo,
       ci.es_propia,
       e.fecha_foto,
       e.estado,
       e.metricas ->> 'moneda_base' as moneda_base,
       (e.metricas ->> 'nav_base')::numeric as nav_base,
       (e.metricas ->> 'nav_mxn')::numeric as nav_mxn,
       e.perfil_aplicado ->> 'perfil' as perfil,
       e.perfil_aplicado ->> 'origen' as origen_perfil,
       (select count(*) from jsonb_array_elements(e.hallazgos) h(value) where h.value ->> 'severidad' = 'critico') as criticos,
       (select count(*) from jsonb_array_elements(e.hallazgos) h(value) where h.value ->> 'severidad' = 'incumple') as incumplimientos,
       (select count(*) from jsonb_array_elements(e.hallazgos) h(value) where h.value ->> 'severidad' = 'aviso') as avisos,
       jsonb_array_length(e.ips_pendiente) > 0 as actualizacion_ips_pendiente,
       e.version_motor,
       e.evaluado_en
  from (select distinct on (s.cuenta_ibkr) s.*
          from public.semaforo_evaluaciones s
         order by s.cuenta_ibkr, s.fecha_foto desc,
                  string_to_array(split_part(s.version_motor, '-', 2), '.')::int[] desc,
                  s.evaluado_en desc) e
  join public.cuentas_ibkr ci using (cuenta_ibkr);

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'v_comite_cartera', 'migracion',
        'v_comite_cartera: dentro de una misma foto, la evaluación de la versión más alta del motor (comparada como '
        'números), no la registrada más tarde. Pedido de Claudio del 19-nov-2026, antes del registro 1.2.0.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-19-01-vista-comite-version.sql'));

-- --- 2 · Autoprueba (se revierte entera con IBOK0) ----------------------------------
do $$
declare
  v_cuenta text;
  v_sync   uuid;
  v_fecha  date;
  v_codigo text;
begin
  select e.cuenta_ibkr, e.sync_id, e.fecha_foto, ci.codigo_cliente into v_cuenta, v_sync, v_fecha, v_codigo
    from public.semaforo_evaluaciones e join public.cuentas_ibkr ci using (cuenta_ibkr)
   order by e.fecha_foto desc, e.cuenta_ibkr limit 1;
  begin
    -- La 10.0.0 se registra ANTES que la 9.0.0: la vista debe mostrar la 10.0.0 (más alta, y no por texto).
    insert into public.semaforo_evaluaciones (sync_id, fecha_foto, cuenta_ibkr, estado, version_motor, evaluado_por, evaluado_en)
    values (v_sync, v_fecha, v_cuenta, 'EXENTO', 'semaforo-10.0.0', 'autoprueba', now() - interval '1 minute'),
           (v_sync, v_fecha, v_cuenta, 'EXENTO', 'semaforo-9.0.0', 'autoprueba', now());
    if (select version_motor from public.v_comite_cartera where codigo_cliente = v_codigo) is distinct from 'semaforo-10.0.0' then
      raise exception 'autoprueba: la vista no mostró la versión más alta (10.0.0 sobre 9.0.0).' using errcode = 'IBFAL';
    end if;
    -- Una foto más reciente gana aunque su versión sea menor.
    insert into public.semaforo_evaluaciones (sync_id, fecha_foto, cuenta_ibkr, estado, version_motor, evaluado_por)
    values (v_sync, v_fecha + 1, v_cuenta, 'EXENTO', 'semaforo-0.0.1', 'autoprueba');
    if (select version_motor || '|' || fecha_foto from public.v_comite_cartera where codigo_cliente = v_codigo)
       is distinct from 'semaforo-0.0.1|' || (v_fecha + 1) then
      raise exception 'autoprueba: una foto más reciente no ganó sobre una versión más alta de la anterior.' using errcode = 'IBFAL';
    end if;
    raise exception 'autoprueba completa' using errcode = 'IBOK0';
  exception when sqlstate 'IBOK0' then null;
  end;
end $$;

-- --- 3 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select md5(pg_get_viewdef('public.v_comite_cartera'::regclass, true))) = '5b9ba96d6bebdd82095d1214e36120b8' then
    raise exception 'verificación: la vista no cambió.';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.v_comite_cartera'::regclass and reloptions @> array['security_invoker=true'])
     or not has_table_privilege('authenticated', 'public.v_comite_cartera', 'select')
     or not has_table_privilege('service_role', 'public.v_comite_cartera', 'select')
     or has_table_privilege('anon', 'public.v_comite_cartera', 'select') then
    raise exception 'verificación: security_invoker o privilegios de la vista no son los de antes.';
  end if;
  -- Hoy cada foto tiene una sola versión: lo que muestra la vista no debe cambiar.
  if (select md5(string_agg(to_jsonb(v)::text, '' order by v.codigo_cliente)) from public.v_comite_cartera v)
       is distinct from (select vista from _antes)
     or (select count(*) from public.semaforo_evaluaciones) <> (select evaluaciones from _antes) then
    raise exception 'verificación: la vista muestra otra cosa con los datos de hoy, o quedaron filas de la autoprueba.';
  end if;
  if (select count(*) from public.bitacora) <> (select bitacora from _antes) + 1 then
    raise exception 'verificación: la bitácora no tiene solo el asiento manual.';
  end if;
end $$;

select (select count(*) from public.v_comite_cartera)::text as filas_vista,
       (select string_agg(distinct version_motor, ',') from public.v_comite_cartera) as versiones,
       ((select bitacora from _antes) || ' → ' || (select count(*) from public.bitacora)) as bitacora;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
