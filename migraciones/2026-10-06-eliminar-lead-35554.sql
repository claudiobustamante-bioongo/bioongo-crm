-- ===========================================================================
-- Eliminar LEAD-35554 · registro de prueba del formulario de captura
--
-- EJECUTADO el 6 de octubre de 2026 por Claudio Bustamante, a mano, en el SQL
-- Editor de Supabase, en dos pasos: E1_antes_LEAD-35554.sql (solo lectura, md5
-- a32549121d93c270646a18f2455e66c5) y E2_eliminar_LEAD-35554.sql (md5
-- 756fe83d1e2c3d5bf26f44630ce17559). Desde el `begin` hasta el final, este
-- archivo es byte a byte el E2 ejecutado; solo cambió la cabecera. La consulta
-- de E1 es la misma que cierra este archivo.
--
-- QUÉ ERA (verificado por MCP antes de borrar, sin leer valores personales)
--
-- - Creado el 2026-08-11 19:39 UTC, el mismo día del commit e048c61 «Día 26:
--   formulario público de captura de leads». El código LEAD-##### es el que
--   genera app/captura (aleatorio de 5 dígitos).
-- - status lead_nuevo; solo nombre, correo y celular. Sin RFC, CURP, cuenta
--   IBKR ni fecha_lead. Cero filas hijas, no era cotitular de nadie, sin alias,
--   nada en los espejos, cero asientos en bitácora (era anterior a
--   trg_bitacora, Día 38).
-- Decisión de Claudio, 6-oct-2026: es una prueba; se elimina.
--
-- CÓMO
--
-- Hijas del expediente primero (siete tablas, vacías para este código), y
-- clientes al final, en una transacción. Las tablas de EVIDENCIA de
-- cumplimiento —ebr_evaluaciones, listas_coincidencias, cliente_bloqueos,
-- firmas_cumplimiento— no se borran nunca: la guarda abortaba si alguna tenía
-- una fila.
--
-- LA BITÁCORA NO SE TOCÓ, Y EL TRIGGER SE DEJÓ ACTIVO · decisión de Claudio
--
-- trg_bitacora escribió el asiento 'delete' con la fila completa en
-- `metadata`: nombre, correo y celular de la prueba incluidos. Se dejó así a
-- propósito: un DELETE sin auditoría es peor que conservar los datos de una
-- prueba en la bitácora.
--
-- VERIFICADO DESPUÉS DE EJECUTAR
--
-- Antes de producción, en la réplica PGlite (Postgres 17.5): E2 se detiene si
-- el lead tiene una coincidencia, deja exactamente un asiento 'delete' de
-- clientes, y re-ejecutarlo se detiene en su guarda. En la réplica se corrigió
-- un defecto del borrador: la verificación interna contaba asientos 'delete'
-- de ese código en cualquier entidad; ahora cuenta solo los de clientes.
--
-- En producción:
--   E1  clientes 1, todas las hijas 0, bitácora 0, total 36.
--   E2  clientes 0 en todas las tablas, bitácora 1, total 35.
--
-- Y por MCP, el mismo día:
--   LEAD-35554 en clientes / en las 11 tablas hijas ....... 0 / 0      ✓
--   bitácora de LEAD-35554 ..... 1: clientes · delete · trigger ·
--                                sql_directo · 2026-10-06 19:51:54 UTC  ✓
--   total clientes ............................................ 35     ✓
--
-- `usuario` dice sql_directo porque se corrió desde el SQL Editor, sin JWT. La
-- prueba de que trg_bitacora dispara para `authenticated` sin EXECUTE sobre
-- fn_bitacora es la baja de CSPFU6473 de ese mismo día: ver
-- 2026-10-05-revoke-execute-funciones-trigger.sql.
-- ===========================================================================

begin;

-- --- 1 · Guardas -------------------------------------------------------------
do $$
begin
  if (select count(*) from clientes where codigo_cliente = 'LEAD-35554' and status = 'lead_nuevo'
        and coalesce(cuenta_ibkr, '') = '' and coalesce(rfc, '') = '' and coalesce(curp, '') = '') <> 1 then
    raise exception 'LEAD-35554 no está como se verificó (lead_nuevo, sin cuenta, RFC ni CURP).';
  end if;
  if exists (select 1 from ebr_evaluaciones     where codigo_cliente = 'LEAD-35554')
  or exists (select 1 from listas_coincidencias where codigo_cliente = 'LEAD-35554')
  or exists (select 1 from cliente_bloqueos     where codigo_cliente = 'LEAD-35554')
  or exists (select 1 from firmas_cumplimiento  where codigo_cliente = 'LEAD-35554') then
    raise exception 'LEAD-35554 tiene evidencia de cumplimiento: no se borra, se revisa a mano.';
  end if;
  if exists (select 1 from clientes where codigo_cotitular = 'LEAD-35554')
  or exists (select 1 from codigos_alias where 'LEAD-35554' in (codigo_anterior, codigo_actual)) then
    raise exception 'LEAD-35554 es cotitular de alguien o tiene alias: revisar a mano.';
  end if;
end $$;

-- --- 2 · Hijas del expediente (hoy vacías para este código) ------------------
delete from public.perfil_riesgo     where codigo_cliente = 'LEAD-35554';
delete from public.kyc_detalle       where codigo_cliente = 'LEAD-35554';
delete from public.pep_listas        where codigo_cliente = 'LEAD-35554';
delete from public.propietario_real  where codigo_cliente = 'LEAD-35554';
delete from public.beneficiarios     where codigo_cliente = 'LEAD-35554';
delete from public.transaccionalidad where codigo_cliente = 'LEAD-35554';
delete from public.portafolios       where codigo_cliente = 'LEAD-35554';

-- --- 3 · El cliente, al final -------------------------------------------------
delete from public.clientes where codigo_cliente = 'LEAD-35554';

-- --- 4 · Verificación dentro de la transacción --------------------------------
do $$
begin
  if exists (select 1 from clientes where codigo_cliente = 'LEAD-35554') then
    raise exception 'LEAD-35554 sigue en clientes.';
  end if;
  -- Solo el de clientes: otras tablas también usan el código como entidad_id.
  if (select count(*) from bitacora where entidad = 'clientes' and entidad_id = 'LEAD-35554'
        and accion = 'delete' and origen = 'trigger') <> 1 then
    raise exception 'trg_bitacora no asentó el DELETE.';
  end if;
end $$;

commit;

-- --- Después: misma consulta que al principio --------------------------------
-- Esperado: clientes 0, todas las hijas 0, bitacora (no se toca) 1 (el asiento
-- 'delete' que acaba de escribir el trigger), total clientes = el de antes − 1.
select 'clientes' as tabla, count(*) as filas from clientes where codigo_cliente = 'LEAD-35554'
union all select 'perfil_riesgo',        count(*) from perfil_riesgo        where codigo_cliente = 'LEAD-35554'
union all select 'kyc_detalle',          count(*) from kyc_detalle          where codigo_cliente = 'LEAD-35554'
union all select 'pep_listas',           count(*) from pep_listas           where codigo_cliente = 'LEAD-35554'
union all select 'propietario_real',     count(*) from propietario_real     where codigo_cliente = 'LEAD-35554'
union all select 'beneficiarios',        count(*) from beneficiarios        where codigo_cliente = 'LEAD-35554'
union all select 'transaccionalidad',    count(*) from transaccionalidad    where codigo_cliente = 'LEAD-35554'
union all select 'portafolios',          count(*) from portafolios          where codigo_cliente = 'LEAD-35554'
union all select 'ebr_evaluaciones',     count(*) from ebr_evaluaciones     where codigo_cliente = 'LEAD-35554'
union all select 'listas_coincidencias', count(*) from listas_coincidencias where codigo_cliente = 'LEAD-35554'
union all select 'cliente_bloqueos',     count(*) from cliente_bloqueos     where codigo_cliente = 'LEAD-35554'
union all select 'firmas_cumplimiento',  count(*) from firmas_cumplimiento  where codigo_cliente = 'LEAD-35554'
union all select 'cotitular de alguien', count(*) from clientes             where codigo_cotitular = 'LEAD-35554'
union all select 'bitacora (no se toca)', count(*) from bitacora            where entidad_id = 'LEAD-35554'
union all select 'total clientes',       count(*) from clientes;
