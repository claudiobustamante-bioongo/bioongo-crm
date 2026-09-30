-- ===========================================================================
-- Conciliación de códigos con lo reportado a la CNBV (R03 J-0315)
--
-- EJECUTADO el 30 de septiembre de 2026 por Claudio Bustamante, a mano, en el
-- SQL Editor de Supabase ("Run without RLS"; el script activa la RLS de su
-- propia tabla). Este archivo es el registro de lo que se corrió: del `begin`
-- al `commit` es byte a byte el script ejecutado (B_conciliacion.sql, md5
-- ef78258edf851fd875c3112feb2f8a55); solo cambió esta cabecera.
--
-- POR QUÉ
--
-- El R03 J-0315 ya reportó en 202512 y 202606 dos IDs distintos a los que tenía
-- el CRM. Lo reportado manda; el CRM se alinea a él:
--
--   CSPFU8080 → CSPFU8085
--   CSPFU8585 → CSPFU8588   (cuenta conjunta; su cotitular CSPFU8488 no cambia)
--
-- Y dos cuentas se cerraron por decisión del cliente: CSPFU8385 y CSPMU1160.
-- No se borran: el expediente se conserva por obligación PLD.
--
-- Fuera de alcance, sin tocar: CSPFU1270 (en el 202606 salió como CSPfU1270 por
-- error de captura; el CRM ya estaba bien), CSPFU8066 (ya no existe en el CRM) y
-- CSPFU2162 (titular/cotitular registrado solo en la memoria del modelo
-- persona↔cuenta, que sigue estacionado).
--
-- QUÉ HIZO
--
-- 1. `codigos_alias`: puente código anterior → vigente, sin FK a clientes (el
--    alias debe sobrevivir al expediente) y con RLS de solo SELECT.
-- 2. `clientes`: CHECK `clientes_status_valido` (lead_nuevo, vigente, inactivo,
--    baja), columnas `fecha_baja` y `motivo_baja`, y CHECK
--    `clientes_baja_completa`: las dos van con status = 'baja' o ninguna.
--    `fecha_baja` es la fecha en que se REGISTRA la baja, no necesariamente la
--    del cierre; así lo dice el COMMENT de la columna.
-- 3. Las 10 FK hacia clientes(codigo_cliente) pasaron a DEFERRABLE INITIALLY
--    IMMEDIATE. NO a CASCADE: renombrar un ID reportado a la CNBV tiene que ser
--    siempre un UPDATE explícito, nunca efecto secundario de otro. Por defecto
--    siguen comprobándose al instante; solo un `set constraints … deferred`
--    explícito las pospone al commit.
-- 4. Renombres con un UPDATE explícito por tabla (11, incluido
--    codigo_cotitular).
-- 5. Bajas de CSPFU8385 y CSPMU1160, con fecha 2026-09-30 y la ventana del
--    cierre armada solo con evidencia verificable: «posterior a 2025-12-31»,
--    porque los dos aparecen con saldo en el R03 J-0315 202512 (confirmado por
--    Claudio) y del lado final no hay registro —ni Flex ni otro— en el repo ni
--    en la base.
-- 6. Un asiento manual en bitácora por renombre y por baja (origen
--    'migracion'), además de los que `fn_bitacora` escribe sola.
-- 7. Se retiró la política `clientes_delete_auth`: ninguna tabla con datos de
--    cliente admite DELETE desde la aplicación. Era la única política DELETE
--    del esquema. El botón «Eliminar cliente» de /editar se retira en el mismo
--    bloque de trabajo, en commit aparte; los leads basura se borran desde el SQL Editor.
--
-- QUÉ NO HIZO, A PROPÓSITO
--
-- No reescribió la auditoría: `bitacora`, `perfil_riesgo_historico` y los
-- snapshots jsonb conservan el código con el que se escribieron. En
-- consecuencia el historial del espejo quedó PARTIDO: el UPDATE del renombre
-- archivó la v2 de CSPFU8080 y de CSPFU8585 (campos_cambiados =
-- {codigo_cliente}), y CSPFU8085 / CSPFU8588 empezarán su serie en v1 con su
-- primer cambio. Es aceptado: `codigos_alias` es el puente, y así lo documenta
-- el COMMENT de la tabla.
--
-- VERIFICADO DESPUÉS DE EJECUTAR
--
-- Antes de producción, el script corrió en una réplica desechable (PGlite,
-- Postgres 17.5) con las columnas, restricciones, FK, triggers, funciones y
-- políticas reales, y datos sintéticos con los mismos conteos. Ahí se probó
-- también que re-ejecutarlo falla en la guarda de colisión y que los CHECK
-- rechazan una errata de status y una baja incompleta.
--
-- En producción, la consulta de verificación del final de este archivo, antes
-- (A) y después (C), y los chequeos adicionales por MCP:
--
--   chequeo                                       antes       después
--   filas operativas con CSPFU8080 / CSPFU8585    11 / 13     0 / 0
--   filas operativas con CSPFU8085 / CSPFU8588    0 / 0       11 / 13
--   espejo CSPFU8080 / CSPFU8585                  v1 / v1     v1,v2 / v1,v2
--   espejo CSPFU8085 / CSPFU8588                  — / —       — / —
--   bitácora con entidad_id viejo                 7 / 7       7 / 7 (intacta)
--   bitácora con entidad_id nuevo                 0 / 0       12 / 14
--   CSPFU8385, CSPMU1160                          inactivo    baja · 2026-09-30
--   codigos_alias                                 no existe   2 filas
--   asientos manuales (origen migracion)          0           4
--   políticas DELETE en clientes                  1           0
--   FK diferibles hacia clientes                  0           10 (0 initially deferred)
--   total clientes                                36          36
--
--   codigos_alias: relrowsecurity = true; una política (SELECT, authenticated).
--   COMMENT presentes: codigos_alias, clientes.fecha_baja, clientes.motivo_baja.
--   CHECK clientes_status_valido y clientes_baja_completa: validados.
--   Status después: vigente 28 · inactivo 5 · baja 2 · lead_nuevo 1.
--
-- `usuario` / `registrado_por` dicen `sql_directo` porque se corrió desde el
-- SQL Editor, sin JWT de Supabase; misma convención que los triggers.
-- ===========================================================================

begin;

-- --- 1 · Guardas -----------------------------------------------------------
do $$
begin
  if exists (select 1 from clientes where upper(codigo_cliente) in ('CSPFU8085','CSPFU8588')) then
    raise exception 'Colisión: CSPFU8085 o CSPFU8588 ya existen en clientes.';
  end if;
  if (select count(*) from clientes
       where codigo_cliente in ('CSPFU8080','CSPFU8585','CSPFU8385','CSPMU1160')) <> 4 then
    raise exception 'No están los cuatro códigos de origen en clientes.';
  end if;
  if exists (select 1 from clientes
              where codigo_cliente in ('CSPFU8385','CSPMU1160') and status <> 'inactivo') then
    raise exception 'Alguna de las bajas no está hoy en status inactivo; revisar antes de marcar.';
  end if;
  if exists (select 1 from clientes where status not in ('lead_nuevo','vigente','inactivo')) then
    raise exception 'Hay un status fuera de lead_nuevo/vigente/inactivo; el CHECK no entraría.';
  end if;
end $$;

-- --- 2 · codigos_alias -----------------------------------------------------
create table public.codigos_alias (
  id              uuid primary key default gen_random_uuid(),
  codigo_anterior text not null unique,
  codigo_actual   text not null,
  fecha           date not null,
  motivo          text not null,
  referencia      text not null,
  registrado_en   timestamptz not null default now(),
  registrado_por  text not null default coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    'sql_directo'),
  constraint codigos_alias_distintos check (codigo_anterior <> codigo_actual)
);

comment on table public.codigos_alias is
  'Puente entre un codigo_cliente anterior y el vigente. Las tablas operativas y de '
  'evaluación se renombran; las de auditoría (bitacora, perfil_riesgo_historico) y '
  'los snapshots jsonb conservan el código con el que se escribieron. Por eso el '
  'historial de perfil_riesgo_historico queda PARTIDO a propósito: el UPDATE del '
  'renombre archiva la versión previa con el código anterior (p. ej. CSPFU8080 v2), '
  'y el código nuevo empieza su serie en v1 (CSPFU8085 v1) con su primer cambio. '
  'Para leer la historia completa de un cliente, se une por esta tabla. '
  'Sin FK a clientes, igual que el espejo: el alias debe sobrevivir al expediente.';
comment on column public.codigos_alias.codigo_actual is
  'Código vigente al registrar el alias. Si ese código se renombra después, se '
  'agrega un alias nuevo; esta fila no se reescribe.';

alter table public.codigos_alias enable row level security;
create policy codigos_alias_select_auth on public.codigos_alias
  for select to authenticated using (true);

-- --- 3 · status, fecha_baja, motivo_baja -----------------------------------
alter table public.clientes
  add column fecha_baja  date,
  add column motivo_baja text;

alter table public.clientes
  add constraint clientes_status_valido
    check (status in ('lead_nuevo','vigente','inactivo','baja')),
  add constraint clientes_baja_completa
    check (    (status = 'baja') = (fecha_baja  is not null)
           and (status = 'baja') = (motivo_baja is not null));

comment on column public.clientes.fecha_baja is
  'Fecha en que se REGISTRA la baja en el expediente, no necesariamente la del '
  'cierre de la cuenta; cuando el cierre no tiene fecha documentada, motivo_baja '
  'declara la ventana conocida. Obligatoria si y solo si status = ''baja''. La baja '
  'no borra el expediente: se conserva por obligación PLD.';
comment on column public.clientes.motivo_baja is
  'Por qué y cómo se dio de baja, con la evidencia disponible. Obligatorio si y '
  'solo si status = ''baja''.';

-- --- 4 · FK diferibles ------------------------------------------------------
alter table public.clientes             alter constraint clientes_codigo_cotitular_fkey         deferrable initially immediate;
alter table public.perfil_riesgo        alter constraint perfil_riesgo_codigo_cliente_fkey      deferrable initially immediate;
alter table public.kyc_detalle          alter constraint kyc_detalle_codigo_cliente_fkey        deferrable initially immediate;
alter table public.pep_listas           alter constraint pep_listas_codigo_cliente_fkey         deferrable initially immediate;
alter table public.propietario_real     alter constraint propietario_real_codigo_cliente_fkey   deferrable initially immediate;
alter table public.beneficiarios        alter constraint beneficiarios_codigo_cliente_fkey      deferrable initially immediate;
alter table public.transaccionalidad    alter constraint transaccionalidad_codigo_cliente_fkey  deferrable initially immediate;
alter table public.portafolios          alter constraint portafolios_codigo_cliente_fkey        deferrable initially immediate;
alter table public.ebr_evaluaciones     alter constraint ebr_evaluaciones_codigo_cliente_fkey   deferrable initially immediate;
alter table public.listas_coincidencias alter constraint listas_coincidencias_codigo_cliente_fkey deferrable initially immediate;

set constraints
  public.clientes_codigo_cotitular_fkey,
  public.perfil_riesgo_codigo_cliente_fkey,
  public.kyc_detalle_codigo_cliente_fkey,
  public.pep_listas_codigo_cliente_fkey,
  public.propietario_real_codigo_cliente_fkey,
  public.beneficiarios_codigo_cliente_fkey,
  public.transaccionalidad_codigo_cliente_fkey,
  public.portafolios_codigo_cliente_fkey,
  public.ebr_evaluaciones_codigo_cliente_fkey,
  public.listas_coincidencias_codigo_cliente_fkey
  deferred;

-- --- 5 · Renombres explícitos ----------------------------------------------
create temp table _renombre (viejo text primary key, nuevo text not null unique) on commit drop;
insert into _renombre values ('CSPFU8080','CSPFU8085'), ('CSPFU8585','CSPFU8588');

update public.clientes             t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;
update public.clientes             t set codigo_cotitular = r.nuevo from _renombre r where t.codigo_cotitular = r.viejo;
update public.perfil_riesgo        t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;
update public.ebr_evaluaciones     t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;
update public.kyc_detalle          t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;
update public.pep_listas           t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;
update public.propietario_real     t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;
update public.beneficiarios        t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;
update public.transaccionalidad    t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;
update public.portafolios          t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;
update public.listas_coincidencias t set codigo_cliente   = r.nuevo from _renombre r where t.codigo_cliente   = r.viejo;

insert into public.codigos_alias (codigo_anterior, codigo_actual, fecha, motivo, referencia)
select viejo, nuevo, current_date,
       'Conciliación con los IDs ya reportados a la CNBV; el CRM estaba desalineado.',
       'R03 J-0315 202512/202606'
  from _renombre;

-- --- 6 · Bajas --------------------------------------------------------------
-- fecha_baja = día en que se registra la baja (ver COMMENT de la columna). La
-- ventana del cierre solo lleva evidencia verificable: el R03 J-0315 de 202512
-- con saldo; del lado final no hay registro (ni Flex ni otro) en el repo ni en
-- la base al 30-sep-2026.
create temp table _baja (codigo text primary key, fecha date not null, motivo text not null) on commit drop;
insert into _baja
select c, date '2026-09-30',
       'Cierre voluntario de la cuenta por el cliente. Fecha exacta de cierre no '
       'documentada; ventana: posterior a 2025-12-31 (última evidencia con cuenta: '
       'R03 J-0315 202512, con saldo).'
  from (values ('CSPFU8385'), ('CSPMU1160')) v(c);

update public.clientes c
   set status = 'baja', fecha_baja = b.fecha, motivo_baja = b.motivo
  from _baja b
 where c.codigo_cliente = b.codigo;

-- --- 7 · Asientos manuales de bitácora --------------------------------------
-- Además de los que fn_bitacora escribe solo (uno por campo cambiado y fila).
insert into public.bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, motivo, usuario, origen, metadata)
select 'clientes', r.nuevo, 'renombre_codigo', 'codigo_cliente', r.viejo, r.nuevo,
       'Conciliación con los IDs ya reportados a la CNBV en el R03 J-0315.',
       'sql_directo', 'migracion',
       jsonb_build_object('referencia', 'R03 J-0315 202512/202606',
                          'script', '2026-09-30-conciliacion-codigos-r03.sql')
  from _renombre r;

insert into public.bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, motivo, usuario, origen, metadata)
select 'clientes', b.codigo, 'baja', 'status', 'inactivo', 'baja', b.motivo,
       'sql_directo', 'migracion',
       jsonb_build_object('fecha_baja', b.fecha,
                          'referencia', 'R03 J-0315 202512/202606',
                          'script', '2026-09-30-conciliacion-codigos-r03.sql')
  from _baja b;

-- --- 8 · Sin DELETE sobre clientes -----------------------------------------
drop policy clientes_delete_auth on public.clientes;

-- --- 9 · Verificación dentro de la transacción ------------------------------
set constraints all immediate;   -- las FK se comprueban aquí, no hasta el commit

do $$
declare n int;
begin
  select (select count(*) from clientes             where codigo_cliente in ('CSPFU8080','CSPFU8585') or codigo_cotitular in ('CSPFU8080','CSPFU8585'))
       + (select count(*) from perfil_riesgo        where codigo_cliente in ('CSPFU8080','CSPFU8585'))
       + (select count(*) from ebr_evaluaciones     where codigo_cliente in ('CSPFU8080','CSPFU8585'))
       + (select count(*) from kyc_detalle          where codigo_cliente in ('CSPFU8080','CSPFU8585'))
       + (select count(*) from pep_listas           where codigo_cliente in ('CSPFU8080','CSPFU8585'))
       + (select count(*) from propietario_real     where codigo_cliente in ('CSPFU8080','CSPFU8585'))
       + (select count(*) from beneficiarios        where codigo_cliente in ('CSPFU8080','CSPFU8585'))
       + (select count(*) from transaccionalidad    where codigo_cliente in ('CSPFU8080','CSPFU8585'))
       + (select count(*) from portafolios          where codigo_cliente in ('CSPFU8080','CSPFU8585'))
       + (select count(*) from listas_coincidencias where codigo_cliente in ('CSPFU8080','CSPFU8585'))
    into n;
  if n <> 0 then raise exception 'Quedan % filas operativas con código viejo.', n; end if;

  if (select count(*) from clientes where codigo_cliente in ('CSPFU8085','CSPFU8588')) <> 2 then
    raise exception 'Los códigos nuevos no quedaron en clientes.';
  end if;
  if (select count(*) from codigos_alias) <> 2 then
    raise exception 'codigos_alias no tiene exactamente 2 filas.';
  end if;
  if (select count(*) from clientes where status = 'baja') <> 2 then
    raise exception 'No quedaron exactamente 2 bajas.';
  end if;
  if (select count(*) from bitacora where origen = 'migracion'
        and accion in ('renombre_codigo','baja')) <> 4 then
    raise exception 'No quedaron los 4 asientos manuales.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
               and tablename = 'clientes' and cmd = 'DELETE') then
    raise exception 'Sigue habiendo política DELETE en clientes.';
  end if;
end $$;

commit;

-- --- Verificación · se corrió aparte, antes (A) y después (C) del script ------
--
-- with v(c) as (values ('CSPFU8080'),('CSPFU8585'),('CSPFU8085'),('CSPFU8588'))
-- select 'operativas: filas con ' || c as chequeo,
--        ( (select count(*) from clientes             where codigo_cliente = c or codigo_cotitular = c)
--        + (select count(*) from perfil_riesgo        where codigo_cliente = c)
--        + (select count(*) from ebr_evaluaciones     where codigo_cliente = c)
--        + (select count(*) from kyc_detalle          where codigo_cliente = c)
--        + (select count(*) from pep_listas           where codigo_cliente = c)
--        + (select count(*) from propietario_real     where codigo_cliente = c)
--        + (select count(*) from beneficiarios        where codigo_cliente = c)
--        + (select count(*) from transaccionalidad    where codigo_cliente = c)
--        + (select count(*) from portafolios          where codigo_cliente = c)
--        + (select count(*) from listas_coincidencias where codigo_cliente = c) )::text as valor
--   from v
-- union all
-- select 'historico: versiones de ' || c,
--        coalesce((select string_agg('v' || version, ',' order by version)
--                    from perfil_riesgo_historico where codigo_cliente = c), '—')
--   from v
-- union all
-- select 'bitacora: filas con entidad_id ' || c,
--        (select count(*) from bitacora where entidad_id = c)::text
--   from v
-- union all
-- select 'status de ' || codigo_cliente,
--        status || coalesce(' · fecha_baja ' || (to_jsonb(clientes) ->> 'fecha_baja'), '')
--   from clientes where codigo_cliente in ('CSPFU8385','CSPMU1160')
-- union all
-- select 'codigos_alias',
--        case when to_regclass('public.codigos_alias') is null then 'no existe'
--             else (xpath('/table/row/n/text()',
--                   query_to_xml('select count(*) as n from public.codigos_alias', false, false, '')))[1]::text
--        end
-- union all
-- select 'bitacora: asientos manuales (origen migracion)',
--        (select count(*) from bitacora where origen = 'migracion')::text
-- union all
-- select 'politicas DELETE en clientes',
--        (select count(*) from pg_policies where schemaname = 'public'
--           and tablename = 'clientes' and cmd = 'DELETE')::text
-- union all
-- select 'FK diferibles hacia clientes',
--        (select count(*) from pg_constraint where contype = 'f'
--           and confrelid = 'public.clientes'::regclass and condeferrable)::text
-- union all
-- select 'total clientes', (select count(*) from clientes)::text;
