-- ===========================================================================
-- CSPFU1889, CSPFU6964 y CSPFU7371 · motivo de baja con la fecha real del cierre
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
-- Réplica del repo (npm run replica, datos sintéticos): ensayo sin rastro; real
-- con los tres motivos corregidos y 6 asientos; re-ejecución detenida en la guarda.
-- Ensayo en producción, 22-oct-2026 (ROLLBACK, código de salida 0): los tres de
-- baja con fecha_baja 2026-10-22 y el motivo nuevo, 6 asientos. Verificado
-- después por MCP: ningún motivo corregido y la bitácora en 1641.
--
-- POR QUÉ
--
-- Las tres bajas se registraron desde la app el 22-oct-2026 (fecha_baja = día del
-- registro, regla del 30-sep). La fecha real del cierre debe ir en el motivo; en
-- las tres quedó incompleta (sin año, o solo el mes). Mismo formato que la
-- corrección de CSPMU1089 (2026-10-22-motivo-baja-cspmu1089.sql). Textos dados por
-- Claudio el 22-oct-2026: CSPFU1889, cierre el 2026-01-14 (la cuenta sigue abierta
-- en IBKR solo para descargar estados de cuenta e información fiscal);
-- CSPFU6964 y CSPFU7371, cierre por escrito el 2026-10-07.
--
-- QUÉ HACE
--
-- Solo clientes.motivo_baja de los tres códigos. status y fecha_baja no cambian.
-- Primer script con el nombre AAAA-MM-DD-NN-asunto.sql y con metadata.script en
-- su asiento manual: de ahí sale «la última migración ejecutada» de base.sql.
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
create temporary table _correccion (codigo text primary key, anterior text not null, nuevo text not null) on commit drop;
insert into _correccion values
  ('CSPFU1889', 'Se dió de baja por petición del cleinte en enero de 2026',
                'Cierre a solicitud del cliente, el 2026-01-14. La cuenta sigue abierta en IBKR solo para que el '
                'cliente descargue estados de cuenta e información fiscal; sin asesoría ni operación desde esa fecha.'),
  ('CSPFU6964', 'Solicitó el cierre de su cuenta por escrito el 7 de octubre',
                'Cierre a solicitud del cliente por escrito, el 2026-10-07.'),
  ('CSPFU7371', 'Solicitó el cierre de su cuenta por escrito el 7 de octubre',
                'Cierre a solicitud del cliente por escrito, el 2026-10-07.');

-- --- 0 · Guardas ---------------------------------------------------------------
do $$
begin
  if (select count(*) from public.clientes c join _correccion x on x.codigo = c.codigo_cliente
       where c.status = 'baja' and c.fecha_baja = date '2026-10-22' and c.motivo_baja = x.anterior) <> 3 then
    raise exception 'guarda: los tres códigos no están de baja con la fecha y el motivo que se van a corregir; '
                    'el script no es re-ejecutable.';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select md5(coalesce(string_agg((to_jsonb(c) - 'motivo_baja')::text, '' order by c.codigo_cliente), ''))
          from public.clientes c where codigo_cliente in (select codigo from _correccion)) as filas,
       (select md5(coalesce(string_agg(to_jsonb(c)::text, '' order by c.codigo_cliente), ''))
          from public.clientes c where codigo_cliente not in (select codigo from _correccion)) as otros;

-- --- 1 · Corrección ------------------------------------------------------------
update public.clientes c set motivo_baja = x.nuevo
  from _correccion x where x.codigo = c.codigo_cliente and c.motivo_baja = x.anterior;

insert into public.bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, motivo, usuario, origen, metadata)
select 'clientes', x.codigo, 'correccion_dato', 'motivo_baja', x.anterior, x.nuevo,
       'La fecha real del cierre de cuenta va en el motivo (regla del 30-sep); desde la app quedó incompleta. '
       'fecha_baja (día del registro) no cambia.',
       fn_firmante_sesion(), 'migracion',
       jsonb_build_object('canal', 'psql', 'script', '2026-10-22-03-motivos-baja-tres.sql')
  from _correccion x;

-- --- 2 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select count(*) from public.clientes c join _correccion x on x.codigo = c.codigo_cliente
       where c.status = 'baja' and c.fecha_baja = date '2026-10-22' and c.motivo_baja = x.nuevo) <> 3 then
    raise exception 'verificación: los tres motivos no quedaron corregidos.';
  end if;
  if (select filas from _antes) is distinct from
     (select md5(coalesce(string_agg((to_jsonb(c) - 'motivo_baja')::text, '' order by c.codigo_cliente), ''))
        from public.clientes c where codigo_cliente in (select codigo from _correccion))
     or (select otros from _antes) is distinct from
     (select md5(coalesce(string_agg(to_jsonb(c)::text, '' order by c.codigo_cliente), ''))
        from public.clientes c where codigo_cliente not in (select codigo from _correccion)) then
    raise exception 'verificación: cambió algo más que motivo_baja, u otro cliente.';
  end if;
  if (select count(*) from public.bitacora where created_at = now()) <> 6
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: los asientos no son 3 del trigger + 3 manuales con el usuario pasado.';
  end if;
end $$;

select codigo_cliente, status, fecha_baja::text as fecha_baja, motivo_baja,
       (select count(*) from public.bitacora where created_at = now())::text as asientos
  from public.clientes where codigo_cliente in (select codigo from _correccion) order by 1;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
