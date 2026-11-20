-- ===========================================================================
-- CSPFU8588 cuenta propia del Asesor · baja de contrato de CSPFU8085
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: solo códigos.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026).
--
-- Réplica del repo (datos sintéticos): ensayo sin rastro; real (CSPFU8588
-- propia, CSPFU8085 baja al 2026-11-19, histórico 0 → 1, 6 asientos);
-- re-ejecución detenida en la guarda. Seis mutaciones, cada una detenida por su
-- razón: baja también a otro cliente, es_propia a todas las cuentas, otra fecha,
-- cerrar además la cuenta en IBKR, sin el asiento manual de la baja y otro campo
-- del cliente tocado.
-- Semáforo en seco ANTES (foto del 19-nov, motor 1.2.0): CSPFU8588 ÁMBAR,
-- CSPFU8085 INACTIVA, 27 cuentas en el universo.
-- Ensayo en producción, 20-nov-2026 (ROLLBACK, código de salida 0, md5 del archivo
-- ensayado a6d036d8c6ae88d9babe51a74e44b2cf, que solo difiere de este en esta
-- cabecera): CSPFU8588 es_propia = true, CSPFU8085 baja 2026-11-19, histórico
-- 4 → 5, bitácora 1860 → 1866. Verificado después por MCP: es_propia false,
-- CSPFU8085 vigente, histórico en 4, bitácora en 1860.
--
-- POR QUÉ (decisiones de Claudio del 20-nov-2026)
--
-- 1. CSPFU8588 (conjunta) es cuenta propia: «dinero mío». Cambia la decisión del
--    13-nov (quedó en false). La conjunta con CSPFU8488 sigue en la consulta a
--    Erick sobre el R03; esta migración no la toca.
-- 2. CSPFU8085: baja de contrato. Fecha de solicitud 2026-11-19; motivo «Retiro de
--    recursos y cierre solicitados por el cliente.» La fecha de CIERRE en IBKR
--    (cuentas_ibkr.fecha_cierre) va después, cuando IBKR cierre la cuenta.
--    Efectos esperados: deja de cargarse en la foto y de evaluarse en el
--    semáforo; mientras IBKR no la cierre saldrá como «baja abierta» en los
--    descuadres; cuenta como baja del semestre para el R03.
--
-- QUÉ HACE
--
-- UPDATE de cuentas_ibkr (CSPFU8588: es_propia = true) y de clientes (CSPFU8085:
-- status baja, fecha_baja, motivo_baja), con el mismo asiento manual que deja la
-- ruta /api/dar-baja (accion 'baja', campo status, de vigente a baja, con el
-- motivo) y uno para es_propia. Los triggers archivan la versión anterior de la
-- cuenta y asientan cada campo. Nada más cambia.
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
  if (select count(*) from public.cuentas_ibkr where codigo_cliente = 'CSPFU8588' and tipo = 'conjunta'
        and es_propia = false and fecha_cierre is null) <> 1 then
    raise exception 'guarda: CSPFU8588 no existe como conjunta, ya es propia o está cerrada; el script no es re-ejecutable.';
  end if;
  if (select count(*) from public.clientes where codigo_cliente = 'CSPFU8085' and status = 'vigente'
        and fecha_baja is null and motivo_baja is null) <> 1 then
    raise exception 'guarda: CSPFU8085 no está vigente sin baja; el script no es re-ejecutable.';
  end if;
  if exists (select 1 from public.cuentas_ibkr where codigo_cliente = 'CSPFU8085' and fecha_cierre is not null) then
    raise exception 'guarda: la cuenta de CSPFU8085 ya tiene fecha de cierre: revisar antes.';
  end if;
  if exists (select 1 from public.cliente_bloqueos where codigo_cliente in ('CSPFU8085', 'CSPFU8588') and levantado_en is null) then
    raise exception 'guarda: hay un bloqueo activo en CSPFU8085 o CSPFU8588.';
  end if;
  if date '2026-11-19' > (now() at time zone 'America/Mexico_City')::date then
    raise exception 'guarda: la fecha de solicitud no puede ser futura.';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select count(*) from public.bitacora) as bitacora,
       (select count(*) from public.cuentas_ibkr_historico) as historico,
       (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.cuentas_ibkr x where x.codigo_cliente <> 'CSPFU8588') as otras_cuentas,
       (select (to_jsonb(x) - 'es_propia')::text from public.cuentas_ibkr x where x.codigo_cliente = 'CSPFU8588') as cuenta_8588,
       (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.clientes x where x.codigo_cliente <> 'CSPFU8085') as otros_clientes,
       (select (to_jsonb(x) - array['status', 'fecha_baja', 'motivo_baja'])::text from public.clientes x where x.codigo_cliente = 'CSPFU8085') as cliente_8085;

-- --- 1 · CSPFU8588: cuenta propia ---------------------------------------------------------
update public.cuentas_ibkr set es_propia = true where codigo_cliente = 'CSPFU8588' and tipo = 'conjunta';

insert into public.bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, motivo, usuario, origen, metadata)
values ('cuentas_ibkr', 'CSPFU8588', 'es_propia', 'es_propia', 'false', 'true',
        'Decisión de Claudio del 20-nov-2026: cuenta propia del Asesor (dinero suyo). Cambia la decisión del 13-nov. '
        'La conjunta con CSPFU8488 sigue en la consulta a Erick sobre el R03.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-20-02-propia-8588-y-baja-8085.sql'));

-- --- 2 · CSPFU8085: baja de contrato (como /api/dar-baja) ----------------------------------
update public.clientes
   set status = 'baja', fecha_baja = date '2026-11-19',
       motivo_baja = 'Retiro de recursos y cierre solicitados por el cliente.'
 where codigo_cliente = 'CSPFU8085' and status = 'vigente';

insert into public.bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, motivo, usuario, origen, metadata)
values ('clientes', 'CSPFU8085', 'baja', 'status', 'vigente', 'baja',
        'Retiro de recursos y cierre solicitados por el cliente.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-20-02-propia-8588-y-baja-8085.sql',
                           'fecha_solicitud', '2026-11-19', 'cierre_ibkr', 'pendiente: cuentas_ibkr.fecha_cierre cuando IBKR cierre'));

-- --- 3 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select es_propia from public.cuentas_ibkr where codigo_cliente = 'CSPFU8588') is not true
     or (select (to_jsonb(x) - 'es_propia')::text from public.cuentas_ibkr x where x.codigo_cliente = 'CSPFU8588')
          is distinct from (select cuenta_8588 from _antes)
     or (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.cuentas_ibkr x where x.codigo_cliente <> 'CSPFU8588')
          is distinct from (select otras_cuentas from _antes) then
    raise exception 'verificación: cuentas_ibkr cambió más allá de es_propia de CSPFU8588.';
  end if;
  if (select status || '|' || fecha_baja || '|' || motivo_baja from public.clientes where codigo_cliente = 'CSPFU8085')
       is distinct from 'baja|2026-11-19|Retiro de recursos y cierre solicitados por el cliente.'
     or (select (to_jsonb(x) - array['status', 'fecha_baja', 'motivo_baja'])::text from public.clientes x where x.codigo_cliente = 'CSPFU8085')
          is distinct from (select cliente_8085 from _antes)
     or (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.clientes x where x.codigo_cliente <> 'CSPFU8085')
          is distinct from (select otros_clientes from _antes)
     or exists (select 1 from public.cuentas_ibkr where codigo_cliente = 'CSPFU8085' and fecha_cierre is not null) then
    raise exception 'verificación: clientes cambió más allá de la baja de CSPFU8085, o se tocó su cierre.';
  end if;
  if (select count(*) from public.cuentas_ibkr_historico) <> (select historico from _antes) + 1
     or (select es_propia from public.cuentas_ibkr_historico where codigo_cliente = 'CSPFU8588' and archivado_en = now()) is not false then
    raise exception 'verificación: el histórico no tiene la versión anterior de CSPFU8588 (es_propia false).';
  end if;
  -- 1 asiento del trigger por es_propia, 3 por la baja (status, fecha_baja, motivo_baja) y 2 manuales.
  if (select count(*) from public.bitacora where created_at = now()) <> 6
     or (select count(*) from public.bitacora where created_at = now() and origen = 'trigger') <> 4
     or (select count(*) from public.bitacora) <> (select bitacora from _antes) + 6
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: la bitácora no tiene 4 asientos del trigger + 2 manuales con el usuario pasado.';
  end if;
end $$;

select (select codigo_cliente || ' es_propia=' || es_propia from public.cuentas_ibkr where codigo_cliente = 'CSPFU8588') as propia,
       (select codigo_cliente || ' ' || status || ' ' || fecha_baja from public.clientes where codigo_cliente = 'CSPFU8085') as baja,
       ((select historico from _antes) || ' → ' || (select count(*) from public.cuentas_ibkr_historico)) as historico,
       ((select bitacora from _antes) || ' → ' || (select count(*) from public.bitacora)) as bitacora;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
