-- ===========================================================================
-- Alta en el catálogo de los 12 tickers del motor de portafolios
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
-- Réplica del repo (npm run replica, con el catálogo vigente regenerado desde
-- docs/ como datos): ensayo sin rastro; real con 91 instrumentos, 10 de
-- prorrateo y 13 asientos; re-ejecución detenida en la guarda. Cuatro mutaciones,
-- cada una detenida: un ticker repetido (llave única), EWW como ACC_SIC (huella
-- de los 12), IDTP sin duración (huella de los 12) y un UPDATE a uno de los 79
-- (huella de los 79).
-- Ensayo en producción, 12-nov-2026 (ROLLBACK, código de salida 0, md5 del archivo
-- ensayado 4b401a2b9426aea0d4464d04105898eb, que solo difiere de este en esta
-- cabecera): 91 instrumentos, 10 de prorrateo, alta ACC_BMV=1 ACC_SIC=9 GOB_EXT=1
-- HIGH_YIELD=1, 13 asientos, bitácora 1803 → 1816. Verificado después por MCP:
-- 79 instrumentos, ninguno de la alta, bitácora en 1803.
--
-- POR QUÉ
--
-- 12 de los 27 tickers del universo de lib/ips-portafolios.ts no estaban en el
-- catálogo (revisión del 12-nov-2026); IDTP ya está en el portafolio vigente de
-- un cliente. Sin alta, el semáforo los vería fuera de catálogo. Clase y
-- duración verificadas por Claudio el 12-nov-2026 (docs/catalogo_alta_2026-11-12.csv):
-- EWW es ACC_BMV por emisor (cotiza en NYSE en USD, emisoras mexicanas); IUIT,
-- antes «satélite de tecnología», es ACC_SIC; IDTP es GOB_EXT con duración 6.55.
--
-- QUÉ HACE
--
-- Solo INSERT de 12 instrumentos, generados por scripts/catalogo/csv-a-sql.mjs
-- (sin prorrateo: ninguno es MIXTO). No toca los 79 existentes ni el prorrateo:
-- sus huellas se comprueban antes y después. Bitácora: 12 asientos de
-- trg_bitacora + 1 manual (1803 → 1816).
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
insert into _alta values ('CNDX'), ('CSPX'), ('EIMI'), ('EWW'), ('IDTP'), ('IHYA'), ('IUIT'), ('IWDA'), ('QQQ'),
                         ('QQQM'), ('VEA'), ('VTV');

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
  if (select count(*) from public.catalogo_instrumentos) <> 79
     or pg_temp.huella_instrumentos(false) is distinct from '852f8eff0c214e8766add956758c55d4'
     or (select count(*) from public.catalogo_prorrateo) <> 10
     or pg_temp.huella_prorrateo() is distinct from '446108959cac51711b1a047e2443c497' then
    raise exception 'guarda: el catálogo no es el del 11-nov-2026 (79 instrumentos y 10 de prorrateo con su huella).';
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
-- Generado por scripts/catalogo/csv-a-sql.mjs desde docs/catalogo_alta_2026-11-12.csv (md5 d6bdc32091e950ee022c2e34e9c5774b)
-- sin prorrateo. No se edita a mano: se regenera.
insert into public.catalogo_instrumentos (ticker, descripcion, asset_category, sub_category, clasificacion_cnbv,
  clase_activo, es_equivalente_efectivo, elegible, duracion_efectiva, nota, verificado_en) values
  ('CNDX', 'ISHARES NASDAQ 100 UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Universo del motor; clase por emisor (no mexicanas).', date '2026-11-12'),
  ('CSPX', 'ISHARES CORE S&P 500 UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Universo del motor; clase por emisor (no mexicanas).', date '2026-11-12'),
  ('EIMI', 'ISHARES CORE MSCI EM IMI UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Emergentes; incluye una fracción menor de emisoras mexicanas sin prorratear.', date '2026-11-12'),
  ('EWW', 'ISHARES MSCI MEXICO ETF', 'STK', 'ETF', 113, 'ACC_BMV', false, true, null, 'Cotiza en NYSE en USD, pero sus emisoras son mexicanas: ACC_BMV por emisor (decisión del Asesor 11-nov-2026).', date '2026-11-12'),
  ('IDTP', 'ISHARES USD TIPS UCITS ETF', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 6.55, 'Duración efectiva al 2026-09-09. En el portafolio del motor de un cliente vigente.', date '2026-11-12'),
  ('IHYA', 'ISHARES USD HIGH YIELD CORP BOND UCITS ETF ACC', 'STK', 'ETF', 113, 'HIGH_YIELD', false, true, null, 'Universo UCITS del motor.', date '2026-11-12'),
  ('IUIT', 'ISHARES S&P 500 INFORMATION TECHNOLOGY SECTOR UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Antes «satélite de tecnología» en el motor; para cumplimiento es ACC_SIC.', date '2026-11-12'),
  ('IWDA', 'ISHARES CORE MSCI WORLD UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Universo UCITS del motor.', date '2026-11-12'),
  ('QQQ', 'INVESCO QQQ TRUST', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Universo del motor; clase por emisor (no mexicanas).', date '2026-11-12'),
  ('QQQM', 'INVESCO NASDAQ 100 ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Universo del motor; clase por emisor (no mexicanas).', date '2026-11-12'),
  ('VEA', 'VANGUARD FTSE DEVELOPED MARKETS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Universo del motor; clase por emisor (no mexicanas).', date '2026-11-12'),
  ('VTV', 'VANGUARD VALUE ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, 'Universo del motor; clase por emisor (no mexicanas).', date '2026-11-12');
create temporary table _esperado on commit drop as
select 12 as instrumentos, 0 as prorrateo,
       '21567339a47d461a89df9a9a20325456'::text as huella_instrumentos, null::text as huella_prorrateo;

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'catalogo-alta-motor', 'carga_catalogo',
        'Alta de los 12 tickers del universo del motor de portafolios que no estaban en el catálogo; clase y '
        'duración verificadas por Claudio (docs/catalogo_alta_2026-11-12.csv). EWW como ACC_BMV por emisor.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-12-02-catalogo-alta-motor.sql', 'instrumentos', 12,
                           'csv_md5', 'd6bdc32091e950ee022c2e34e9c5774b'));

-- --- 2 · Verificación dentro de la transacción ---------------------------------
set constraints all immediate;

do $$
declare v_e record;
begin
  select * into v_e from _esperado;
  if v_e.instrumentos <> 12 or v_e.prorrateo <> 0
     or (select count(*) from public.catalogo_instrumentos) <> 91
     or (select count(*) from public.catalogo_instrumentos where ticker in (select ticker from _alta)) <> 12 then
    raise exception 'verificación: no quedaron 91 instrumentos con los 12 de la alta.';
  end if;
  if pg_temp.huella_instrumentos(true) is distinct from v_e.huella_instrumentos then
    raise exception 'verificación: la huella de los 12 no es la del CSV.';
  end if;
  if pg_temp.huella_instrumentos(false) is distinct from '852f8eff0c214e8766add956758c55d4'
     or (select count(*) from public.catalogo_prorrateo) <> 10
     or pg_temp.huella_prorrateo() is distinct from '446108959cac51711b1a047e2443c497' then
    raise exception 'verificación: los 79 instrumentos o el prorrateo cambiaron.';
  end if;
  if (select clase_activo from public.catalogo_instrumentos where ticker = 'EWW') is distinct from 'ACC_BMV'
     or (select (clase_activo, duracion_efectiva) from public.catalogo_instrumentos where ticker = 'IDTP')
        is distinct from ('GOB_EXT'::text, 6.55::numeric(6,2))
     or exists (select 1 from public.catalogo_instrumentos where ticker in (select ticker from _alta)
                  and (not elegible or es_equivalente_efectivo or clase_activo = 'MIXTO')) then
    raise exception 'verificación: EWW, IDTP o la elegibilidad de la alta no son los acordados.';
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
