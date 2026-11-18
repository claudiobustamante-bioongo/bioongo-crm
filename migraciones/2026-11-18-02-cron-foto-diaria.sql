-- ===========================================================================
-- M2 fase 2 · cron de la foto diaria automática (pg_net + pg_cron)
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales ni secretos: la llave se lee de Vault en cada ejecución.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026).
--
-- NO se replica en PGlite (pg_cron, pg_net y Vault no existen ahí): su prueba es
-- el ensayo en producción con ROLLBACK.
-- Ensayo en producción, 18-nov-2026: el primero se detuvo en la guarda (código 3,
-- dentro de la transacción) porque la referencia estática a cron.job no se puede
-- preparar sin pg_cron; se pasó a SQL dinámico. El segundo (ROLLBACK, código de
-- salida 0, md5 del archivo ensayado ac9173be141799d6f5c34e8abeaf3dd5, que solo
-- difiere de este en esta cabecera): guardas superadas (01 corrida, secreto de
-- Vault ≥ 32, cron.timezone UTC), extensiones creadas, ibkr-foto-diaria
-- */20 12-13 * * 1-5 y ibkr-foto-diaria-control 0 14 * * 1-5, activos; la llave
-- NO aparece en el comando; un asiento. Verificado después por MCP: pg_cron y
-- pg_net sin instalar, sin esquemas cron ni net, bitácora en 1848, 0 eventos.
-- Antes: la función desplegada (empaqueta lib/), 401 sin llave, 405 por GET, los
-- cuatro secretos y foto_cron_llave en Vault, y la invocación en seco (HTTP 200,
-- foto y FIX del 17-nov ya_cargado, sin escrituras: verificado por MCP).
--
-- REQUISITOS (la guarda los exige; si falta uno, se detiene)
--
-- - Migración 2026-11-18-01 corrida (fn_control_foto_diaria existe).
-- - La Edge Function ibkr-foto-diaria desplegada, con sus secretos, y probada en
--   seco (?modo=seco) sin escrituras. Esto la guarda no lo puede comprobar desde
--   SQL: lo confirma Claudio antes de aprobar el real.
-- - El secreto de Vault «foto_cron_llave» (≥ 32 caracteres), con el MISMO valor
--   que FOTO_CRON_LLAVE en los secretos de la función. Lo da de alta Claudio.
-- - cron.timezone = GMT/UTC (los horarios de abajo están en UTC).
--
-- QUÉ HACE
--
-- 1. pg_net (esquema extensions) y pg_cron, si no están.
-- 2. «ibkr-foto-diaria»: */20 12-13 * * 1-5 UTC = 06:00 a 07:40 CDMX (UTC−6 todo
--    el año), lunes a viernes: POST a la función con la llave de Vault en
--    x-foto-cron-llave. pg_net no espera la respuesta: cada ejecución deja su
--    rastro en ibkr_cron_eventos.
-- 3. «ibkr-foto-diaria-control»: 0 14 * * 1-5 UTC = 08:00 CDMX:
--    public.fn_control_foto_diaria().
-- Cómo pausarlo o quitarlo: docs/ESPEC_IBKR_Flex.md §7.3.
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
declare
  v_hay boolean := false;
begin
  if to_regprocedure('public.fn_control_foto_diaria()') is null or to_regclass('public.ibkr_cron_eventos') is null then
    raise exception 'guarda: falta la migración 2026-11-18-01 (funciones de sistema y eventos).';
  end if;
  -- Dinámico: sin pg_cron, cron.job no existe y una referencia estática no se podría ni preparar.
  if to_regclass('cron.job') is not null then
    execute $q$select exists (select 1 from cron.job where jobname in ('ibkr-foto-diaria', 'ibkr-foto-diaria-control'))$q$
      into v_hay;
  end if;
  if v_hay then
    raise exception 'guarda: los programas del cron ya existen; el script no es re-ejecutable.';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'foto_cron_llave' and length(decrypted_secret) >= 32) then
    raise exception 'guarda: falta el secreto de Vault foto_cron_llave (≥ 32 caracteres).';
  end if;
  if coalesce(current_setting('cron.timezone', true), 'GMT') not in ('GMT', 'UTC', 'Etc/UTC') then
    raise exception 'guarda: cron.timezone no es UTC; los horarios estarían corridos.';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select count(*) from public.bitacora) as bitacora;

-- --- 1 · Extensiones ------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- --- 2 · Programas -------------------------------------------------------------------------
select cron.schedule('ibkr-foto-diaria', '*/20 12-13 * * 1-5', $cmd$
  select net.http_post(
    url := 'https://lhcubjjqmwwswywtihpe.supabase.co/functions/v1/ibkr-foto-diaria',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-foto-cron-llave', (select decrypted_secret from vault.decrypted_secrets where name = 'foto_cron_llave')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$cmd$) is not null as programado_foto;

select cron.schedule('ibkr-foto-diaria-control', '0 14 * * 1-5',
  'select public.fn_control_foto_diaria()') is not null as programado_control;

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'cron_foto_diaria', 'migracion',
        'M2 fase 2: pg_net y pg_cron; la foto diaria automática cada 20 min de 06:00 a 07:40 CDMX (L-V) y el control '
        'de las 08:00. Diseño aprobado por Claudio (Día 62; ajustes del 18-nov-2026).',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-18-02-cron-foto-diaria.sql'));

-- --- 3 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select string_agg(jobname || ' ' || schedule || ' ' || active, '; ' order by jobname) from cron.job
       where jobname in ('ibkr-foto-diaria', 'ibkr-foto-diaria-control'))
     is distinct from 'ibkr-foto-diaria */20 12-13 * * 1-5 true; ibkr-foto-diaria-control 0 14 * * 1-5 true' then
    raise exception 'verificación: los programas no quedaron con sus horarios, o no están activos.';
  end if;
  if exists (select 1 from cron.job j, vault.decrypted_secrets s
              where s.name = 'foto_cron_llave' and position(s.decrypted_secret in j.command) > 0) then
    raise exception 'verificación: la llave quedó escrita en el comando del cron (debe leerse de Vault).';
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    raise exception 'verificación: pg_net no expone net.http_post con la firma esperada.';
  end if;
  if (select count(*) from public.bitacora) <> (select bitacora from _antes) + 1 then
    raise exception 'verificación: la bitácora no tiene solo el asiento manual.';
  end if;
end $$;

select jobname, schedule, active from cron.job
 where jobname in ('ibkr-foto-diaria', 'ibkr-foto-diaria-control') order by jobname;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
