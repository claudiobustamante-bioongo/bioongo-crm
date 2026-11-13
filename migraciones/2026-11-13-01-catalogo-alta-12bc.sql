-- ===========================================================================
-- Alta en el catálogo de 12 tickers que la cartera real ya trae (CSV b y c)
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: tickers y clasificaciones.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026). La salida del
-- real, la verificación por MCP y el md5 van en el mensaje del commit.
--
-- Réplica del repo (npm run replica, con el catálogo vigente de 91 regenerado
-- desde docs/ como datos; su huella coincidió con la de producción): ensayo sin
-- rastro; real con 103 instrumentos, 10 de prorrateo y 13 asientos; re-ejecución
-- detenida en la guarda. Cinco mutaciones, cada una detenida: un ticker repetido
-- (llave única); TIP5 con otra clase, con verificado_en o sin el ISIN en la nota
-- (huella de los 12); y un UPDATE a uno de los 91 (huella de los 91).
-- Una primera versión (33aeb174…, ROLLBACK) se ensayó sin el ISIN en la nota de
-- TIP5; se corrigió el CSV b por decisión de Claudio el mismo día.
-- Ensayo en producción de ESTA versión, 13-nov-2026 (ROLLBACK, código de salida 0,
-- md5 del archivo ensayado 12919e26e5f54eeb53c09d5bb2412204, que solo difiere de
-- este en esta cabecera): 103 instrumentos, 10 de prorrateo, alta ACC_SIC=11
-- GOB_EXT=1, 13 asientos, bitácora 1818 → 1831. Verificado después por MCP: 91
-- instrumentos, bitácora en 1818.
--
-- POR QUÉ
--
-- La vista previa de IBKR del 12-nov-2026 (td 20261111) encontró posiciones en
-- tickers fuera del catálogo. Clase y duración verificadas por Claudio:
-- docs/catalogo_alta_2026-11-12b.csv (7: HSTE, MVOL, NFLX, SPGI, TIP5, VITL,
-- XDWH) y docs/catalogo_alta_2026-11-12c.csv (5: EXUS, SPY4, XDWF, XDWI, XDWS).
-- Cotejo contra el XML del 13-nov-2026 (td 20261112, scripts/ibkr/vista-previa.mjs
-- --verificar): los 5 de c con ISIN igual al del XML; las 12 descripciones
-- son la misma emisión con la abreviatura de IBKR. TIP5 es la clase de
-- distribución del mismo fondo TIPS 0-5 que TI5A (ISIN IE00BDQYWQ65, el mismo que
-- trae el XML; el de curva completa es IDTP, ya en el catálogo): entra GOB_EXT,
-- duración 2.40 y SIN verificado_en (decisión de Claudio, 13-nov-2026).
-- Es el paso «migración 03» del plan del día 62; por la regla del README es la
-- primera del 13-nov.
--
-- QUÉ HACE
--
-- Solo INSERT de 12 instrumentos, generados por scripts/catalogo/csv-a-sql.mjs
-- con los dos CSV (sin prorrateo: ninguno es MIXTO). No toca los 91 existentes
-- ni el prorrateo: sus huellas se comprueban antes y después. Bitácora: 12
-- asientos de trg_bitacora + 1 manual.
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
create temporary table _alta (ticker text primary key) on commit drop;
insert into _alta values ('HSTE'), ('MVOL'), ('NFLX'), ('SPGI'), ('TIP5'), ('VITL'), ('XDWH'),
                         ('EXUS'), ('SPY4'), ('XDWF'), ('XDWI'), ('XDWS');

create or replace function pg_temp.huella_instrumentos(p_alta boolean) returns text language sql as $$
  select md5(string_agg(concat_ws('|', ticker, coalesce(descripcion, ''), asset_category, coalesce(sub_category, ''),
           coalesce(clasificacion_cnbv::text, ''), clase_activo, es_equivalente_efectivo::text, elegible::text,
           coalesce(duracion_efectiva::text, ''), coalesce(nota, ''), coalesce(verificado_en::text, '')),
           E'\n' order by ticker collate "C"))
    from public.catalogo_instrumentos i
   where (i.ticker in (select ticker from _alta)) = p_alta
$$;
create or replace function pg_temp.huella_prorrateo() returns text language sql as $$
  select md5(string_agg(concat_ws('|', ticker, clase_activo, factor::text),
           E'\n' order by ticker collate "C", clase_activo collate "C"))
    from public.catalogo_prorrateo
$$;

do $$
begin
  if exists (select 1 from public.catalogo_instrumentos where ticker in (select ticker from _alta)) then
    raise exception 'guarda: alguno de los 12 ya está en el catálogo; el script no es re-ejecutable.';
  end if;
  if (select count(*) from public.catalogo_instrumentos) <> 91
     or pg_temp.huella_instrumentos(false) is distinct from 'c8aed493093422f3d7a4cee8cf6b70f5'
     or (select count(*) from public.catalogo_prorrateo) <> 10
     or pg_temp.huella_prorrateo() is distinct from '446108959cac51711b1a047e2443c497' then
    raise exception 'guarda: el catálogo no es el del 12-nov-2026 (91 instrumentos y 10 de prorrateo con su huella).';
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
select (select count(*) from public.bitacora) as bitacora;

-- --- 1 · Alta -------------------------------------------------------------------
-- Generado por scripts/catalogo/csv-a-sql.mjs desde docs/catalogo_alta_2026-11-12b.csv (md5 c85a642a9a07a697f71ea91f683b39c7), docs/catalogo_alta_2026-11-12c.csv (md5 4e48d987bc5b5b93405eee8c6d944f1d)
-- sin prorrateo. No se edita a mano: se regenera.
insert into public.catalogo_instrumentos (ticker, descripcion, asset_category, sub_category, clasificacion_cnbv,
  clase_activo, es_equivalente_efectivo, elegible, duracion_efectiva, nota, verificado_en) values
  ('EXUS', 'XTRACKERS MSCI WORLD EX USA UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'ISIN IE0006WW1TQ4. Desarrollados sin EUA; emisoras no mexicanas.', date '2026-11-12'),
  ('HSTE', 'HSBC HANG SENG TECH UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Emisoras de Hong Kong/China; clase por emisor.', date '2026-11-12'),
  ('MVOL', 'ISHARES EDGE MSCI WORLD MIN VOL UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Desarrollados de baja volatilidad; sin emisoras mexicanas. Comprado oct-2026.', date '2026-11-12'),
  ('NFLX', 'NETFLIX INC', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, date '2026-11-12'),
  ('SPGI', 'S&P GLOBAL INC', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, 'Cotiza en SIC (MEXI); emisora no mexicana: ACC_SIC por emisor.', date '2026-11-12'),
  ('SPY4', 'SPDR S&P 400 US MID CAP UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'ISIN IE00B4YBJ215. Mediana capitalización EUA.', date '2026-11-12'),
  ('TIP5', 'ISHARES USD TIPS 0-5 UCITS ETF DIST', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 2.40, 'Duración por supuesto, igual a TI5A (mismo índice, otra clase de reparto). Verificar ISIN y duración en la ficha y fechar. ISIN IE00BDQYWQ65; misma cartera que TI5A.', null),
  ('VITL', 'VITAL FARMS INC', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, date '2026-11-12'),
  ('XDWF', 'XTRACKERS MSCI WORLD FINANCIALS UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'ISIN IE00BM67HL84. Sector financiero global desarrollados.', date '2026-11-12'),
  ('XDWH', 'XTRACKERS MSCI WORLD HEALTH CARE UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Sector salud global desarrollados; comprado oct-2026.', date '2026-11-12'),
  ('XDWI', 'XTRACKERS MSCI WORLD INDUSTRIALS UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'ISIN IE00BM67HV82. Sector industrial global desarrollados.', date '2026-11-12'),
  ('XDWS', 'XTRACKERS MSCI WORLD CONSUMER STAPLES UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'ISIN IE00BM67HN09. Consumo básico global desarrollados.', date '2026-11-12');
create temporary table _esperado on commit drop as
select 12 as instrumentos, 0 as prorrateo,
       'c51fc096cc590db1ea85336d657d9d42'::text as huella_instrumentos, null::text as huella_prorrateo;

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'catalogo-alta-12bc', 'carga_catalogo',
        'Alta de 12 tickers que la cartera real ya trae (vista previa IBKR del 12-nov-2026), con clase y duración '
        'verificadas por Claudio (docs/catalogo_alta_2026-11-12b.csv y …c.csv) y cotejo de ISIN contra el XML del '
        '13-nov-2026. TIP5 (misma cartera que TI5A) sin verificado_en.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-13-01-catalogo-alta-12bc.sql', 'instrumentos', 12,
                           'csv_md5', jsonb_build_object('b', 'c85a642a9a07a697f71ea91f683b39c7',
                                                         'c', '4e48d987bc5b5b93405eee8c6d944f1d')));

-- --- 2 · Verificación dentro de la transacción ---------------------------------
set constraints all immediate;

do $$
declare v_e record;
begin
  select * into v_e from _esperado;
  if v_e.instrumentos <> 12 or v_e.prorrateo <> 0
     or (select count(*) from public.catalogo_instrumentos) <> 103
     or (select count(*) from public.catalogo_instrumentos where ticker in (select ticker from _alta)) <> 12 then
    raise exception 'verificación: no quedaron 103 instrumentos con los 12 de la alta.';
  end if;
  if pg_temp.huella_instrumentos(true) is distinct from v_e.huella_instrumentos then
    raise exception 'verificación: la huella de los 12 no es la de los CSV.';
  end if;
  if pg_temp.huella_instrumentos(false) is distinct from 'c8aed493093422f3d7a4cee8cf6b70f5'
     or (select count(*) from public.catalogo_prorrateo) <> 10
     or pg_temp.huella_prorrateo() is distinct from '446108959cac51711b1a047e2443c497' then
    raise exception 'verificación: los 91 instrumentos o el prorrateo cambiaron.';
  end if;
  if (select (clase_activo, duracion_efectiva, verificado_en) from public.catalogo_instrumentos where ticker = 'TIP5')
       is distinct from ('GOB_EXT'::text, 2.40::numeric(6,2), null::date)
     or (select count(*) from public.catalogo_instrumentos where ticker in (select ticker from _alta)
          and verificado_en is null) <> 1
     or exists (select 1 from public.catalogo_instrumentos where ticker in (select ticker from _alta)
                  and (not elegible or es_equivalente_efectivo or clase_activo = 'MIXTO')) then
    raise exception 'verificación: TIP5, verificado_en o la elegibilidad de la alta no son los acordados.';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 36
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 17
     or (select count(*) from pg_policies where schemaname = 'public') <> 60
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 37 then
    raise exception 'verificación: el esquema cambió de tamaño.';
  end if;
  if (select count(*) from public.bitacora where created_at = now()) <> 13
     or (select count(*) from public.bitacora where created_at = now() and origen = 'trigger'
          and entidad = 'catalogo_instrumentos') <> 12
     or (select count(*) from public.bitacora) <> (select bitacora from _antes) + 13
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: la bitácora no tiene 12 asientos del trigger + 1 manual con el usuario pasado.';
  end if;
end $$;

select (select count(*) from public.catalogo_instrumentos)::text as instrumentos,
       (select count(*) from public.catalogo_prorrateo)::text as prorrateo,
       (select string_agg(clase_activo || '=' || n, ' ' order by clase_activo collate "C")
          from (select clase_activo, count(*) n from public.catalogo_instrumentos
                 where ticker in (select ticker from _alta) group by 1) x) as clases_alta,
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
