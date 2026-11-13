-- ===========================================================================
-- cuentas_ibkr: cuentas propias del Asesor y cierre de cuenta (es_propia,
-- fecha_cierre, motivo_cierre)
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: códigos de cliente; ningún número de cuenta.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026). La salida del
-- real, la verificación por MCP y el md5 van en el mensaje del commit.
--
-- Réplica del repo (npm run replica, datos sintéticos con cinco códigos): ensayo
-- sin rastro; real con propias CSPFU1488 y CSPFU6388, cierre de CSPFU8973 al
-- 2023-01-20, histórico 0 → 3 y 5 asientos; re-ejecución detenida en la guarda.
-- Cinco mutaciones, cada una detenida: es_propia también a CSPFU2162
-- (verificación), fn_archivar sin reescribir (autoprueba: el histórico no copia
-- es_propia), sin el CHECK de cierre completo (autoprueba), motivo distinto
-- (verificación) y cierre también en la conjunta (autoprueba).
-- Ensayo en producción, 13-nov-2026 (ROLLBACK, código de salida 0, md5 del archivo
-- ensayado e37793793aa4c23cc565a7d2d9c989d4, que solo difiere de este en esta
-- cabecera; corrido ANTES del real de 2026-11-13-01, que no toca cuentas_ibkr):
-- propias CSPFU1488, CSPFU6388; cerrada CSPFU8973 2023-01-20; histórico 0 → 3; 5
-- asientos. Verificado después por MCP: sin columnas nuevas, fn_archivar igual,
-- histórico vacío, cuentas_ibkr con su huella.
--
-- POR QUÉ
--
-- - es_propia: ESPEC_IBKR_Flex §3.2.15 (cuentas propias del Asesor: se evalúan
--   pero quedan exentas de los límites y fuera de los totales). Decisión de
--   Claudio, 13-nov-2026: true para las cuentas de CSPFU1488 y CSPFU6388 (las
--   que en la vista previa del 13-nov traen opciones o saldos negativos
--   relevantes). Las demás cuentas de la misma persona (CSPFU2162, CSPFU8588)
--   quedan en false: así lo indicó.
-- - fecha_cierre / motivo_cierre: la cuenta individual de CSPFU8973 se cerró el
--   2023-01-20 (fue 302 en el R03 202306). La persona sigue siendo titular de la
--   conjunta de CSPMU1062. Se registra el cierre en la CUENTA, sin tocar el
--   status de la persona ni su titularidad histórica (análisis del 12-nov-2026:
--   ningún lector de KYC/EBR/IPS depende de esto; una baja en clientes bloquearía
--   su carta).
--
-- QUÉ HACE
--
-- 1. cuentas_ibkr: es_propia boolean not null default false; fecha_cierre date y
--    motivo_cierre text, que van juntas o ninguna, y el motivo no en blanco.
-- 2. cuentas_ibkr_historico: las tres columnas, y fn_archivar_cuentas_ibkr las
--    copia (misma función, mismas guardas, mismos privilegios).
-- 3. UPDATE: es_propia de las 2 cuentas; cierre de la individual de CSPFU8973.
--    Cada UPDATE archiva la versión anterior (3 versiones) y deja su asiento.
-- 4. Bitácora: 4 asientos de trg_bitacora (es_propia ×2, fecha y motivo de
--    cierre) + 1 manual.
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
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name in ('cuentas_ibkr', 'cuentas_ibkr_historico')
              and column_name in ('es_propia', 'fecha_cierre', 'motivo_cierre')) then
    raise exception 'guarda: las columnas ya existen; el script no es re-ejecutable.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.fn_archivar_cuentas_ibkr()'::regprocedure)
     is distinct from '725fc7fabacd7031d1d3fe7790c7d725' then
    raise exception 'guarda: fn_archivar_cuentas_ibkr no es la versión esperada (md5 del cuerpo).';
  end if;
  if (select count(*) from public.cuentas_ibkr where codigo_cliente = 'CSPFU1488' and tipo = 'conjunta') <> 1
     or (select count(*) from public.cuentas_ibkr where codigo_cliente = 'CSPFU6388' and tipo = 'individual') <> 1
     or (select count(*) from public.cuentas_ibkr where codigo_cliente = 'CSPFU8973' and tipo = 'individual') <> 1
     or (select count(*) from public.cuentas_ibkr where codigo_cliente = 'CSPMU1062' and tipo = 'conjunta') <> 1 then
    raise exception 'guarda: las cuentas de CSPFU1488, CSPFU6388, CSPFU8973 o CSPMU1062 no son las esperadas.';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 36
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 17
     or (select count(*) from pg_policies where schemaname = 'public') <> 60
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 37 then
    raise exception 'guarda: el esquema no es el esperado (36 tablas, 17 funciones, 60 políticas, 37 triggers).';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select count(*) from public.bitacora) as bitacora,
       (select count(*) from public.cuentas_ibkr_historico) as historico,
       (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.cuentas_ibkr x) as cuentas,
       (select md5(string_agg(to_jsonb(t)::text, '' order by t.id)) from public.cuenta_titulares t) as titulares;

-- --- 1 · Columnas ------------------------------------------------------------------
alter table public.cuentas_ibkr
  add column es_propia     boolean not null default false,
  add column fecha_cierre  date,
  add column motivo_cierre text,
  add constraint cuentas_ibkr_cierre_completo check ((fecha_cierre is null) = (motivo_cierre is null)),
  add constraint cuentas_ibkr_motivo_cierre_lleno check (motivo_cierre is null or btrim(motivo_cierre) <> '');
comment on column public.cuentas_ibkr.es_propia is
  'Cuenta propia del Asesor (ESPEC_IBKR_Flex §3.2.15): se evalúa, pero exenta de límites y fuera de los totales.';
comment on column public.cuentas_ibkr.fecha_cierre is
  'Fecha REAL de cierre de la cuenta en IBKR. NULL = abierta. Va con motivo_cierre. No cambia el status de la persona.';

alter table public.cuentas_ibkr_historico
  add column es_propia     boolean,
  add column fecha_cierre  date,
  add column motivo_cierre text;

create or replace function public.fn_archivar_cuentas_ibkr()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_usuario text; v_version integer; v_campos text[];
begin
  if (tg_op = 'UPDATE') and (to_jsonb(old) is not distinct from to_jsonb(new)) then return new; end if;
  v_usuario := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo');
  if (tg_op = 'UPDATE') then
    select array_agg(n.key order by n.key) into v_campos
      from jsonb_each_text(to_jsonb(new)) n(key, value) where n.value is distinct from (to_jsonb(old) ->> n.key);
  end if;
  select coalesce(max(version), 0) + 1 into v_version from cuentas_ibkr_historico where id = old.id;
  insert into cuentas_ibkr_historico (version, archivado_por, operacion, campos_cambiados, snapshot,
    id, cuenta_ibkr, codigo_cliente, tipo, creado_en, creado_por, es_propia, fecha_cierre, motivo_cierre)
  values (v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.cuenta_ibkr, old.codigo_cliente, old.tipo, old.creado_en, old.creado_por,
    old.es_propia, old.fecha_cierre, old.motivo_cierre);
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end $function$;

-- --- 2 · Valores -----------------------------------------------------------------
update public.cuentas_ibkr set es_propia = true where codigo_cliente in ('CSPFU1488', 'CSPFU6388');

update public.cuentas_ibkr
   set fecha_cierre = date '2023-01-20',
       motivo_cierre = 'Cierre de la cuenta individual a solicitud del cliente; continúa como titular de la cuenta '
                       'conjunta CSPMU1062.'
 where codigo_cliente = 'CSPFU8973' and tipo = 'individual';

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'cuentas-propia-y-cierre', 'ddl_y_datos',
        'cuentas_ibkr gana es_propia, fecha_cierre y motivo_cierre (con su histórico). Cuentas propias del Asesor: '
        'CSPFU1488 y CSPFU6388. Cierre de la cuenta individual de CSPFU8973 el 2023-01-20; sigue como titular de la '
        'conjunta CSPMU1062.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-13-02-cuentas-propia-y-cierre.sql',
                           'es_propia', jsonb_build_array('CSPFU1488', 'CSPFU6388'),
                           'cierre', jsonb_build_object('codigo', 'CSPFU8973', 'fecha', '2023-01-20')));

-- --- 3 · Autoprueba (se revierte entera con IBOK0) ----------------------------------
do $$
begin
  begin
    begin
      update public.cuentas_ibkr set fecha_cierre = date '2020-01-01' where codigo_cliente = 'CSPMU1062';
      raise exception 'autoprueba: una fecha de cierre sin motivo no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      update public.cuentas_ibkr set fecha_cierre = date '2020-01-01', motivo_cierre = '   ' where codigo_cliente = 'CSPMU1062';
      raise exception 'autoprueba: un motivo de cierre en blanco no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    -- El histórico copia las columnas nuevas: archiva la versión con es_propia = true.
    update public.cuentas_ibkr set es_propia = false where codigo_cliente = 'CSPFU6388';
    if (select es_propia from public.cuentas_ibkr_historico h
          where h.codigo_cliente = 'CSPFU6388' order by version desc limit 1) is distinct from true then
      raise exception 'autoprueba: el histórico no copió es_propia.' using errcode = 'IBFAL';
    end if;
    raise exception 'autoprueba completa' using errcode = 'IBOK0';
  exception when sqlstate 'IBOK0' then null;
  end;
end $$;

-- --- 4 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select string_agg(codigo_cliente, ',' order by codigo_cliente) from public.cuentas_ibkr where es_propia)
     is distinct from 'CSPFU1488,CSPFU6388' then
    raise exception 'verificación: es_propia no quedó solo en CSPFU1488 y CSPFU6388.';
  end if;
  if (select string_agg(codigo_cliente || '|' || fecha_cierre || '|' || motivo_cierre, ',') from public.cuentas_ibkr
       where fecha_cierre is not null)
     is distinct from 'CSPFU8973|2023-01-20|Cierre de la cuenta individual a solicitud del cliente; continúa como '
                      'titular de la cuenta conjunta CSPMU1062.' then
    raise exception 'verificación: el cierre no quedó solo en la cuenta individual de CSPFU8973 con su fecha y motivo.';
  end if;
  if (select md5(string_agg((to_jsonb(x) - array['es_propia', 'fecha_cierre', 'motivo_cierre'])::text, '' order by x.id))
        from public.cuentas_ibkr x) is distinct from (select cuentas from _antes)
     or (select md5(string_agg(to_jsonb(t)::text, '' order by t.id)) from public.cuenta_titulares t)
        is distinct from (select titulares from _antes) then
    raise exception 'verificación: cambió algo más que las tres columnas nuevas, o las titularidades.';
  end if;
  if (select count(*) from public.cuentas_ibkr_historico) <> (select historico from _antes) + 3
     or exists (select 1 from public.cuentas_ibkr_historico where archivado_en = now()
                  and (es_propia is distinct from false or fecha_cierre is not null)) then
    raise exception 'verificación: el histórico no tiene las 3 versiones anteriores (sin propia, sin cierre).';
  end if;
  if not (select prosecdef and array_to_string(proconfig, ',') = 'search_path=public'
                 and has_function_privilege('service_role', oid, 'execute')
                 and not has_function_privilege('authenticated', oid, 'execute')
                 and not has_function_privilege('anon', oid, 'execute')
            from pg_proc where oid = 'public.fn_archivar_cuentas_ibkr()'::regprocedure) then
    raise exception 'verificación: fn_archivar_cuentas_ibkr perdió SECURITY DEFINER, search_path o privilegios.';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 36
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 17
     or (select count(*) from pg_policies where schemaname = 'public') <> 60
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 37 then
    raise exception 'verificación: el esquema cambió de tamaño.';
  end if;
  if (select count(*) from public.bitacora where created_at = now()) <> 5
     or (select count(*) from public.bitacora where created_at = now() and origen = 'trigger'
          and entidad = 'cuentas_ibkr') <> 4
     or (select count(*) from public.bitacora) <> (select bitacora from _antes) + 5
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: la bitácora no tiene 4 asientos del trigger + 1 manual con el usuario pasado.';
  end if;
end $$;

select (select string_agg(codigo_cliente, ', ' order by codigo_cliente) from public.cuentas_ibkr where es_propia) as propias,
       (select string_agg(codigo_cliente || ' ' || fecha_cierre, ', ') from public.cuentas_ibkr where fecha_cierre is not null) as cerradas,
       ((select historico from _antes) || ' → ' || (select count(*) from public.cuentas_ibkr_historico)) as historico,
       (select count(*) from public.bitacora where created_at = now())::text as asientos,
       ((select bitacora from _antes) || ' → ' || (select count(*) from public.bitacora)) as bitacora;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
