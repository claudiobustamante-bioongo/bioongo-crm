-- ===========================================================================
-- Catálogo de instrumentos y CHECKs (paso 1 del build v1: D1, D3 y carga M1)
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
-- Réplica del repo (npm run replica, datos sintéticos con un cliente): ensayo sin
-- rastro; real con 79 / 10 / 6 no elegibles / 66 sin verificado_en / 90 asientos;
-- re-ejecución detenida en la guarda. Siete mutaciones, cada una detenida por su
-- causa: factor de AGGU que suma 0.99990 (trigger diferido, gracias al set
-- constraints all immediate), GLD elegible (catalogo_no_elegibles), un renglón de
-- menos (conteo), COMMODITY fuera del CHECK (catalogo_clase_valida), una
-- descripción alterada (huella), la función sin reescribir (verificación del
-- cuerpo) y la ruta sin ampliar (la autoprueba al archivar constancia_pl03).
-- Una primera versión sin la ruta ampliada se ensayó en producción el mismo día
-- (cd733293…, ROLLBACK); el defecto lo encontró después lib/documentos.test.ts.
-- Ensayo en producción de ESTA versión, 11-nov-2026 (ROLLBACK, código de salida 0,
-- md5 del archivo ensayado 5e165c218efeabf552d14ad26faf7e26, que solo difiere de
-- este en esta cabecera): autoprueba completa (6 tipos nuevos + 1 con fecha
-- archivados por fn_registrar_documento y revertidos), 79 instrumentos, 10 de
-- prorrateo, 6 no elegibles, 66 sin verificado_en, 90 asientos, bitácora
-- 1648 → 1738. Verificado después por MCP: catálogo vacío, 28 documentos, CHECKs y
-- md5 de fn_registrar_documento y de documentos_ruta_forma sin cambio, bitácora
-- en 1648.
--
-- POR QUÉ
--
-- docs/SPEC_Build_Bioongo_v1_2026-11-10.md, §2 y §3 M1 («migración 02»: es el
-- paso del plan, no el orden del día). Decisiones de Claudio del 11-nov-2026:
-- son 79 tickers (el SPEC dice 80; también dice 54 sin verificado_en y son 66);
-- CHECK de equivalente de efectivo aprobado; D4 (corte_regulatorio) se difiere a
-- la migración que construya el corte semestral; D2 y D5 no van aquí.
--
-- QUÉ HACE
--
-- 1. D1: COMMODITY y APALANCADO en catalogo_clase_valida y prorrateo_clase_valida.
--    CHECK nuevo catalogo_no_elegibles: COMMODITY, APALANCADO, CRIPTO o DERIVADO ⇒
--    elegible = false. CHECK nuevo catalogo_equivalente_duracion: equivalente de
--    efectivo ⇒ duración no nula y ≤ 1 (ESPEC_IBKR_Flex §3.2.8).
-- 2. D3: ips_firmado, constancia_pl03, expediente_apertura, aviso_cliente,
--    evidencia_remediacion y otro en documentos_tipo_valido y en
--    fn_registrar_documento. La función se reescribe desde su propia definición
--    reemplazando SOLO la lista de tipos: su cuerpo lleva CRLF y reescribirla a
--    mano cambiaría bytes que no deben cambiar. Guarda por md5 del cuerpo actual;
--    la verificación exige cuerpo nuevo = viejo con ese único reemplazo.
--    lib/documentos.ts cambia en el mismo commit.
--    documentos_ruta_forma pasa de '^[a-z_]+/' a '^[a-z][a-z0-9_]*/' (el resto de
--    la forma igual): constancia_pl03 lleva dígitos y con la forma vieja ningún PDF
--    de ese tipo podría archivarse. Lo detectó el test de lib/documentos.test.ts que
--    recorre todos los tipos; las 28 rutas existentes cumplen la forma nueva.
--    Aprobado por Claudio el 11-nov-2026.
-- 3. M1: carga de docs/catalogo_instrumentos.csv (79) y docs/catalogo_prorrateo.csv
--    (10) generada por scripts/catalogo/csv-a-sql.mjs; vacío → NULL. La huella del
--    contenido (md5 de un texto canónico) se compara con la que da la base.
-- 4. set constraints all immediate antes de verificar: el trigger de suma del
--    prorrateo es diferido y, sin esto, un ensayo con ROLLBACK nunca lo dispararía.
-- 5. Bitácora: 79 + 10 asientos de trg_bitacora y 1 manual (1648 → 1738).
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
  if exists (select 1 from public.catalogo_instrumentos) or exists (select 1 from public.catalogo_prorrateo) then
    raise exception 'guarda: el catálogo ya tiene filas; el script no es re-ejecutable.';
  end if;
  if exists (select 1 from pg_constraint where conname in ('catalogo_no_elegibles', 'catalogo_equivalente_duracion'))
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'catalogo_clase_valida')) like '%COMMODITY%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'documentos_tipo_valido')) like '%otro%' then
    raise exception 'guarda: los CHECK ya están cambiados.';
  end if;
  if (select md5(prosrc) from pg_proc
       where oid = 'public.fn_registrar_documento(text,text,text,text,integer,date,uuid)'::regprocedure)
     is distinct from 'ee626ef9cffa5693eb45f3ad34ab269c' then
    raise exception 'guarda: fn_registrar_documento no es la versión esperada (md5 del cuerpo).';
  end if;
  if (select md5(pg_get_constraintdef(oid)) from pg_constraint where conname = 'documentos_ruta_forma')
     is distinct from '5d63532f712e4ce9bdaccd92c55580a8' then
    raise exception 'guarda: documentos_ruta_forma no es la versión esperada (md5 de su definición).';
  end if;
  if not exists (select 1 from public.clientes where codigo_cliente ~ '^CSP[FM]U[0-9]{4}$') then
    raise exception 'guarda: no hay un cliente con código válido para la autoprueba de documentos.';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 32
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 17
     or (select count(*) from pg_policies where schemaname = 'public') <> 56
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 33 then
    raise exception 'guarda: el esquema no es el esperado (32 tablas, 17 funciones, 56 políticas, 33 triggers).';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select md5(coalesce(string_agg(to_jsonb(d)::text, '' order by d.id), '')) from public.documentos_expediente d) as documentos,
       (select count(*) from public.bitacora) as bitacora;

-- --- 1 · D1: clases y CHECKs del catálogo ----------------------------------------
alter table public.catalogo_instrumentos drop constraint catalogo_clase_valida;
alter table public.catalogo_instrumentos add constraint catalogo_clase_valida check (clase_activo in ('GOB_MX',
  'GOB_EXT', 'GOB_EMERGENTE', 'CORP_IG', 'HIGH_YIELD', 'ACC_BMV', 'ACC_SIC', 'CRIPTO', 'MIXTO', 'DERIVADO',
  'EFECTIVO', 'COMMODITY', 'APALANCADO'));
alter table public.catalogo_prorrateo drop constraint prorrateo_clase_valida;
alter table public.catalogo_prorrateo add constraint prorrateo_clase_valida check (clase_activo in ('GOB_MX',
  'GOB_EXT', 'GOB_EMERGENTE', 'CORP_IG', 'HIGH_YIELD', 'ACC_BMV', 'ACC_SIC', 'CRIPTO', 'EFECTIVO', 'COMMODITY',
  'APALANCADO'));
alter table public.catalogo_instrumentos add constraint catalogo_no_elegibles
  check (clase_activo not in ('COMMODITY', 'APALANCADO', 'CRIPTO', 'DERIVADO') or not elegible);
alter table public.catalogo_instrumentos add constraint catalogo_equivalente_duracion
  check (not es_equivalente_efectivo or (duracion_efectiva is not null and duracion_efectiva <= 1));

-- --- 2 · D3: tipos de documento -------------------------------------------------
alter table public.documentos_expediente drop constraint documentos_tipo_valido;
alter table public.documentos_expediente add constraint documentos_tipo_valido check (tipo in ('carta_clasificacion', 'identificacion', 'comprobante_domicilio', 'constancia_fiscal', 'contrato', 'ips_firmado', 'constancia_pl03', 'expediente_apertura', 'aviso_cliente', 'evidencia_remediacion', 'otro'));

-- La ruta: solo cambia el primer segmento (el tipo puede llevar dígitos, no empezar con ellos).
alter table public.documentos_expediente drop constraint documentos_ruta_forma;
alter table public.documentos_expediente add constraint documentos_ruta_forma check (
      ruta_storage ~ '^[a-z][a-z0-9_]*/CSP[FM]U[0-9]{4}/([0-9]{4}-[0-9]{2}-[0-9]{2}|sin-fecha)_[0-9a-f]{12}\.pdf$'
  and split_part(ruta_storage, '/', 1) = tipo
  and split_part(ruta_storage, '/', 2) = codigo_cliente
  and substring(ruta_storage from '_([0-9a-f]{12})\.pdf$') = left(sha256, 12)
  and (fecha_documento is null) = (position('/sin-fecha_' in ruta_storage) > 0));

do $$
declare
  v_oid    oid := 'public.fn_registrar_documento(text,text,text,text,integer,date,uuid)'::regprocedure;
  v_patron constant text := 'p_tipo not in \(''carta_clasificacion'', ''identificacion'', ''comprobante_domicilio'',\s+''constancia_fiscal'', ''contrato''\)';
  v_lista  constant text := 'p_tipo not in (''carta_clasificacion'', ''identificacion'', ''comprobante_domicilio'', ''constancia_fiscal'', ''contrato'', ''ips_firmado'', ''constancia_pl03'', ''expediente_apertura'', ''aviso_cliente'', ''evidencia_remediacion'', ''otro'')';
  v_antes  text;
  v_def    text;
begin
  select prosrc into v_antes from pg_proc where oid = v_oid;
  v_def := pg_get_functiondef(v_oid);
  if regexp_count(v_antes, v_patron) <> 1 or regexp_count(v_def, v_patron) <> 1 then
    raise exception 'D3: la lista de tipos de fn_registrar_documento no aparece exactamente una vez.';
  end if;
  execute regexp_replace(v_def, v_patron, v_lista);
  if (select prosrc from pg_proc where oid = v_oid) is distinct from regexp_replace(v_antes, v_patron, v_lista) then
    raise exception 'D3: el cuerpo nuevo de fn_registrar_documento no es el viejo con solo la lista cambiada.';
  end if;
end $$;

-- --- 3 · M1: carga del catálogo ------------------------------------------------
-- Generado por scripts/catalogo/csv-a-sql.mjs desde docs/catalogo_instrumentos.csv (md5 db36f06fa5055332ffe02cb51c19b803)
-- y docs/catalogo_prorrateo.csv (md5 ab90e2a3072fc255f24fad1ac0b1583c). No se edita a mano: se regenera.
insert into public.catalogo_instrumentos (ticker, descripcion, asset_category, sub_category, clasificacion_cnbv,
  clase_activo, es_equivalente_efectivo, elegible, duracion_efectiva, nota, verificado_en) values
  ('AAXJ', 'ISHARES MSCI ALL COUNTRY ASI', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('ADBE', 'ADOBE INC', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, date '2026-10-07'),
  ('AGGU', 'ISHARES CORE GLB AGG USD-H A', 'STK', 'ETF', 113, 'MIXTO', false, true, 6.00, 'Fondo mixto: requiere prorrateo por prospecto (Politica de Producto 3.1)', null),
  ('ARKF', 'ARK BLOCKCHAIN & FINTECH INN', 'STK', 'ETF', 113, 'CRIPTO', false, false, null, 'Exposición directa a bitcoin (Ark Bitcoin ETF Holdco 5.10%) y ~25% en emisoras cripto. Constancia §6.', date '2026-10-01'),
  ('ARKK', 'ARK INNOVATION ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('ASML', 'ASML HOLDING NV - NY REG SHS', 'STK', 'NY REG SHRS', 101, 'ACC_SIC', false, true, null, null, date '2026-10-07'),
  ('BIL', 'SS SPDR BB 1-3M T-BILL ETF', 'STK', 'ETF', 113, 'GOB_EXT', true, true, 0.15, null, null),
  ('BND', 'VANGUARD TOTAL BOND MARKET', 'STK', 'ETF', 113, 'MIXTO', false, true, 5.80, 'Fondo mixto: requiere prorrateo por prospecto (Politica de Producto 3.1)', null),
  ('BNDW', 'VANGUARD TOTAL WORLD BOND ET', 'STK', 'ETF', 113, 'MIXTO', false, true, 6.50, 'Fondo mixto: requiere prorrateo por prospecto (Politica de Producto 3.1)', null),
  ('BNDX', 'VANGUARD TOTAL INTL BOND ETF', 'STK', 'ETF', 113, 'MIXTO', false, true, 7.00, 'Fondo mixto: requiere prorrateo por prospecto (Politica de Producto 3.1)', null),
  ('CBU7', 'ISHARES USD TREASURY BOND 3-7YR UCITS (IE00B3VWN393)', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 4.50, null, date '2026-10-08'),
  ('CEG', 'CONSTELLATION ENERGY', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, null),
  ('CNYA', 'ISHARES MSCI CHINA A', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('DTLA', 'ISH USD TRES 20PLUS YR USD A', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 16.00, null, null),
  ('EMB', 'ISHARES J.P. MORGAN USD EMERGI', 'STK', 'ETF', 113, 'GOB_EMERGENTE', false, true, 7.00, null, null),
  ('ETN', 'EATON CORP PLC', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, null),
  ('FUSA', 'FIDELITY US QUAL INCOME-ACC', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('GLD', 'SPDR GOLD SHARES', 'STK', 'ETF', 113, 'COMMODITY', false, false, null, 'ETF de materias primas: no elegible (Politica de Producto 3.1)', null),
  ('GOOGL', 'ALPHABET INC-CL A', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, null),
  ('HDV', 'ISHARES CORE HIGH DIVIDEND E', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('HMAD', 'HSBC MSCI AC FAR EAST EX JAP', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('HYG', 'ISHR IBX USD HIYLD CB ETF-UI', 'STK', 'ETF', 113, 'HIGH_YIELD', false, true, null, null, null),
  ('IB01', 'ISHARES US TREAS 0-1YR USD A', 'STK', 'ETF', 113, 'GOB_EXT', true, true, 0.40, null, null),
  ('IBB', 'ISHARES BIOTECHNOLOGY ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('IBTA', 'ISHARES USD TRSRY 1-3Y USD A', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 1.85, null, null),
  ('ICGA', 'ISHARES MSCI CHINA USD ACC', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('IDTL', 'ISHARES USD TRES 20PLUS YR', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 16.00, null, null),
  ('IEAA', 'ISHARES CORE EUR CORP EUR A', 'STK', 'ETF', 113, 'CORP_IG', false, true, null, null, null),
  ('IEF', 'ISHARES 7-10 YEAR TREASURY B', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 7.00, null, null),
  ('IGLN', 'ISHARES PHYSICAL GOLD ETC', 'STK', 'ETF', 113, 'COMMODITY', false, false, null, 'ETF de materias primas: no elegible (Politica de Producto 3.1)', null),
  ('INDA', 'ISHARES MSCI INDIA ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('IUVL', 'ISHARES EDGE MSCI USA VALUE', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('IVV', 'ISHARES CORE S&P 500 ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('IVVPESOISHRS', 'ISHARES S&P PESO HEDGED TRAC', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('IWF', 'ISHARES RUSSELL 1000 GROWTH', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('IWN', 'ISHARES RUSSELL 2000 VALUE E', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('IWR', 'ISHARES RUSSELL MID-CAP ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('IWS', 'ISHARES RUSSELL MID-CAP VALU', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('KWEB', 'KRANESH CSI CHINA INTERNET', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('LLY', 'ELI LILLY & CO', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, null),
  ('LQD', 'ISHR IBX USD INVGD CB ETF-UI', 'STK', 'ETF', 113, 'CORP_IG', false, true, null, null, null),
  ('LQDA', 'ISHARES USD CORP BOND USD A', 'STK', 'ETF', 113, 'CORP_IG', false, true, null, null, null),
  ('MCHI', 'ISHARES MSCI CHINA ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('MNST', 'MONSTER BEVERAGE CORP', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, date '2026-10-07'),
  ('MSFT', 'MICROSOFT CORP', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, null),
  ('NDIA', 'ISHARES MSCI INDIA UCITS ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('NVO', 'NOVO NORDISK A/S-SPONS ADR', 'STK', 'ADR', 101, 'ACC_SIC', false, true, null, null, date '2026-10-07'),
  ('PEP', 'PEPSICO INC', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, date '2026-10-07'),
  ('QVMT', 'INVESCO S&P 500 CONCENTRATED', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('REGN', 'REGENERON PHARMACEUTICALS', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, null),
  ('RSP', 'INVESCO S&P 500 EQUAL WEIGHT', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('SCHP', 'SCHWAB U.S. TIPS ETF', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 6.50, null, null),
  ('SDHA', 'ISH USD SHRT HY CRP USD ACC', 'STK', 'ETF', 113, 'HIGH_YIELD', false, true, null, null, null),
  ('SDHY', 'PGIM SHRT DURAT HI YLD', 'STK', 'CLOSED-END FUND', 101, 'HIGH_YIELD', false, true, null, null, null),
  ('SDIA', 'ISHARES USD SHORT DUR USD A', 'STK', 'ETF', 113, 'CORP_IG', false, true, null, null, null),
  ('SGLN', 'ISHARES PHYSICAL GOLD ETC', 'STK', 'ETF', 113, 'COMMODITY', false, false, null, 'ETF de materias primas: no elegible (Politica de Producto 3.1)', null),
  ('SGOV', 'ISHARES 0-3 MONTH TREASURY B', 'STK', 'ETF', 113, 'GOB_EXT', true, true, 0.10, null, null),
  ('SHY', 'ISHARES 1-3 YEAR TREASURY BO', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 1.85, null, null),
  ('SXRL', 'ISHARES USD TREASURY 3-7YR', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 4.50, null, null),
  ('TI5A', 'ISHARES USD TIPS 0-5 USD ACC', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 2.40, null, null),
  ('TLT', 'ISHARES 20+ YEAR TREASURY BD', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 16.00, null, null),
  ('TMO', 'THERMO FISHER SCIENTIFIC INC', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, null),
  ('TSM', 'TAIWAN SEMICONDUCTOR-SP ADR', 'STK', 'ADR', 101, 'ACC_SIC', false, true, null, null, null),
  ('UVIX', '2X LONG VIX FUTURES ETF', 'STK', 'ETF', 113, 'APALANCADO', false, false, null, 'ETF apalancado: no elegible (Constancia 6, Politica de Producto 4)', null),
  ('VAPU', 'VANG FTSEAPXJ USDA', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('VCIT', 'VANGUARD INTERMEDIATE-TERM CORP', 'STK', 'ETF', 113, 'CORP_IG', false, true, 6.00, null, date '2026-10-06'),
  ('VCSH', 'VANGUARD SHORT-TERM CORP BOND', 'STK', 'ETF', 113, 'CORP_IG', false, true, 2.60, null, date '2026-10-06'),
  ('VGIT', 'VANGUARD INTERMEDIATE-TERM TREAS', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 5.00, null, date '2026-10-06'),
  ('VGSH', 'VANGUARD SHORT-TERM TREASURY', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 1.90, null, date '2026-10-06'),
  ('VNQ', 'VANGUARD REAL ESTATE ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('VOO', 'VANGUARD S&P 500 ETF', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('VRTX', 'VERTEX PHARMACEUTICALS INC', 'STK', 'COMMON', 101, 'ACC_SIC', false, true, null, null, null),
  ('VTIP', 'VANGUARD SHORT-TERM INFL-PROT', 'STK', 'ETF', 113, 'GOB_EXT', false, true, 2.50, null, date '2026-10-06'),
  ('VWO', 'VANGUARD FTSE EMERGING MARKE', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('WGLD', 'WISDOMTREE CORE PHYSICAL GLD', 'STK', 'ETF', 113, 'COMMODITY', false, false, null, 'ETF de materias primas: no elegible (Politica de Producto 3.1)', null),
  ('XDEW', 'X S&P 500 EW 1C', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('XLF', 'SS FINANCIAL SELECT SECTOR', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('XLP', 'SS CONSUMER STAPLES SEL SECT', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, null),
  ('ZPDU', 'SPDR S&P US UTILITIES SELECT SECTOR UCITS (IE00BWBXMB69)', 'STK', 'ETF', 113, 'ACC_SIC', false, true, null, null, date '2026-10-08');
insert into public.catalogo_prorrateo (ticker, clase_activo, factor) values
  ('AGGU', 'CORP_IG', 0.31370),
  ('AGGU', 'GOB_EXT', 0.68630),
  ('BND', 'CORP_IG', 0.28000),
  ('BND', 'GOB_EXT', 0.72000),
  ('BNDW', 'CORP_IG', 0.25470),
  ('BNDW', 'EFECTIVO', 0.00480),
  ('BNDW', 'GOB_EXT', 0.74050),
  ('BNDX', 'CORP_IG', 0.22790),
  ('BNDX', 'EFECTIVO', 0.00990),
  ('BNDX', 'GOB_EXT', 0.76220);
create temporary table _esperado on commit drop as
select 79 as instrumentos, 10 as prorrateo,
       '852f8eff0c214e8766add956758c55d4'::text as huella_instrumentos, '446108959cac51711b1a047e2443c497'::text as huella_prorrateo;

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'catalogo-y-checks', 'ddl_y_carga',
        'Paso 1 del build v1: D1 (COMMODITY, APALANCADO, no elegibles, equivalente de efectivo), D3 (6 tipos de '
        'documento) y carga del catálogo desde docs/ (79 instrumentos, 10 de prorrateo). D4 diferido.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-11-01-catalogo-y-checks.sql',
                           'instrumentos', 79, 'prorrateo', 10,
                           'csv_instrumentos_md5', 'db36f06fa5055332ffe02cb51c19b803',
                           'csv_prorrateo_md5', 'ab90e2a3072fc255f24fad1ac0b1583c'));

-- --- 4 · Autoprueba (se revierte entera con IBOK0) ----------------------------------
do $$
declare
  v_cli   text := (select codigo_cliente from public.clientes
                    where codigo_cliente ~ '^CSP[FM]U[0-9]{4}$' order by codigo_cliente limit 1);
  v_tipos text[] := array['ips_firmado', 'constancia_pl03', 'expediente_apertura', 'aviso_cliente',
                          'evidencia_remediacion', 'otro'];
  v_t     text;
  v_sha   text;
  v_r     jsonb;
begin
  begin
    begin
      insert into public.catalogo_instrumentos (ticker, asset_category, clase_activo, elegible)
      values ('ZZORO', 'STK', 'COMMODITY', true);
      raise exception 'autoprueba: un COMMODITY elegible no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      insert into public.catalogo_instrumentos (ticker, asset_category, clase_activo, elegible, es_equivalente_efectivo, duracion_efectiva)
      values ('ZZEQ1', 'STK', 'GOB_EXT', true, true, 1.5);
      raise exception 'autoprueba: un equivalente de efectivo con duración 1.5 no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      insert into public.catalogo_instrumentos (ticker, asset_category, clase_activo, elegible, es_equivalente_efectivo)
      values ('ZZEQ2', 'STK', 'GOB_EXT', true, true);
      raise exception 'autoprueba: un equivalente de efectivo sin duración no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    insert into public.catalogo_instrumentos (ticker, asset_category, clase_activo, elegible)
    values ('ZZAPAL', 'STK', 'APALANCADO', false);
    begin
      perform public.fn_registrar_documento('CSPFU9999', 'tipo_inexistente', 'x', 'zz', 1, null);
      raise exception 'autoprueba: un tipo inexistente no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'DX400' then
      if sqlerrm <> 'Tipo de documento no válido.' then
        raise exception 'autoprueba: el tipo inexistente se detuvo por otra razón: %', sqlerrm using errcode = 'IBFAL';
      end if;
    end;
    -- Con un tipo nuevo, la función pasa la validación del tipo y se detiene en la siguiente (el sha256).
    begin
      perform public.fn_registrar_documento('CSPFU9999', 'evidencia_remediacion', 'x', 'zz', 1, null);
      raise exception 'autoprueba: el sha256 inválido no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'DX400' then
      if sqlerrm <> 'sha256 con forma inválida.' then
        raise exception 'autoprueba: el tipo nuevo no pasó la validación del tipo: %', sqlerrm using errcode = 'IBFAL';
      end if;
    end;
    -- Un documento de cada tipo nuevo, archivado de verdad por la función: pasa el
    -- tipo, la ruta (con dígitos en constancia_pl03) y todos los CHECK de la tabla.
    foreach v_t in array v_tipos loop
      v_sha := md5(v_t) || md5('autoprueba-' || v_t);
      v_r := public.fn_registrar_documento(v_cli, v_t, v_t || '/' || v_cli || '/sin-fecha_' || left(v_sha, 12) || '.pdf',
                                           v_sha, 1024, null);
      if v_r ->> 'modo' is distinct from 'archivo' or v_r ->> 'tipo' is distinct from v_t then
        raise exception 'autoprueba: el documento % no se archivó en modo archivo.', v_t using errcode = 'IBFAL';
      end if;
    end loop;
    v_sha := md5('constancia_pl03-fecha') || md5('autoprueba-fecha');
    perform public.fn_registrar_documento(v_cli, 'constancia_pl03',
                                          'constancia_pl03/' || v_cli || '/2026-11-01_' || left(v_sha, 12) || '.pdf',
                                          v_sha, 1024, date '2026-11-01');
    if (select count(*) from public.documentos_expediente where codigo_cliente = v_cli and tipo = any (v_tipos)) <> 7 then
      raise exception 'autoprueba: no quedaron los 7 documentos de prueba.' using errcode = 'IBFAL';
    end if;
    raise exception 'autoprueba completa' using errcode = 'IBOK0';
  exception when sqlstate 'IBOK0' then null;
  end;
end $$;

-- --- 5 · Verificación dentro de la transacción ---------------------------------
set constraints all immediate;

do $$
declare v_e record;
begin
  select * into v_e from _esperado;
  if (select count(*) from public.catalogo_instrumentos) <> v_e.instrumentos or v_e.instrumentos <> 79
     or (select count(*) from public.catalogo_prorrateo) <> v_e.prorrateo or v_e.prorrateo <> 10 then
    raise exception 'verificación: no quedaron 79 instrumentos y 10 renglones de prorrateo.';
  end if;
  if (select md5(string_agg(concat_ws('|', ticker, coalesce(descripcion, ''), asset_category, coalesce(sub_category, ''),
              coalesce(clasificacion_cnbv::text, ''), clase_activo, es_equivalente_efectivo::text, elegible::text,
              coalesce(duracion_efectiva::text, ''), coalesce(nota, ''), coalesce(verificado_en::text, '')),
              E'\n' order by ticker collate "C")) from public.catalogo_instrumentos) <> v_e.huella_instrumentos then
    raise exception 'verificación: la huella de catalogo_instrumentos no es la del CSV.';
  end if;
  if (select md5(string_agg(concat_ws('|', ticker, clase_activo, factor::text),
              E'\n' order by ticker collate "C", clase_activo collate "C")) from public.catalogo_prorrateo)
     <> v_e.huella_prorrateo then
    raise exception 'verificación: la huella de catalogo_prorrateo no es la del CSV.';
  end if;
  if (select string_agg(clase_activo || '=' || n, ' ' order by clase_activo collate "C")
        from (select clase_activo, count(*) n from public.catalogo_instrumentos group by 1) x)
     <> 'ACC_SIC=43 APALANCADO=1 COMMODITY=4 CORP_IG=6 CRIPTO=1 GOB_EMERGENTE=1 GOB_EXT=16 HIGH_YIELD=3 MIXTO=4' then
    raise exception 'verificación: los conteos por clase no son los del CSV.';
  end if;
  if (select string_agg(ticker, ',' order by ticker collate "C") from public.catalogo_instrumentos where not elegible)
     <> 'ARKF,GLD,IGLN,SGLN,UVIX,WGLD'
     or (select count(*) from public.catalogo_instrumentos where es_equivalente_efectivo) <> 3
     or (select count(*) from public.catalogo_instrumentos where verificado_en is not null) <> 13
     or (select count(*) from public.catalogo_instrumentos where duracion_efectiva is not null) <> 23
     or (select count(*) from public.catalogo_instrumentos where nota is not null) <> 10 then
    raise exception 'verificación: no elegibles, equivalentes, verificado_en, duración o notas no cuadran.';
  end if;
  if (select string_agg(ticker || '=' || s, ' ' order by ticker collate "C")
        from (select ticker, sum(factor) s from public.catalogo_prorrateo group by 1) x)
     <> 'AGGU=1.00000 BND=1.00000 BNDW=1.00000 BNDX=1.00000' then
    raise exception 'verificación: los factores del prorrateo no suman 1.00000 por ticker.';
  end if;
  if not has_function_privilege('authenticated', 'public.fn_registrar_documento(text,text,text,text,integer,date,uuid)', 'execute')
     or has_function_privilege('anon', 'public.fn_registrar_documento(text,text,text,text,integer,date,uuid)', 'execute')
     or (select prosecdef is not true or array_to_string(proconfig, ',') <> 'search_path=public' from pg_proc
          where oid = 'public.fn_registrar_documento(text,text,text,text,integer,date,uuid)'::regprocedure) then
    raise exception 'verificación: fn_registrar_documento perdió privilegios, SECURITY DEFINER o search_path.';
  end if;
  if (select documentos from _antes) is distinct from
     (select md5(coalesce(string_agg(to_jsonb(d)::text, '' order by d.id), '')) from public.documentos_expediente d) then
    raise exception 'verificación: documentos_expediente cambió.';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 32
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 17
     or (select count(*) from pg_policies where schemaname = 'public') <> 56
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 33 then
    raise exception 'verificación: el esquema cambió de tamaño (deben seguir 32, 17, 56, 33).';
  end if;
  if (select count(*) from public.bitacora where created_at = now()) <> 90
     or (select count(*) from public.bitacora where created_at = now() and origen = 'trigger') <> 89
     or (select count(*) from public.bitacora) <> (select bitacora from _antes) + 90
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: la bitácora no tiene 89 asientos del trigger + 1 manual con el usuario pasado.';
  end if;
end $$;

select (select count(*) from public.catalogo_instrumentos)::text as instrumentos,
       (select count(*) from public.catalogo_prorrateo)::text as prorrateo,
       (select count(*) from public.catalogo_instrumentos where not elegible)::text as no_elegibles,
       (select count(*) from public.catalogo_instrumentos where verificado_en is null)::text as sin_verificado_en,
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
