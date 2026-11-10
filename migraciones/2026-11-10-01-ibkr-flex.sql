-- ===========================================================================
-- IBKR Flex · estructura para la cartera del Comité de Inversión (DDL)
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: ni nombres ni alias de IBKR tienen columna.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026). La salida del
-- real, la verificación por MCP y el md5 van en el mensaje del commit.
--
-- Réplica del repo (npm run replica, datos sintéticos): ensayo sin rastro; real
-- con las 5 tablas, RLS, 1 política y 2 triggers cada una, 1 asiento; re-ejecución
-- detenida en la guarda. Pruebas negativas por mutación, cada una detenida: sin la
-- validación del toDate (lo para el CHECK sync_to_date_validado), sin el trigger
-- de solo agregar, con EXECUTE para anon, sin la suma del prorrateo.
-- Ensayo en producción, 10-nov-2026 (ROLLBACK, código de salida 0, md5 del archivo
-- ensayado 840a5682624a8145ffec8300af96a99c, que solo difiere de este en esta
-- cabecera): autoprueba completa, las 5 tablas con rls true, 1 política, 2 triggers
-- y 1 asiento. Verificado después por MCP: ninguna tabla ni fn_cargar_ibkr, esquema
-- en 27 tablas, 14 funciones, 51 políticas y 23 triggers, bitácora en 1647.
--
-- POR QUÉ
--
-- Especificación: docs/ESPEC_IBKR_Flex.md (§1.5, §1.6, §3.1). Plan aprobado por
-- Claudio el 10-nov-2026: catálogos con la estructura y sin filas (los ~80 tickers
-- van en otra migración), conid nullable (llave por conid cuando venga, por
-- ticker si no), una fecha ya cargada se rechaza, cuentas_excluidas fuera.
--
-- QUÉ HACE
--
-- 1. catalogo_instrumentos y catalogo_prorrateo: editables, con trg_bitacora.
--    Llevan id uuid porque fn_bitacora toma entidad_id de codigo_cliente →
--    codigo_reporte → codigo_ficha → cuenta_ibkr → id; sin id sería NULL y el
--    asiento fallaría. Un trigger diferido exige que un ticker MIXTO tenga
--    factores que sumen 1.00000 y que uno no MIXTO no tenga ninguno.
-- 2. sync_ibkr, posiciones_detalle y rendimientos_horizonte: SOLO AGREGAR. Un
--    trigger detiene UPDATE, DELETE y TRUNCATE (la RLS sola no basta: postgres y
--    la llave secreta se la saltan). Sin trg_bitacora por renglón: la fila de
--    sync_ibkr y el asiento manual de cada carga son la evidencia.
--    FK a cuentas_ibkr(cuenta_ibkr), diferible y sin cascada: ninguna tabla nueva
--    guarda codigo_cliente, así que no entra en la lista de renombres.
-- 3. fn_cargar_ibkr(jsonb), SECURITY DEFINER: la única vía de escritura. Exige
--    sesión, valida el toDate contra el td, rechaza cuentas sin contrato y fechas
--    ya cargadas, escribe todo en una transacción y deja un asiento manual.
-- 4. RLS: solo SELECT para authenticated. anon nada; service_role solo SELECT.
-- 5. Autoprueba dentro de un bloque que se revierte entero (errcode IBOK0): no
--    deja filas ni asientos.
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
  if to_regclass('public.catalogo_instrumentos') is not null or to_regclass('public.catalogo_prorrateo') is not null
     or to_regclass('public.sync_ibkr') is not null or to_regclass('public.posiciones_detalle') is not null
     or to_regclass('public.rendimientos_horizonte') is not null
     or to_regprocedure('public.fn_cargar_ibkr(jsonb)') is not null then
    raise exception 'guarda: la estructura IBKR ya existe; el script no es re-ejecutable.';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 27
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 14
     or (select count(*) from pg_policies where schemaname = 'public') <> 51
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 23 then
    raise exception 'guarda: el esquema no es el esperado (27 tablas, 14 funciones, 51 políticas, 23 triggers).';
  end if;
  if not exists (select 1 from public.cuentas_ibkr) then
    raise exception 'guarda: cuentas_ibkr está vacía; la autoprueba necesita una cuenta.';
  end if;
end $$;

-- --- 1 · Catálogos ---------------------------------------------------------------
create table public.catalogo_instrumentos (
  id                      uuid primary key default gen_random_uuid(),
  ticker                  text not null unique,
  descripcion             text,
  asset_category          text not null,
  sub_category            text,
  clasificacion_cnbv      smallint,
  clase_activo            text not null,
  es_equivalente_efectivo boolean not null default false,
  elegible                boolean not null,
  duracion_efectiva       numeric(6,2),
  nota                    text,
  verificado_en           date,
  creado_en               timestamptz not null default now(),
  creado_por              text not null default coalesce(
                            nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo'),
  constraint catalogo_ticker_forma check (ticker = upper(btrim(ticker)) and ticker <> ''
                                          and ticker not in ('EFECTIVO', 'NAV_IBKR')),
  constraint catalogo_asset_forma check (asset_category ~ '^[A-Z]+$' and asset_category <> 'OPT'),
  constraint catalogo_cnbv_valida check (clasificacion_cnbv in (101, 102, 103, 104, 105, 106, 109, 112, 113)),
  constraint catalogo_clase_valida check (clase_activo in ('GOB_MX', 'GOB_EXT', 'GOB_EMERGENTE', 'CORP_IG',
    'HIGH_YIELD', 'ACC_BMV', 'ACC_SIC', 'CRIPTO', 'MIXTO', 'DERIVADO', 'EFECTIVO')),
  constraint catalogo_duracion_valida check (duracion_efectiva >= 0)
);
comment on table public.catalogo_instrumentos is
  'Clasificación por ticker (ESPEC_IBKR_Flex §3.1). Ningún mapeo de ticker vive en el código. Las opciones (OPT) nunca entran: son DERIVADO.';

create table public.catalogo_prorrateo (
  id           uuid primary key default gen_random_uuid(),
  ticker       text not null references public.catalogo_instrumentos (ticker) deferrable,
  clase_activo text not null,
  factor       numeric(6,5) not null,
  creado_en    timestamptz not null default now(),
  creado_por   text not null default coalesce(
                 nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo'),
  constraint prorrateo_unico unique (ticker, clase_activo),
  constraint prorrateo_clase_valida check (clase_activo in ('GOB_MX', 'GOB_EXT', 'GOB_EMERGENTE', 'CORP_IG',
    'HIGH_YIELD', 'ACC_BMV', 'ACC_SIC', 'CRIPTO', 'EFECTIVO')),
  constraint prorrateo_factor_valido check (factor > 0 and factor <= 1)
);
comment on table public.catalogo_prorrateo is
  'Factores de los ETF MIXTO (ESPEC_IBKR_Flex §3.2.2); suman 1.00000 por ticker. Cada fracción hereda la duración del ETF.';

create function public.fn_validar_prorrateo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ticker text := coalesce(new.ticker, old.ticker); v_clase text; v_suma numeric; v_n int;
begin
  select clase_activo into v_clase from catalogo_instrumentos where ticker = v_ticker;
  select coalesce(sum(factor), 0), count(*) into v_suma, v_n from catalogo_prorrateo where ticker = v_ticker;
  if v_clase = 'MIXTO' and v_suma <> 1 then
    raise exception 'Los factores de % suman %; deben sumar 1.00000.', v_ticker, v_suma using errcode = 'IB422';
  end if;
  if v_clase is distinct from 'MIXTO' and v_n > 0 then
    raise exception '% tiene factores de prorrateo pero no es MIXTO.', v_ticker using errcode = 'IB422';
  end if;
  return null;
end $$;

create constraint trigger trg_prorrateo_suma after insert or update or delete on public.catalogo_prorrateo
  deferrable initially deferred for each row execute function public.fn_validar_prorrateo();
create constraint trigger trg_catalogo_mixto after insert or update of clase_activo on public.catalogo_instrumentos
  deferrable initially deferred for each row execute function public.fn_validar_prorrateo();
create trigger trg_bitacora after insert or update or delete on public.catalogo_instrumentos
  for each row execute function public.fn_bitacora();
create trigger trg_bitacora after insert or update or delete on public.catalogo_prorrateo
  for each row execute function public.fn_bitacora();

-- --- 2 · Cargas, fotos y rendimientos (solo agregar) ------------------------------
create table public.sync_ibkr (
  id               uuid primary key default gen_random_uuid(),
  uso              text not null,
  ventana          text,
  fd               date not null,
  td               date not null,
  to_date_ibkr     date not null,
  xml_sha256       text not null unique,
  cuentas_xml      integer not null,
  cuentas_cargadas integer not null,
  renglones        integer not null,
  ignoradas        integer not null,
  descuadres       jsonb not null default '[]',
  confirmado_por   text not null,
  confirmado_en    timestamptz not null default now(),
  constraint sync_uso_valido check (uso in ('foto_diaria', 'rendimiento')),
  constraint sync_ventana_valida check (ventana in ('MTD', 'QTD', 'YTD', '12M', '12M-1', '12M-2', 'DESDE_APERTURA')
                                        or ventana ~ '^A[0-9]{4}$'),
  constraint sync_ventana_por_uso check ((uso = 'foto_diaria' and ventana is null and fd = td)
                                         or (uso = 'rendimiento' and ventana is not null)),
  constraint sync_rango_valido check (fd <= td and td - fd <= 365),
  constraint sync_to_date_validado check (to_date_ibkr = td),
  constraint sync_sha_forma check (xml_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sync_conteos_validos check (cuentas_xml >= 0 and cuentas_cargadas > 0 and renglones > 0 and ignoradas >= 0),
  constraint sync_descuadres_lista check (jsonb_typeof(descuadres) = 'array')
);
comment on table public.sync_ibkr is
  'Una fila por carga confirmada del Flex Web Service. Solo agregar. Escribe únicamente fn_cargar_ibkr.';

create table public.posiciones_detalle (
  id              uuid primary key default gen_random_uuid(),
  sync_id         uuid not null references public.sync_ibkr (id),
  cuenta_ibkr     text not null references public.cuentas_ibkr (cuenta_ibkr) deferrable,
  fecha_foto      date not null,
  tipo_renglon    text not null,
  ticker          text not null,
  conid           bigint,
  asset_category  text,
  sub_category    text,
  descripcion     text,
  cantidad        numeric,
  mark_price      numeric,
  position_value  numeric,
  moneda          text,
  fx_rate_to_base numeric,
  valor_base      numeric not null,
  moneda_base     text not null,
  creado_en       timestamptz not null default now(),
  constraint posicion_tipo_valido check (tipo_renglon in ('posicion', 'efectivo', 'nav_ibkr')),
  constraint posicion_ticker_por_tipo check ((tipo_renglon = 'efectivo') = (ticker = 'EFECTIVO')
                                             and (tipo_renglon = 'nav_ibkr') = (ticker = 'NAV_IBKR')
                                             and btrim(ticker) <> ''),
  constraint posicion_campos_por_tipo check (case when tipo_renglon = 'posicion'
    then num_nonnulls(asset_category, cantidad, mark_price, position_value, moneda, fx_rate_to_base) = 6
    else num_nonnulls(conid, asset_category, sub_category, descripcion, cantidad, mark_price, position_value,
                      moneda, fx_rate_to_base) = 0 end),
  constraint posicion_conid_valido check (conid > 0),
  constraint posicion_fx_valido check (fx_rate_to_base > 0),
  constraint posicion_monedas_forma check (moneda ~ '^[A-Z]{3}$' and moneda_base ~ '^[A-Z]{3}$')
);
comment on table public.posiciones_detalle is
  'Foto por cuenta, fecha y instrumento (ESPEC_IBKR_Flex §1.6). valor_base = position_value × fx_rate_to_base. '
  'EFECTIVO = BASE_SUMMARY.endingSettledCash. NAV_IBKR es renglón de CONTROL: no se suma. Solo agregar.';
create unique index posiciones_por_conid on public.posiciones_detalle (cuenta_ibkr, fecha_foto, conid)
  where conid is not null;
create unique index posiciones_por_ticker on public.posiciones_detalle (cuenta_ibkr, fecha_foto, tipo_renglon, ticker)
  where conid is null;
create unique index posiciones_un_nav on public.posiciones_detalle (cuenta_ibkr, fecha_foto)
  where tipo_renglon = 'nav_ibkr';
create index posiciones_sync on public.posiciones_detalle (sync_id);

create table public.rendimientos_horizonte (
  id                  uuid primary key default gen_random_uuid(),
  sync_id             uuid not null references public.sync_ibkr (id),
  cuenta_ibkr         text not null references public.cuentas_ibkr (cuenta_ibkr) deferrable,
  ventana             text not null,
  fd                  date not null,
  td                  date not null,
  moneda_base         text not null,
  valor_inicial       numeric not null,
  valor_final         numeric not null,
  depositos_retiros   numeric,
  mtm                 numeric,
  intereses           numeric,
  dividendos          numeric,
  twr                 numeric not null,
  fecha_fondeo        date,
  creado_en           timestamptz not null default now(),
  constraint rendimiento_ventana_valida check (ventana in ('MTD', 'QTD', 'YTD', '12M', '12M-1', '12M-2', 'DESDE_APERTURA')
                                               or ventana ~ '^A[0-9]{4}$'),
  constraint rendimiento_rango_valido check (fd <= td),
  constraint rendimiento_moneda_forma check (moneda_base ~ '^[A-Z]{3}$'),
  constraint rendimiento_unico unique (cuenta_ibkr, ventana, td)
);
comment on table public.rendimientos_horizonte is
  'ChangeInNAV por cuenta y ventana (ESPEC_IBKR_Flex §1.6). twr tal como lo da IBKR. Solo agregar.';
create index rendimientos_sync on public.rendimientos_horizonte (sync_id);

create function public.fn_solo_agregar() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception '% es de solo agregar: % no se permite.', tg_table_name, tg_op using errcode = 'IB405';
end $$;

create trigger trg_solo_agregar before update or delete on public.sync_ibkr
  for each row execute function public.fn_solo_agregar();
create trigger trg_solo_agregar_truncate before truncate on public.sync_ibkr
  for each statement execute function public.fn_solo_agregar();
create trigger trg_solo_agregar before update or delete on public.posiciones_detalle
  for each row execute function public.fn_solo_agregar();
create trigger trg_solo_agregar_truncate before truncate on public.posiciones_detalle
  for each statement execute function public.fn_solo_agregar();
create trigger trg_solo_agregar before update or delete on public.rendimientos_horizonte
  for each row execute function public.fn_solo_agregar();
create trigger trg_solo_agregar_truncate before truncate on public.rendimientos_horizonte
  for each statement execute function public.fn_solo_agregar();

-- --- 3 · Función de carga --------------------------------------------------------
create function public.fn_cargar_ibkr(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_usuario  text := fn_firmante_sesion();
  v_hoy      date := (now() at time zone 'America/Mexico_City')::date;
  v_uso      text;
  v_ventana  text;
  v_fd       date;
  v_td       date;
  v_to       date;
  v_sha      text;
  v_cxml     integer;
  v_ign      integer;
  v_desc     jsonb;
  v_pos      jsonb;
  v_ren      jsonb;
  v_filas    jsonb;
  v_cuentas  integer;
  v_cuenta   text;
  v_sync     uuid;
  v_n        integer;
begin
  if v_usuario is null then
    raise exception 'Sin sesión: cargar IBKR exige un usuario autenticado.' using errcode = 'IB401';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'La carga no es un objeto.' using errcode = 'IB400';
  end if;

  v_uso := p_payload ->> 'uso';
  v_ventana := p_payload ->> 'ventana';
  v_sha := p_payload ->> 'xml_sha256';
  v_desc := coalesce(p_payload -> 'descuadres', '[]');
  v_pos := coalesce(p_payload -> 'posiciones', '[]');
  v_ren := coalesce(p_payload -> 'rendimientos', '[]');
  begin
    v_fd := (p_payload ->> 'fd')::date;
    v_td := (p_payload ->> 'td')::date;
    v_to := (p_payload ->> 'to_date_ibkr')::date;
    v_cxml := (p_payload ->> 'cuentas_xml')::integer;
    v_ign := (p_payload ->> 'ignoradas')::integer;
  exception when others then
    raise exception 'Fechas o conteos con forma inválida.' using errcode = 'IB400';
  end;

  if v_uso is null or v_uso not in ('foto_diaria', 'rendimiento') then
    raise exception 'uso debe ser foto_diaria o rendimiento.' using errcode = 'IB400';
  end if;
  if v_fd is null or v_td is null or v_to is null or v_cxml is null or v_ign is null then
    raise exception 'Faltan fd, td, to_date_ibkr, cuentas_xml o ignoradas.' using errcode = 'IB400';
  end if;
  if v_fd > v_td or v_td - v_fd > 365 or v_td > v_hoy then
    raise exception 'Rango inválido: fd ≤ td ≤ hoy y como mucho 365 días.' using errcode = 'IB400';
  end if;
  if v_to <> v_td then
    raise exception 'El toDate de IBKR (%) no coincide con el td pedido (%): la respuesta se descarta.', v_to, v_td
      using errcode = 'IB422';
  end if;
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'xml_sha256 con forma inválida.' using errcode = 'IB400';
  end if;
  if jsonb_typeof(v_desc) <> 'array' or jsonb_typeof(v_pos) <> 'array' or jsonb_typeof(v_ren) <> 'array' then
    raise exception 'descuadres, posiciones y rendimientos deben ser listas.' using errcode = 'IB400';
  end if;
  if v_uso = 'foto_diaria' and (v_fd <> v_td or v_ventana is not null
                                or jsonb_array_length(v_pos) = 0 or jsonb_array_length(v_ren) > 0) then
    raise exception 'Una foto diaria lleva fd = td, sin ventana, con posiciones y sin rendimientos.' using errcode = 'IB400';
  end if;
  if v_uso = 'rendimiento' and (v_ventana is null
                                or jsonb_array_length(v_ren) = 0 or jsonb_array_length(v_pos) > 0) then
    raise exception 'Un rendimiento lleva ventana, rendimientos y ninguna posición.' using errcode = 'IB400';
  end if;
  if exists (select 1 from sync_ibkr where xml_sha256 = v_sha) then
    raise exception 'Este XML ya se cargó.' using errcode = 'IB409';
  end if;

  v_filas := v_pos || v_ren;
  select r ->> 'cuenta_ibkr' into v_cuenta
    from jsonb_array_elements(v_filas) r
   where not exists (select 1 from cuentas_ibkr c where c.cuenta_ibkr = r ->> 'cuenta_ibkr')
   limit 1;
  if found then
    raise exception 'La cuenta % no tiene contrato en el CRM: debió quedar en los descuadres de la vista previa.',
      coalesce(v_cuenta, '(vacía)') using errcode = 'IB422';
  end if;
  select count(distinct r ->> 'cuenta_ibkr') into v_cuentas from jsonb_array_elements(v_filas) r;

  if v_uso = 'foto_diaria' then
    select cuenta into v_cuenta
      from (select r ->> 'cuenta_ibkr' as cuenta,
                   count(*) filter (where r ->> 'tipo_renglon' = 'nav_ibkr') as navs
              from jsonb_array_elements(v_pos) r group by 1) x
     where navs <> 1 limit 1;
    if found then
      raise exception 'La cuenta % no trae exactamente un renglón NAV_IBKR.', v_cuenta using errcode = 'IB400';
    end if;
    select p.cuenta_ibkr into v_cuenta
      from posiciones_detalle p
     where p.fecha_foto = v_td
       and p.cuenta_ibkr in (select r ->> 'cuenta_ibkr' from jsonb_array_elements(v_pos) r)
     limit 1;
    if found then
      raise exception 'La cuenta % ya tiene foto del %: una fecha cargada no se reescribe.', v_cuenta, v_td
        using errcode = 'IB409';
    end if;
  else
    select h.cuenta_ibkr into v_cuenta
      from rendimientos_horizonte h
     where h.ventana = v_ventana and h.td = v_td
       and h.cuenta_ibkr in (select r ->> 'cuenta_ibkr' from jsonb_array_elements(v_ren) r)
     limit 1;
    if found then
      raise exception 'La cuenta % ya tiene rendimiento % al %.', v_cuenta, v_ventana, v_td using errcode = 'IB409';
    end if;
  end if;

  insert into sync_ibkr (uso, ventana, fd, td, to_date_ibkr, xml_sha256, cuentas_xml, cuentas_cargadas,
                         renglones, ignoradas, descuadres, confirmado_por)
  values (v_uso, v_ventana, v_fd, v_td, v_to, v_sha, v_cxml, v_cuentas,
          jsonb_array_length(v_filas), v_ign, v_desc, v_usuario)
  returning id into v_sync;

  if v_uso = 'foto_diaria' then
    insert into posiciones_detalle (sync_id, cuenta_ibkr, fecha_foto, tipo_renglon, ticker, conid, asset_category,
                                    sub_category, descripcion, cantidad, mark_price, position_value, moneda,
                                    fx_rate_to_base, valor_base, moneda_base)
    select v_sync, x.cuenta_ibkr, v_td, x.tipo_renglon, x.ticker, x.conid, x.asset_category, x.sub_category,
           x.descripcion, x.cantidad, x.mark_price, x.position_value, x.moneda, x.fx_rate_to_base, x.valor_base,
           x.moneda_base
      from jsonb_to_recordset(v_pos) as x(cuenta_ibkr text, tipo_renglon text, ticker text, conid bigint,
           asset_category text, sub_category text, descripcion text, cantidad numeric, mark_price numeric,
           position_value numeric, moneda text, fx_rate_to_base numeric, valor_base numeric, moneda_base text);
  else
    insert into rendimientos_horizonte (sync_id, cuenta_ibkr, ventana, fd, td, moneda_base, valor_inicial, valor_final,
                                        depositos_retiros, mtm, intereses, dividendos, twr, fecha_fondeo)
    select v_sync, x.cuenta_ibkr, v_ventana, v_fd, v_td, x.moneda_base, x.valor_inicial, x.valor_final,
           x.depositos_retiros, x.mtm, x.intereses, x.dividendos, x.twr, x.fecha_fondeo
      from jsonb_to_recordset(v_ren) as x(cuenta_ibkr text, moneda_base text, valor_inicial numeric,
           valor_final numeric, depositos_retiros numeric, mtm numeric, intereses numeric, dividendos numeric,
           twr numeric, fecha_fondeo date);
  end if;
  get diagnostics v_n = row_count;
  if v_n <> jsonb_array_length(v_filas) then
    raise exception 'Se escribieron % renglones de %.', v_n, jsonb_array_length(v_filas) using errcode = 'IB500';
  end if;

  insert into bitacora (entidad, entidad_id, accion, usuario, origen, metadata)
  values ('sync_ibkr', v_sync::text, 'carga_ibkr', v_usuario, 'aplicacion',
          jsonb_build_object('uso', v_uso, 'ventana', v_ventana, 'fd', v_fd, 'td', v_td,
                             'cuentas', v_cuentas, 'renglones', v_n, 'ignoradas', v_ign,
                             'descuadres', jsonb_array_length(v_desc), 'xml_sha256', v_sha));

  return jsonb_build_object('sync_id', v_sync, 'cuentas', v_cuentas, 'renglones', v_n);
end $$;

-- --- 4 · RLS y privilegios ------------------------------------------------------
alter table public.catalogo_instrumentos  enable row level security;
alter table public.catalogo_prorrateo     enable row level security;
alter table public.sync_ibkr              enable row level security;
alter table public.posiciones_detalle     enable row level security;
alter table public.rendimientos_horizonte enable row level security;

create policy catalogo_instrumentos_select_auth  on public.catalogo_instrumentos  for select to authenticated using (true);
create policy catalogo_prorrateo_select_auth     on public.catalogo_prorrateo     for select to authenticated using (true);
create policy sync_ibkr_select_auth              on public.sync_ibkr              for select to authenticated using (true);
create policy posiciones_detalle_select_auth     on public.posiciones_detalle     for select to authenticated using (true);
create policy rendimientos_horizonte_select_auth on public.rendimientos_horizonte for select to authenticated using (true);

revoke all on public.catalogo_instrumentos, public.catalogo_prorrateo, public.sync_ibkr,
              public.posiciones_detalle, public.rendimientos_horizonte
  from public, anon, authenticated, service_role;
grant select on public.catalogo_instrumentos, public.catalogo_prorrateo, public.sync_ibkr,
                public.posiciones_detalle, public.rendimientos_horizonte
  to authenticated, service_role;

revoke all on function public.fn_validar_prorrateo(), public.fn_solo_agregar(), public.fn_cargar_ibkr(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_cargar_ibkr(jsonb) to authenticated;

-- --- 5 · Asiento manual ------------------------------------------------------------
insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'ibkr-flex', 'ddl',
        'Estructura para la cartera de IBKR (Flex Web Service): catálogos, cargas, fotos y rendimientos. '
        'Especificación docs/ESPEC_IBKR_Flex.md; plan aprobado el 10-nov-2026.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-10-01-ibkr-flex.sql',
                           'tablas', jsonb_build_array('catalogo_instrumentos', 'catalogo_prorrateo', 'sync_ibkr',
                                                       'posiciones_detalle', 'rendimientos_horizonte'),
                           'funciones', jsonb_build_array('fn_cargar_ibkr', 'fn_validar_prorrateo', 'fn_solo_agregar')));

-- --- 6 · Autoprueba (se revierte entera con IBOK0) ----------------------------------
do $$
declare
  v_cuenta text := (select cuenta_ibkr from public.cuentas_ibkr order by cuenta_ibkr limit 1);
  v_foto   jsonb;
  v_rend   jsonb;
  v_r      jsonb;
begin
  v_foto := jsonb_build_object(
    'uso', 'foto_diaria', 'fd', '2000-01-03', 'td', '2000-01-03', 'to_date_ibkr', '2000-01-03',
    'xml_sha256', repeat('a', 64), 'cuentas_xml', 2, 'ignoradas', 1,
    'descuadres', jsonb_build_array(jsonb_build_object('tipo', 'sin_contrato')),
    'posiciones', jsonb_build_array(
      jsonb_build_object('cuenta_ibkr', v_cuenta, 'tipo_renglon', 'posicion', 'ticker', 'ZZPRUEBA', 'conid', 1,
                         'asset_category', 'STK', 'sub_category', 'ETF', 'descripcion', 'autoprueba',
                         'cantidad', 2, 'mark_price', 10, 'position_value', 20, 'moneda', 'USD',
                         'fx_rate_to_base', 18.5, 'valor_base', 370, 'moneda_base', 'MXN'),
      jsonb_build_object('cuenta_ibkr', v_cuenta, 'tipo_renglon', 'efectivo', 'ticker', 'EFECTIVO',
                         'valor_base', 30, 'moneda_base', 'MXN'),
      jsonb_build_object('cuenta_ibkr', v_cuenta, 'tipo_renglon', 'nav_ibkr', 'ticker', 'NAV_IBKR',
                         'valor_base', 400, 'moneda_base', 'MXN')));
  v_rend := jsonb_build_object(
    'uso', 'rendimiento', 'ventana', 'YTD', 'fd', '2000-01-01', 'td', '2000-01-03', 'to_date_ibkr', '2000-01-03',
    'xml_sha256', repeat('b', 64), 'cuentas_xml', 1, 'ignoradas', 0,
    'rendimientos', jsonb_build_array(
      jsonb_build_object('cuenta_ibkr', v_cuenta, 'moneda_base', 'MXN', 'valor_inicial', 100, 'valor_final', 110,
                         'depositos_retiros', 0, 'mtm', 10, 'intereses', 0, 'dividendos', 0, 'twr', 10)));
  begin
    -- Una foto válida
    v_r := public.fn_cargar_ibkr(v_foto);
    if (v_r ->> 'renglones')::int <> 3 or (select count(*) from public.posiciones_detalle) <> 3
       or (select count(*) from public.sync_ibkr) <> 1
       or (select count(*) from public.bitacora where accion = 'carga_ibkr' and created_at = now()) <> 1 then
      raise exception 'autoprueba: la foto válida no dejó 3 renglones, 1 carga y 1 asiento.' using errcode = 'IBFAL';
    end if;
    -- La misma fecha, otro XML: se rechaza
    begin
      perform public.fn_cargar_ibkr(jsonb_set(v_foto, '{xml_sha256}', to_jsonb(repeat('c', 64))));
      raise exception 'autoprueba: la fecha repetida no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB409' then null; end;
    -- El mismo XML: se rechaza
    begin
      perform public.fn_cargar_ibkr(jsonb_set(jsonb_set(jsonb_set(v_foto, '{fd}', '"2000-01-04"'), '{td}', '"2000-01-04"'),
                                              '{to_date_ibkr}', '"2000-01-04"'));
      raise exception 'autoprueba: el XML repetido no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB409' then null; end;
    -- toDate distinto del td (en una fecha sin foto, para que nada más la detenga)
    begin
      perform public.fn_cargar_ibkr(jsonb_set(jsonb_set(jsonb_set(jsonb_set(v_foto, '{fd}', '"2000-01-05"'),
                                              '{td}', '"2000-01-05"'), '{to_date_ibkr}', '"2000-01-04"'),
                                              '{xml_sha256}', to_jsonb(repeat('d', 64))));
      raise exception 'autoprueba: el toDate distinto no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB422' then null; end;
    -- Cuenta sin contrato
    begin
      perform public.fn_cargar_ibkr(jsonb_set(jsonb_set(v_foto, '{posiciones,0,cuenta_ibkr}', '"U0"'),
                                              '{xml_sha256}', to_jsonb(repeat('e', 64))));
      raise exception 'autoprueba: la cuenta sin contrato no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB422' then null; end;
    -- Sin sesión
    begin
      perform set_config('request.jwt.claims', '', true);
      perform public.fn_cargar_ibkr(jsonb_set(v_foto, '{xml_sha256}', to_jsonb(repeat('f', 64))));
      raise exception 'autoprueba: la carga sin sesión no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB401' then null; end;
    -- Solo agregar
    begin
      update public.posiciones_detalle set valor_base = 0;
      raise exception 'autoprueba: el UPDATE no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB405' then null; end;
    begin
      delete from public.sync_ibkr;
      raise exception 'autoprueba: el DELETE no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB405' then null; end;
    begin
      truncate public.rendimientos_horizonte;
      raise exception 'autoprueba: el TRUNCATE no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB405' then null; end;
    -- Un rendimiento válido y su repetición
    v_r := public.fn_cargar_ibkr(v_rend);
    if (select count(*) from public.rendimientos_horizonte) <> 1 then
      raise exception 'autoprueba: el rendimiento válido no quedó.' using errcode = 'IBFAL';
    end if;
    begin
      perform public.fn_cargar_ibkr(jsonb_set(v_rend, '{xml_sha256}', to_jsonb(repeat('0', 64))));
      raise exception 'autoprueba: el rendimiento repetido no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB409' then null; end;
    -- Prorrateo: 0.9 se detiene; 1.0 pasa
    insert into public.catalogo_instrumentos (ticker, asset_category, sub_category, clase_activo, elegible, clasificacion_cnbv)
    values ('ZZMIXTO', 'STK', 'ETF', 'MIXTO', true, 113);
    insert into public.catalogo_prorrateo (ticker, clase_activo, factor)
    values ('ZZMIXTO', 'GOB_EXT', 0.5), ('ZZMIXTO', 'CORP_IG', 0.4);
    begin
      set constraints all immediate;
      raise exception 'autoprueba: el prorrateo de 0.9 no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB422' then null; end;
    insert into public.catalogo_prorrateo (ticker, clase_activo, factor) values ('ZZMIXTO', 'EFECTIVO', 0.1);
    set constraints all immediate;
    -- Privilegios
    if has_function_privilege('anon', 'public.fn_cargar_ibkr(jsonb)', 'execute')
       or not has_function_privilege('authenticated', 'public.fn_cargar_ibkr(jsonb)', 'execute')
       or has_table_privilege('authenticated', 'public.posiciones_detalle', 'insert')
       or has_table_privilege('service_role', 'public.posiciones_detalle', 'insert')
       or has_table_privilege('anon', 'public.posiciones_detalle', 'select') then
      raise exception 'autoprueba: los privilegios no son los esperados.' using errcode = 'IBFAL';
    end if;
    raise exception 'autoprueba completa' using errcode = 'IBOK0';
  exception when sqlstate 'IBOK0' then null;
  end;
end $$;

-- --- 7 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 32
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 17
     or (select count(*) from pg_policies where schemaname = 'public') <> 56
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 33 then
    raise exception 'verificación: el esquema no quedó en 32 tablas, 17 funciones, 56 políticas y 33 triggers.';
  end if;
  if exists (select 1 from pg_class
              where oid in ('public.catalogo_instrumentos'::regclass, 'public.catalogo_prorrateo'::regclass,
                            'public.sync_ibkr'::regclass, 'public.posiciones_detalle'::regclass,
                            'public.rendimientos_horizonte'::regclass)
                and not relrowsecurity) then
    raise exception 'verificación: alguna tabla nueva quedó sin RLS.';
  end if;
  if (select count(*) from public.catalogo_instrumentos) + (select count(*) from public.catalogo_prorrateo)
     + (select count(*) from public.sync_ibkr) + (select count(*) from public.posiciones_detalle)
     + (select count(*) from public.rendimientos_horizonte) <> 0 then
    raise exception 'verificación: la autoprueba dejó filas.';
  end if;
  if (select count(*) from public.bitacora where created_at = now()) <> 1
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: la bitácora no tiene exactamente el asiento manual con el usuario pasado.';
  end if;
end $$;

select c.relname as tabla, c.relrowsecurity::text as rls,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::text as politicas,
       (select count(*) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal)::text as triggers,
       (select count(*) from public.bitacora where created_at = now())::text as asientos
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relname in ('catalogo_instrumentos', 'catalogo_prorrateo', 'sync_ibkr', 'posiciones_detalle', 'rendimientos_horizonte')
 order by 1;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
