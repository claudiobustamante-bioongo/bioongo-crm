-- ===========================================================================
-- CSPMU1089 · corrección del motivo de baja
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: solo el código.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026). La salida del
-- real, la verificación por MCP y el md5 van en el mensaje del commit.
--
-- Réplica del repo (npm run replica, datos sintéticos): ensayo sin rastro; real
-- con el motivo corregido y 2 asientos; re-ejecución detenida en la guarda; con
-- otro motivo ya puesto, el ensayo se detiene en la guarda sin rastro.
-- Ensayo en producción, 22-oct-2026 (ROLLBACK, código de salida 0): CSPMU1089 ·
-- baja · 2026-10-22 · «Cierre de cuenta a solicitud del cliente, el 2026-01-14» ·
-- 2 asientos. Verificado después por MCP: el motivo seguía sin cambio y la
-- bitácora en 896.
--
-- POR QUÉ
--
-- La baja se registró desde la app el 22-oct-2026 (fecha_baja = día del registro,
-- regla del 30-sep). El motivo acordado era el cierre de cuenta del 2026-01-14,
-- pero quedó un texto genérico y la fecha real del cierre no consta en ningún
-- lado. La app no permite corregirlo (una baja no se edita desde ahí). Decisión
-- de Claudio, 22-oct-2026: el motivo pasa a «Cierre de cuenta a solicitud del
-- cliente, el 2026-01-14».
--
-- QUÉ HACE
--
-- Solo clientes.motivo_baja de CSPMU1089. status y fecha_baja no se tocan. La
-- bitácora guarda el valor anterior (trg_bitacora) más un asiento manual.
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
  if not exists (select 1 from public.clientes
                  where codigo_cliente = 'CSPMU1089' and status = 'baja' and fecha_baja = date '2026-10-22'
                    and motivo_baja = 'Requirió el propio cliente darse de baja') then
    raise exception 'guarda: CSPMU1089 no está de baja con la fecha y el motivo que se van a corregir; '
                    'el script no es re-ejecutable.';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select to_jsonb(c) - 'motivo_baja' from public.clientes c where codigo_cliente = 'CSPMU1089') as fila,
       (select md5(coalesce(string_agg(to_jsonb(c)::text, '' order by c.codigo_cliente), ''))
          from public.clientes c where codigo_cliente <> 'CSPMU1089') as otros;

-- --- 1 · Corrección ------------------------------------------------------------
update public.clientes
   set motivo_baja = 'Cierre de cuenta a solicitud del cliente, el 2026-01-14'
 where codigo_cliente = 'CSPMU1089' and motivo_baja = 'Requirió el propio cliente darse de baja';

insert into public.bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, motivo, usuario, origen, metadata)
values ('clientes', 'CSPMU1089', 'correccion_dato', 'motivo_baja',
        'Requirió el propio cliente darse de baja', 'Cierre de cuenta a solicitud del cliente, el 2026-01-14',
        'El motivo acordado para la baja era el cierre de cuenta del 2026-01-14; desde la app quedó un texto '
        'genérico. fecha_baja (día del registro) no cambia.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'fecha_cierre', '2026-01-14'));

-- --- 2 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if not exists (select 1 from public.clientes where codigo_cliente = 'CSPMU1089' and status = 'baja'
                   and fecha_baja = date '2026-10-22'
                   and motivo_baja = 'Cierre de cuenta a solicitud del cliente, el 2026-01-14') then
    raise exception 'verificación: el motivo no quedó corregido.';
  end if;
  if (select fila from _antes) is distinct from
     (select to_jsonb(c) - 'motivo_baja' from public.clientes c where codigo_cliente = 'CSPMU1089') then
    raise exception 'verificación: cambió algo más que motivo_baja en CSPMU1089.';
  end if;
  if (select otros from _antes) is distinct from
     (select md5(coalesce(string_agg(to_jsonb(c)::text, '' order by c.codigo_cliente), ''))
        from public.clientes c where codigo_cliente <> 'CSPMU1089') then
    raise exception 'verificación: cambió otro cliente.';
  end if;
  if (select count(*) from public.bitacora where created_at = now()) <> 2
     or not exists (select 1 from public.bitacora where created_at = now() and origen = 'trigger'
                      and campo = 'motivo_baja' and valor_anterior = 'Requirió el propio cliente darse de baja')
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: los asientos no son 1 del trigger (con el valor anterior) + 1 manual, con el usuario pasado.';
  end if;
end $$;

select codigo_cliente, status, fecha_baja::text as fecha_baja, motivo_baja,
       (select count(*) from public.bitacora where created_at = now())::text as asientos
  from public.clientes where codigo_cliente = 'CSPMU1089';
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
