-- ===========================================================================
-- PEP · procedencia de la declaración del 14-oct-2026 · persona CSPFU6388
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: solo códigos.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026). La salida del
-- real, la verificación por MCP y el md5 van en el mensaje del commit.
--
-- Antes, en una réplica PGlite 0.3.7 (Postgres 17.5) con la fn_bitacora actual:
-- 11/11 (ensayo sin rastro, las 3 filas con la procedencia nueva, 7 asientos con
-- la fuente anterior y el usuario pasado, re-ejecución detenida, y la guarda
-- detiene un indicador en true, una fila faltante y la falta de la persona).
--
-- Ensayo en producción, 21-oct-2026 (modo=ensayo, mismo cuerpo; ROLLBACK,
-- código de salida 0): CSPFU1488, CSPFU6388 y CSPFU8588 con fecha 2026-10-14 y
-- «Declaración del titular (persona CSPFU6388) del 14-oct-2026: …», ningún
-- indicador en true, 7 asientos. Verificado después por MCP: las 3 filas
-- seguían con la fuente migrada y la bitácora en 807 asientos.
--
-- POR QUÉ
--
-- El 14-oct-2026 el titular (persona CSPFU6388) declaró que no es PEP ni tiene
-- familiar PEP. Decisión de Claudio: la declaración es de la PERSONA y aplica a
-- todos sus códigos: CSPFU6388 (su código individual) y las cuentas conjuntas de
-- las que es titular, CSPFU1488 y CSPFU8588. Hoy las tres filas de pep_listas
-- dicen «Migrado de la declaracion original. Pendiente confirmar…».
--
-- QUÉ HACE
--
-- Solo pep_declaracion_fecha (→ 2026-10-14) y pep_declaracion_fuente en esas tres
-- filas. Los seis indicadores ya están en false y no se tocan: la guarda exige
-- que sigan así. pep_listas no tiene espejo (pendiente #11): el valor anterior
-- de cada campo queda en la bitácora (trg_bitacora), además del asiento manual.
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
  if (select count(*) from public.pep_listas where codigo_cliente in ('CSPFU6388', 'CSPFU1488', 'CSPFU8588')) <> 3
     or (select count(distinct codigo_cliente) from public.pep_listas
          where codigo_cliente in ('CSPFU6388', 'CSPFU1488', 'CSPFU8588')) <> 3 then
    raise exception 'guarda: se esperaba exactamente una fila de pep_listas por cada uno de los tres códigos.';
  end if;
  if exists (select 1 from public.pep_listas
              where codigo_cliente in ('CSPFU6388', 'CSPFU1488', 'CSPFU8588')
                and (es_pep is distinct from false or es_pep_nacional is distinct from false
                     or es_pep_extranjero is distinct from false or familiar_pep_nacional is distinct from false
                     or familiar_pep_extranjero is distinct from false or tiene_relacionado_pep is distinct from false)) then
    raise exception 'guarda: algún indicador PEP no está en false; la declaración del 14-oct no se aplica a ciegas.';
  end if;
  if exists (select 1 from public.pep_listas
              where codigo_cliente in ('CSPFU6388', 'CSPFU1488', 'CSPFU8588')
                and pep_declaracion_fuente not like 'Migrado de la declaracion original.%') then
    raise exception 'guarda: la fuente actual no es la migrada; el script no es re-ejecutable.';
  end if;
  if not exists (select 1 from public.personas where codigo_ficha = 'CSPFU6388' and codigo_pep = 'CSPFU6388') then
    raise exception 'guarda: falta la persona CSPFU6388 con su PEP.';
  end if;
end $$;

create temporary table _otras_pep on commit drop as
select md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) as h
  from public.pep_listas x where codigo_cliente not in ('CSPFU6388', 'CSPFU1488', 'CSPFU8588');

-- --- 1 · Procedencia ---------------------------------------------------------------
update public.pep_listas
   set pep_declaracion_fecha  = date '2026-10-14',
       pep_declaracion_fuente = 'Declaración del titular (persona CSPFU6388) del 14-oct-2026: no es PEP ni tiene '
                                'familiar PEP. Aplica a todos sus códigos: CSPFU6388, CSPFU1488 y CSPFU8588. '
                                'Sustituye a «Migrado de la declaracion original».'
 where codigo_cliente in ('CSPFU6388', 'CSPFU1488', 'CSPFU8588')
   and pep_declaracion_fuente like 'Migrado de la declaracion original.%';

insert into public.bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, motivo, usuario, origen, metadata)
values ('pep_listas', 'CSPFU6388', 'declaracion_cliente', 'pep_declaracion_fecha, pep_declaracion_fuente',
        'migrada (2026-08-14 / 2026-09-04), pendiente confirmar', '2026-10-14, declaración del titular',
        'Declaración del titular del 14-oct-2026 (no PEP, sin familiar PEP), aplicada a la persona CSPFU6388 y a '
        'todos sus códigos por decisión de Claudio. Los indicadores ya estaban en false y no cambian.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'persona', 'CSPFU6388',
                           'codigos', jsonb_build_array('CSPFU6388', 'CSPFU1488', 'CSPFU8588'),
                           'fecha_declaracion', '2026-10-14'));

-- --- 2 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select count(*) from public.pep_listas
       where codigo_cliente in ('CSPFU6388', 'CSPFU1488', 'CSPFU8588')
         and pep_declaracion_fecha = date '2026-10-14'
         and pep_declaracion_fuente like 'Declaración del titular (persona CSPFU6388) del 14-oct-2026:%'
         and es_pep = false and es_pep_nacional = false and es_pep_extranjero = false
         and familiar_pep_nacional = false and familiar_pep_extranjero = false and tiene_relacionado_pep = false) <> 3 then
    raise exception 'verificación: las tres filas no quedaron con la procedencia nueva y los indicadores en false.';
  end if;
  if (select h from _otras_pep) is distinct from
     (select md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from public.pep_listas x
       where codigo_cliente not in ('CSPFU6388', 'CSPFU1488', 'CSPFU8588')) then
    raise exception 'verificación: cambió alguna otra fila de pep_listas.';
  end if;
  -- 2 campos × 3 filas por el trigger, con el valor anterior, más el manual.
  if (select count(*) from public.bitacora where created_at = now()) <> 7
     or (select count(*) from public.bitacora where created_at = now() and entidad = 'pep_listas' and accion = 'update'
           and campo = 'pep_declaracion_fuente' and valor_anterior like 'Migrado de la declaracion original.%') <> 3
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: los asientos de bitácora no son 6 + 1 con el valor anterior y el usuario pasado.';
  end if;
end $$;

select codigo_cliente, pep_declaracion_fecha::text as fecha, left(pep_declaracion_fuente, 60) as fuente,
       (es_pep or es_pep_nacional or es_pep_extranjero or familiar_pep_nacional or familiar_pep_extranjero
        or tiene_relacionado_pep)::text as algun_indicador_pep,
       (select count(*) from public.bitacora where created_at = now())::text as asientos
  from public.pep_listas where codigo_cliente in ('CSPFU6388', 'CSPFU1488', 'CSPFU8588')
 order by codigo_cliente;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
