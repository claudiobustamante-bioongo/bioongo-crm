-- ===========================================================================
-- Parámetros y límites del IPS en tablas (paso 2 del build v1, M4)
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026). La salida del
-- real, la verificación por MCP y el md5 van en el mensaje del commit.
--
-- Réplica del repo (npm run replica): ensayo sin rastro; real con 5 / 44 / 4 / 11
-- renglones y 65 asientos; re-ejecución detenida en la guarda. Siete mutaciones,
-- cada una detenida: ACC_SIC de Bajo 20 → 30 (valores de limites_perfil), un
-- renglón de menos (conteo de la autoprueba), un parámetro con dos valores
-- (parametros_un_valor), limites_perfil sin trg_bitacora (conteo de triggers),
-- INSERT concedido a authenticated (privilegios), Libre de Riesgo sin tope de
-- duración (valores de reglas_perfil) y fecha_inicio_control distinta (valores
-- de parametros_cumplimiento).
-- Ensayo en producción, 12-nov-2026 (ROLLBACK, código de salida 0, md5 del archivo
-- ensayado 3bc2510422d6c09024d1bbc7c7d6b6f0, que solo difiere de este en esta
-- cabecera): autoprueba completa, 5 / 44 / 4 / 11, 65 asientos, bitácora
-- 1738 → 1803. Verificado después por MCP: ninguna tabla nueva, 32 tablas,
-- bitácora en 1738, catalogo_instrumentos.clase_activo sin comentario.
--
-- POR QUÉ
--
-- docs/SPEC_Build_Bioongo_v1_2026-11-10.md §M4 y principio 1 (nada regulatorio
-- como constante en código). Decisiones de Claudio del 12-nov-2026, contrastadas
-- contra la Guía v04 §7.5.2, §7.5.3 y §7.6.5 (el manual manda):
-- - M4 se siembra como está, aunque el motor de portafolios difiera (ACC_SIC de
--   Bajo 20 vs RV 30 del motor; duración < 3 en Libre de Riesgo que el motor no
--   aplica). Alinear el motor va en su propia sesión, antes del onboarding.
-- - rv_total_max_pct por perfil 0/20/60/85: lectura de §7.5.3, PENDIENTE DE
--   CONFIRMAR CON ERICK.
-- - El tope de satélite de tecnología sale del cumplimiento (en el motor queda
--   solo como regla interna de construcción).
-- - vehiculos_max_pct (ETFs y fondos diversificados) 0/60/70/70: SOLO para Yoko,
--   cuando aplicar_limite_vehiculos = true (lectura literal de PI-02 §3).
-- - fecha_inicio_control = 2026-09-30; aplicar_limite_vehiculos = true.
-- - Revisión anual (12 meses, aviso 60 días, hoy en lib/revision-anual.ts) se
--   agrega a parametros_cumplimiento.
-- - Renta variable por EMISOR (11-nov-2026): ACC_BMV = emisoras mexicanas en
--   cualquier bolsa o moneda; ACC_SIC = emisoras no mexicanas en cualquier bolsa o
--   moneda. Va como comentario de catalogo_instrumentos.clase_activo.
-- - Money market regulado (UCITS MMF o 2a-7, liquidez diaria, WAM ≤ 60 días) =
--   EFECTIVO y equivalente de efectivo, aunque no sea 100 % soberano: decisión del
--   Asesor (11-nov-2026), pendiente de reflejar en manuales. El CHECK
--   catalogo_equivalente_duracion (duración ≤ 1) ya lo admite (WAM 60 d ≈ 0.16).
--
-- QUÉ HACE
--
-- 1. limites_fase (5), limites_perfil (44: 4 perfiles × 11 clases), reglas_perfil
--    (4) y parametros_cumplimiento (11). Porcentajes en _pct (70 = 70 %). Nombres
--    de fase y perfil exactos a los de la base ('Libre de Riesgo', fases sin
--    acento). Cada tabla lleva id uuid (fn_bitacora toma entidad_id del id).
-- 2. RLS: solo SELECT para authenticated; nadie de la app escribe. trg_bitacora
--    en las cuatro. Los valores cambian solo por migración.
-- 3. Comentarios de catalogo_instrumentos.clase_activo y es_equivalente_efectivo.
-- 4. Bitácora: 64 asientos de trg_bitacora + 1 manual (1738 → 1803).
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
  if to_regclass('public.limites_fase') is not null or to_regclass('public.limites_perfil') is not null
     or to_regclass('public.reglas_perfil') is not null or to_regclass('public.parametros_cumplimiento') is not null then
    raise exception 'guarda: las tablas de parámetros ya existen; el script no es re-ejecutable.';
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
select (select count(*) from public.bitacora) as bitacora;

-- --- 1 · Tablas -------------------------------------------------------------------
create table public.limites_fase (
  id               uuid primary key default gen_random_uuid(),
  fase             text not null unique,
  rv_max_pct       numeric(6,3) not null,
  rf_min_pct       numeric(6,3) not null,
  liquidez_min_pct numeric(6,3) not null,
  fuente           text not null,
  creado_en        timestamptz not null default now(),
  creado_por       text not null default coalesce(
                     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo'),
  constraint limites_fase_valida check (fase in ('Desarrollo', 'Aceleracion', 'Acumulacion', 'Consolidacion', 'Retiro')),
  constraint limites_fase_rangos check (rv_max_pct between 0 and 100 and rf_min_pct between 0 and 100
                                        and liquidez_min_pct between 0 and 100 and rf_min_pct + liquidez_min_pct <= 100)
);
comment on table public.limites_fase is
  'Guía v04 §7.5.1: máximo de RV, mínimos de RF y liquidez por fase (%). RV = ACC_BMV + ACC_SIC. Solo por migración.';

create table public.limites_perfil (
  id           uuid primary key default gen_random_uuid(),
  perfil       text not null,
  clase_activo text not null,
  max_pct      numeric(6,3) not null,
  fuente       text not null,
  creado_en    timestamptz not null default now(),
  creado_por   text not null default coalesce(
                 nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo'),
  constraint limites_perfil_unico unique (perfil, clase_activo),
  constraint limites_perfil_perfil_valido check (perfil in ('Libre de Riesgo', 'Bajo', 'Moderado', 'Alto')),
  constraint limites_perfil_clase_valida check (clase_activo in ('GOB_MX', 'GOB_EXT', 'GOB_EMERGENTE', 'CORP_IG',
    'HIGH_YIELD', 'ACC_BMV', 'ACC_SIC', 'CRIPTO', 'DERIVADO', 'COMMODITY', 'APALANCADO')),
  constraint limites_perfil_rango check (max_pct between 0 and 100)
);
comment on table public.limites_perfil is
  'Guía v04 §7.5.2: techo por perfil y clase (%), sobre la clase del subyacente (mirada a través; los MIXTO por '
  'prorrateo). EFECTIVO no tiene techo. El satélite de tecnología no es límite de cumplimiento. Solo por migración.';

create table public.reglas_perfil (
  id                   uuid primary key default gen_random_uuid(),
  perfil               text not null unique,
  duracion_gob_menor_a numeric(5,2),
  liquidez_min_pct     numeric(6,3) not null,
  efectivo_cuenta_rf   boolean not null,
  retorno_min_pct      numeric(6,3) not null,
  retorno_max_pct      numeric(6,3),
  rv_total_max_pct     numeric(6,3) not null,
  vehiculos_max_pct    numeric(6,3) not null,
  fuente               text not null,
  creado_en            timestamptz not null default now(),
  creado_por           text not null default coalesce(
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo'),
  constraint reglas_perfil_valido check (perfil in ('Libre de Riesgo', 'Bajo', 'Moderado', 'Alto')),
  constraint reglas_perfil_duracion check (duracion_gob_menor_a > 0),
  constraint reglas_perfil_rangos check (liquidez_min_pct between 0 and 100 and rv_total_max_pct between 0 and 100
                                         and vehiculos_max_pct between 0 and 100),
  constraint reglas_perfil_retorno check (retorno_max_pct > retorno_min_pct)
);
comment on table public.reglas_perfil is
  'Reglas por perfil (Guía v04 §7.5.2, §7.5.3, §7.6.5). Solo por migración.';
comment on column public.reglas_perfil.duracion_gob_menor_a is
  'Duración efectiva de la deuda gubernamental ESTRICTAMENTE menor a este valor (años). NULL = sin tope. '
  'Duración nula en el catálogo = incumple (ESPEC_IBKR_Flex §3.2.10).';
comment on column public.reglas_perfil.efectivo_cuenta_rf is
  'true: el efectivo cuenta para el piso de RF de la fase (solo Libre de Riesgo).';
comment on column public.reglas_perfil.retorno_max_pct is 'NULL = sin máximo (Alto: ≥ 9.5).';
comment on column public.reglas_perfil.rv_total_max_pct is
  'Tope de RV total (ACC_BMV + ACC_SIC) por perfil. Lectura de §7.5.3 (Claudio, 12-nov-2026); PENDIENTE DE '
  'CONFIRMAR CON ERICK.';
comment on column public.reglas_perfil.vehiculos_max_pct is
  'Límite de vehículos (ETFs y fondos diversificados). SOLO lo aplica Yoko, y solo si '
  'parametros_cumplimiento.aplicar_limite_vehiculos = true (lectura literal de PI-02 §3 mientras el manual no cambie). '
  'El semáforo no lo usa: mira a través.';

create table public.parametros_cumplimiento (
  id          uuid primary key default gen_random_uuid(),
  clave       text not null unique,
  tipo        text not null,
  valor_num   numeric,
  valor_fecha date,
  valor_bool  boolean,
  nota        text not null,
  creado_en   timestamptz not null default now(),
  creado_por  text not null default coalesce(
                nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo'),
  constraint parametros_clave_forma check (clave ~ '^[a-z][a-z0-9_]*$'),
  constraint parametros_tipo_valido check (tipo in ('numero', 'fecha', 'booleano')),
  constraint parametros_un_valor check (num_nonnulls(valor_num, valor_fecha, valor_bool) = 1
                                        and (tipo = 'numero') = (valor_num is not null)
                                        and (tipo = 'fecha') = (valor_fecha is not null)
                                        and (tipo = 'booleano') = (valor_bool is not null))
);
comment on table public.parametros_cumplimiento is
  'Parámetros de cumplimiento con un solo valor tipado por clave (SPEC §M4). Solo por migración.';

-- La bitácora antes de sembrar: cada valor queda asentado.
create trigger trg_bitacora after insert or update or delete on public.limites_fase
  for each row execute function public.fn_bitacora();
create trigger trg_bitacora after insert or update or delete on public.limites_perfil
  for each row execute function public.fn_bitacora();
create trigger trg_bitacora after insert or update or delete on public.reglas_perfil
  for each row execute function public.fn_bitacora();
create trigger trg_bitacora after insert or update or delete on public.parametros_cumplimiento
  for each row execute function public.fn_bitacora();

-- --- 2 · Valores ----------------------------------------------------------------
insert into public.limites_fase (fase, rv_max_pct, rf_min_pct, liquidez_min_pct, fuente) values
  ('Desarrollo',    70, 20,  5, 'Guía v04 §7.5.1'),
  ('Aceleracion',   85, 10,  5, 'Guía v04 §7.5.1'),
  ('Acumulacion',   75, 20,  5, 'Guía v04 §7.5.1'),
  ('Consolidacion', 60, 30, 10, 'Guía v04 §7.5.1'),
  ('Retiro',        40, 50, 10, 'Guía v04 §7.5.1');

insert into public.limites_perfil (perfil, clase_activo, max_pct, fuente)
select p.perfil, v.clase, (array[v.lr, v.bajo, v.moderado, v.alto])[p.n], 'Guía v04 §7.5.2'
  from (values ('Libre de Riesgo', 1), ('Bajo', 2), ('Moderado', 3), ('Alto', 4)) p(perfil, n)
 cross join (values
  ('GOB_MX',        100, 100, 70, 40),
  ('GOB_EXT',       100, 100, 70, 40),
  ('CORP_IG',         0,  60, 50, 30),
  ('GOB_EMERGENTE',   0,  60, 50, 30),
  ('HIGH_YIELD',      0,   0, 10, 20),
  ('ACC_BMV',         0,  10, 30, 50),
  ('ACC_SIC',         0,  20, 60, 85),
  ('DERIVADO',        0,   0,  0,  0),
  ('CRIPTO',          0,   0,  0,  0),
  ('COMMODITY',       0,   0,  0,  0),
  ('APALANCADO',      0,   0,  0,  0)) v(clase, lr, bajo, moderado, alto);

insert into public.reglas_perfil (perfil, duracion_gob_menor_a, liquidez_min_pct, efectivo_cuenta_rf,
                                  retorno_min_pct, retorno_max_pct, rv_total_max_pct, vehiculos_max_pct, fuente) values
  ('Libre de Riesgo', 3,    5, true,  4.0, 5.5,  0,  0, 'Guía v04 §7.5.2, §7.5.3, §7.6.5'),
  ('Bajo',            null, 5, false, 5.5, 7.5, 20, 60, 'Guía v04 §7.5.2, §7.5.3, §7.6.5'),
  ('Moderado',        null, 5, false, 7.5, 9.5, 60, 70, 'Guía v04 §7.5.2, §7.5.3, §7.6.5'),
  ('Alto',            null, 3, false, 9.5, null, 85, 70, 'Guía v04 §7.5.2, §7.5.3, §7.6.5');

insert into public.parametros_cumplimiento (clave, tipo, valor_num, valor_fecha, valor_bool, nota) values
  ('nav_residual_mxn',                'numero',   1000, null, null, 'NAV ≤ este monto (MXN) = cuenta inactiva; no se evalúa.'),
  ('vigencia_ips_anios',              'numero',      2, null, null, 'IPS con más de estos años = SIN_PERFIL.'),
  ('saldo_deudor_tolerancia_pct',     'numero',      1, null, null, 'Saldo deudor hasta este % del NAV = aviso; arriba = incumple.'),
  ('rebalanceo_tolerancia_pts',       'numero',      5, null, null, 'Desviación real vs objetivo del IPS en puntos; arriba = ámbar.'),
  ('conciliacion_nav_tolerancia_pct', 'numero',    0.5, null, null, 'Posiciones + efectivo vs NAV de IBKR; arriba = aviso.'),
  ('plazo_remediacion_dias_habiles',  'numero',     30, null, null, 'Plazo de una incidencia desde su detección.'),
  ('aviso_vencimiento_dias',          'numero',      7, null, null, 'Días antes del vencimiento de una incidencia en que se avisa.'),
  ('fecha_inicio_control',            'fecha',    null, date '2026-09-30', null, 'Detección = máx(primera evidencia, esta fecha). Decisión de Claudio, 12-nov-2026.'),
  ('aplicar_limite_vehiculos',        'booleano', null, null, true, 'Yoko aplica reglas_perfil.vehiculos_max_pct (lectura literal de PI-02 §3) mientras el manual no cambie.'),
  ('revision_anual_meses',            'numero',     12, null, null, 'Ciclo de la revisión anual de cartera (hoy en lib/revision-anual.ts).'),
  ('revision_anual_aviso_dias',       'numero',     60, null, null, 'Días antes del vencimiento de la revisión anual en que se marca «por vencer».');

-- --- 3 · Comentarios del catálogo --------------------------------------------------
comment on column public.catalogo_instrumentos.clase_activo is
  'Clase del SUBYACENTE (mirada a través), no del vehículo. Renta variable POR EMISOR (decisión del Asesor, '
  '11-nov-2026): ACC_BMV = emisoras mexicanas en cualquier bolsa o moneda; ACC_SIC = emisoras no mexicanas en '
  'cualquier bolsa o moneda. RV total = ACC_BMV + ACC_SIC. MIXTO se descompone en catalogo_prorrateo.';
comment on column public.catalogo_instrumentos.es_equivalente_efectivo is
  'Duración ≤ 1 año, liquidez diaria, soberano A- o mejor, sin apalancamiento (ESPEC_IBKR_Flex §3.2.8). Además: un '
  'fondo de mercado de dinero regulado (UCITS MMF o 2a-7), liquidez diaria y WAM ≤ 60 días va a clase EFECTIVO y es '
  'equivalente de efectivo aunque no sea 100 % soberano; su duración es el WAM en años (decisión del Asesor, '
  '11-nov-2026, pendiente de reflejar en manuales).';

-- --- 4 · RLS, privilegios y bitácora --------------------------------------------
alter table public.limites_fase            enable row level security;
alter table public.limites_perfil          enable row level security;
alter table public.reglas_perfil           enable row level security;
alter table public.parametros_cumplimiento enable row level security;

create policy limites_fase_select_auth            on public.limites_fase            for select to authenticated using (true);
create policy limites_perfil_select_auth          on public.limites_perfil          for select to authenticated using (true);
create policy reglas_perfil_select_auth           on public.reglas_perfil           for select to authenticated using (true);
create policy parametros_cumplimiento_select_auth on public.parametros_cumplimiento for select to authenticated using (true);

revoke all on public.limites_fase, public.limites_perfil, public.reglas_perfil, public.parametros_cumplimiento
  from public, anon, authenticated, service_role;
grant select on public.limites_fase, public.limites_perfil, public.reglas_perfil, public.parametros_cumplimiento
  to authenticated, service_role;

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'parametros-ips', 'ddl_y_carga',
        'Paso 2 del build v1 (M4): límites por fase y perfil, reglas por perfil y parámetros de cumplimiento en '
        'tablas; renta variable por emisor y money market documentados en el catálogo.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-12-01-parametros-ips.sql',
                           'limites_fase', 5, 'limites_perfil', 44, 'reglas_perfil', 4, 'parametros_cumplimiento', 11,
                           'pendiente', 'rv_total_max_pct por confirmar con Erick'));

-- --- 5 · Autoprueba (se revierte entera con IBOK0) ----------------------------------
do $$
begin
  begin
    begin
      insert into public.parametros_cumplimiento (clave, tipo, valor_num, valor_bool, nota)
      values ('zz_prueba', 'numero', 1, true, 'x');
      raise exception 'autoprueba: un parámetro con dos valores no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      insert into public.parametros_cumplimiento (clave, tipo, valor_fecha, nota) values ('zz_prueba', 'numero', date '2026-01-01', 'x');
      raise exception 'autoprueba: un parámetro con tipo y valor distintos no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      insert into public.limites_perfil (perfil, clase_activo, max_pct, fuente) values ('Bajo', 'MIXTO', 10, 'x');
      raise exception 'autoprueba: un límite para MIXTO no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      update public.reglas_perfil set retorno_max_pct = 7 where perfil = 'Moderado';
      raise exception 'autoprueba: un retorno máximo menor al mínimo no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      set local role authenticated;
      insert into public.limites_fase (fase, rv_max_pct, rf_min_pct, liquidez_min_pct, fuente) values ('Retiro', 1, 1, 1, 'x');
      raise exception 'autoprueba: authenticated pudo escribir en limites_fase.' using errcode = 'IBFAL';
    exception when insufficient_privilege then null; end;
    begin
      set local role authenticated;
      if (select count(*) from public.limites_perfil) <> 44 or (select count(*) from public.parametros_cumplimiento) <> 11 then
        raise exception 'autoprueba: authenticated no lee las tablas completas.' using errcode = 'IBFAL';
      end if;
      raise exception 'lectura completa' using errcode = 'IBOK1';
    exception when sqlstate 'IBOK1' then null; end;
    raise exception 'autoprueba completa' using errcode = 'IBOK0';
  exception when sqlstate 'IBOK0' then null;
  end;
end $$;

-- --- 6 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select count(*) from public.limites_fase) <> 5 or (select count(*) from public.limites_perfil) <> 44
     or (select count(*) from public.reglas_perfil) <> 4 or (select count(*) from public.parametros_cumplimiento) <> 11 then
    raise exception 'verificación: no quedaron 5 / 44 / 4 / 11 renglones.';
  end if;
  if (select string_agg(fase || '=' || trim_scale(rv_max_pct) || '/' || trim_scale(rf_min_pct) || '/' || trim_scale(liquidez_min_pct),
                        ' ' order by fase collate "C") from public.limites_fase)
     <> 'Aceleracion=85/10/5 Acumulacion=75/20/5 Consolidacion=60/30/10 Desarrollo=70/20/5 Retiro=40/50/10' then
    raise exception 'verificación: limites_fase no tiene los valores de la §M4.';
  end if;
  if (select string_agg(clase_activo || '=' || v, ' ' order by clase_activo collate "C")
        from (select clase_activo, string_agg(trim_scale(max_pct)::text, '/' order by
                case perfil when 'Libre de Riesgo' then 1 when 'Bajo' then 2 when 'Moderado' then 3 else 4 end) v
                from public.limites_perfil group by 1) x)
     <> 'ACC_BMV=0/10/30/50 ACC_SIC=0/20/60/85 APALANCADO=0/0/0/0 COMMODITY=0/0/0/0 CORP_IG=0/60/50/30 '
        'CRIPTO=0/0/0/0 DERIVADO=0/0/0/0 GOB_EMERGENTE=0/60/50/30 GOB_EXT=100/100/70/40 GOB_MX=100/100/70/40 '
        'HIGH_YIELD=0/0/10/20' then
    raise exception 'verificación: limites_perfil no tiene los valores de la §M4.';
  end if;
  if (select string_agg(perfil || '=' || concat_ws('/', coalesce(trim_scale(duracion_gob_menor_a)::text, '-'),
                          trim_scale(liquidez_min_pct), efectivo_cuenta_rf::text, trim_scale(retorno_min_pct),
                          coalesce(trim_scale(retorno_max_pct)::text, '-'), trim_scale(rv_total_max_pct),
                          trim_scale(vehiculos_max_pct)),
                        ' ' order by case perfil when 'Libre de Riesgo' then 1 when 'Bajo' then 2 when 'Moderado' then 3 else 4 end)
        from public.reglas_perfil)
     <> 'Libre de Riesgo=3/5/true/4/5.5/0/0 Bajo=-/5/false/5.5/7.5/20/60 Moderado=-/5/false/7.5/9.5/60/70 '
        'Alto=-/3/false/9.5/-/85/70' then
    raise exception 'verificación: reglas_perfil no tiene los valores acordados.';
  end if;
  if (select string_agg(clave || '=' || coalesce(trim_scale(valor_num)::text, valor_fecha::text, valor_bool::text),
                        ' ' order by clave collate "C") from public.parametros_cumplimiento)
     <> 'aplicar_limite_vehiculos=true aviso_vencimiento_dias=7 conciliacion_nav_tolerancia_pct=0.5 '
        'fecha_inicio_control=2026-09-30 nav_residual_mxn=1000 plazo_remediacion_dias_habiles=30 '
        'rebalanceo_tolerancia_pts=5 revision_anual_aviso_dias=60 revision_anual_meses=12 '
        'saldo_deudor_tolerancia_pct=1 vigencia_ips_anios=2' then
    raise exception 'verificación: parametros_cumplimiento no tiene los valores acordados.';
  end if;
  if exists (select 1 from pg_class
              where oid in ('public.limites_fase'::regclass, 'public.limites_perfil'::regclass,
                            'public.reglas_perfil'::regclass, 'public.parametros_cumplimiento'::regclass)
                and not relrowsecurity)
     or has_table_privilege('anon', 'public.parametros_cumplimiento', 'select')
     or has_table_privilege('authenticated', 'public.limites_perfil', 'insert')
     or has_table_privilege('authenticated', 'public.reglas_perfil', 'update')
     or has_table_privilege('service_role', 'public.limites_fase', 'delete')
     or not has_table_privilege('authenticated', 'public.limites_fase', 'select') then
    raise exception 'verificación: RLS o privilegios no son los esperados.';
  end if;
  if (select col_description(attrelid, attnum) from pg_attribute
       where attrelid = 'public.catalogo_instrumentos'::regclass and attname = 'clase_activo') not like '%POR EMISOR%'
     or (select col_description(attrelid, attnum) from pg_attribute
          where attrelid = 'public.catalogo_instrumentos'::regclass and attname = 'es_equivalente_efectivo') not like '%WAM ≤ 60 días%' then
    raise exception 'verificación: faltan los comentarios del catálogo.';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 36
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 17
     or (select count(*) from pg_policies where schemaname = 'public') <> 60
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 37 then
    raise exception 'verificación: el esquema no quedó en 36 tablas, 17 funciones, 60 políticas y 37 triggers.';
  end if;
  if (select count(*) from public.bitacora where created_at = now()) <> 65
     or (select count(*) from public.bitacora where created_at = now() and origen = 'trigger') <> 64
     or (select count(*) from public.bitacora) <> (select bitacora from _antes) + 65
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: la bitácora no tiene 64 asientos del trigger + 1 manual con el usuario pasado.';
  end if;
end $$;

select (select count(*) from public.limites_fase)::text as limites_fase,
       (select count(*) from public.limites_perfil)::text as limites_perfil,
       (select count(*) from public.reglas_perfil)::text as reglas_perfil,
       (select count(*) from public.parametros_cumplimiento)::text as parametros,
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
