-- ===========================================================================
-- Semáforo (M5), esquema: evaluaciones, tipo de cambio, IPS fijado por cuenta y
-- la vista del comité
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
-- Réplica del repo (npm run replica, datos sintéticos: dos cuentas y una foto
-- para una sola): ensayo sin rastro; real con 38 tablas, 19 funciones, 62
-- políticas, 42 triggers, 1 vista y 1 asiento; re-ejecución detenida en la
-- guarda. Seis mutaciones, cada una detenida: sin cotejar el semáforo contra la
-- foto, fn_archivar sin las columnas nuevas, vista sin security_invoker, FIX de
-- otro día sin nota, semáforo sin solo-agregar e INSERT para authenticated.
-- Ensayo en producción, 16-nov-2026 (ROLLBACK, código de salida 0, md5 del archivo
-- ensayado e9adb0f607cc48e8e08459210245a001, que solo difiere de este en esta
-- cabecera): autoprueba completa contra la foto real del 13-nov (revertida), 38 /
-- 19 / 62 / 42 / 1 vista, bitácora 1837 → 1838. Verificado después por MCP: sin
-- tablas, vista ni columnas nuevas, fn_archivar igual, histórico en 3, bitácora
-- en 1837.
--
-- POR QUÉ
--
-- docs/SPEC_Build_Bioongo_v1_2026-11-10.md §M5 y decisiones de Claudio del
-- 16-nov-2026: la evidencia del semáforo es de solo agregar y la escribe una
-- función; la vista del comité lleva solo códigos y un indicador aparte de
-- «actualización de IPS pendiente» que NO cambia el color; el FIX se lee de
-- Banxico (SF43718) y se escribe con la sesión de Claudio, nunca a mano; el IPS
-- de una cuenta puede quedar fijado por decisión (dato con motivo y fecha, no
-- un caso especial en el código). Esta migración es SOLO esquema: el IPS fijado
-- de CSPMU1062 va en la migración (B).
--
-- QUÉ HACE
--
-- 1. tipo_cambio (solo agregar, trg_bitacora): serie, fecha del dato, valor,
--    fecha solicitada (si el día no tuvo FIX, la del hábil anterior queda
--    anotada), fuente y nota. fn_registrar_tipo_cambio la escribe con sesión.
-- 2. cuentas_ibkr: codigo_ips_fijado (FK diferible a clientes, sin cascada:
--    entra a la lista de renombres del README), motivo_ips_fijado y
--    fecha_ips_fijado, los tres o ninguno; también en el histórico, y
--    fn_archivar_cuentas_ibkr los copia.
-- 3. semaforo_evaluaciones (solo agregar): una evaluación por carga, cuenta y
--    versión del motor, con hallazgos, métricas, perfil y límites aplicados,
--    indicador de IPS pendiente y el FIX usado. fn_registrar_semaforo la escribe
--    por lote, valida contra la foto y deja un asiento.
-- 4. v_comite_cartera (security_invoker): la evaluación más reciente de cada
--    cuenta, solo códigos.
-- 5. RLS: solo SELECT para authenticated; EXECUTE de las dos funciones solo para
--    authenticated.
-- 6. Bitácora: 1 asiento manual (la autoprueba se revierte entera).
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
  if to_regclass('public.tipo_cambio') is not null or to_regclass('public.semaforo_evaluaciones') is not null
     or to_regclass('public.v_comite_cartera') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name in ('cuentas_ibkr', 'cuentas_ibkr_historico') and column_name like '%ips_fijado') then
    raise exception 'guarda: el esquema del semáforo ya existe; el script no es re-ejecutable.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.fn_archivar_cuentas_ibkr()'::regprocedure)
     is distinct from '4ff3f1c3e162777c6b1379e4b0eb5c93' then
    raise exception 'guarda: fn_archivar_cuentas_ibkr no es la versión esperada (md5 del cuerpo).';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 36
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 17
     or (select count(*) from pg_policies where schemaname = 'public') <> 60
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 37 then
    raise exception 'guarda: el esquema no es el esperado (36 tablas, 17 funciones, 60 políticas, 37 triggers).';
  end if;
  if not exists (select 1 from public.sync_ibkr s join public.posiciones_detalle p on p.sync_id = s.id where s.uso = 'foto_diaria')
     or not exists (select 1 from public.cuentas_ibkr ci where not exists
                      (select 1 from public.posiciones_detalle p where p.cuenta_ibkr = ci.cuenta_ibkr)) then
    raise exception 'guarda: la autoprueba necesita una foto cargada y una cuenta sin foto.';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select count(*) from public.bitacora) as bitacora,
       (select count(*) from public.cuentas_ibkr_historico) as historico,
       (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.cuentas_ibkr x) as cuentas;

-- --- 1 · tipo_cambio -------------------------------------------------------------
create table public.tipo_cambio (
  id               uuid primary key default gen_random_uuid(),
  serie            text not null,
  fecha            date not null,
  valor            numeric(12,6) not null,
  fecha_solicitada date not null,
  fuente           text not null,
  nota             text,
  capturado_por    text not null,
  capturado_en     timestamptz not null default now(),
  constraint tipo_cambio_unico unique (serie, fecha),
  constraint tipo_cambio_serie_forma check (serie ~ '^SF[0-9]+$'),
  constraint tipo_cambio_valor_positivo check (valor > 0),
  constraint tipo_cambio_fechas check (fecha <= fecha_solicitada),
  constraint tipo_cambio_nota_si_anterior check (fecha = fecha_solicitada or btrim(coalesce(nota, '')) <> '')
);
comment on table public.tipo_cambio is
  'Tipo de cambio de Banxico (SF43718 = FIX, MXN por USD). Lo escribe fn_registrar_tipo_cambio con la sesión de '
  'quien confirma (scripts/banxico/fix.mjs); nunca a mano. Si el día pedido no tuvo FIX, se guarda el del hábil '
  'anterior con su fecha y una nota. Solo agregar.';

create trigger trg_solo_agregar before update or delete on public.tipo_cambio
  for each row execute function public.fn_solo_agregar();
create trigger trg_solo_agregar_truncate before truncate on public.tipo_cambio
  for each statement execute function public.fn_solo_agregar();
create trigger trg_bitacora after insert or update or delete on public.tipo_cambio
  for each row execute function public.fn_bitacora();

create function public.fn_registrar_tipo_cambio(p_serie text, p_fecha date, p_valor numeric,
                                                 p_fecha_solicitada date, p_fuente text, p_nota text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := fn_firmante_sesion();
  v_hoy     date := (now() at time zone 'America/Mexico_City')::date;
  v_previo  tipo_cambio%rowtype;
  v_id      uuid;
begin
  if v_usuario is null then
    raise exception 'Sin sesión: registrar un tipo de cambio exige un usuario autenticado.' using errcode = 'IB401';
  end if;
  if p_serie is null or p_serie !~ '^SF[0-9]+$' or p_fecha is null or p_fecha_solicitada is null
     or p_valor is null or p_valor <= 0 or btrim(coalesce(p_fuente, '')) = '' then
    raise exception 'Serie, fechas, valor positivo y fuente son obligatorios.' using errcode = 'IB400';
  end if;
  if p_fecha > p_fecha_solicitada or p_fecha_solicitada > v_hoy then
    raise exception 'La fecha del dato no puede ser posterior a la solicitada, ni la solicitada futura.' using errcode = 'IB400';
  end if;
  select * into v_previo from tipo_cambio where serie = p_serie and fecha = p_fecha;
  if found then
    raise exception 'Ya hay % del % (valor %): no se reescribe.', p_serie, p_fecha, v_previo.valor using errcode = 'IB409';
  end if;
  insert into tipo_cambio (serie, fecha, valor, fecha_solicitada, fuente, nota, capturado_por)
  values (p_serie, p_fecha, p_valor, p_fecha_solicitada, p_fuente, nullif(btrim(coalesce(p_nota, '')), ''), v_usuario)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'serie', p_serie, 'fecha', p_fecha, 'valor', p_valor,
                            'fecha_solicitada', p_fecha_solicitada);
end $$;

-- --- 2 · IPS fijado en cuentas_ibkr ---------------------------------------------------
alter table public.cuentas_ibkr
  add column codigo_ips_fijado text references public.clientes (codigo_cliente) deferrable,
  add column motivo_ips_fijado text,
  add column fecha_ips_fijado  date,
  add constraint cuentas_ibkr_ips_fijado_completo check (
    num_nonnulls(codigo_ips_fijado, motivo_ips_fijado, fecha_ips_fijado) in (0, 3)
    and (motivo_ips_fijado is null or btrim(motivo_ips_fijado) <> ''));
comment on column public.cuentas_ibkr.codigo_ips_fijado is
  'Código cuyo perfil_riesgo aplica a la CUENTA por decisión (con motivo y fecha), en lugar de combinar el de sus '
  'titulares. NULL = regla general (individual: el titular; conjunta: el más conservador).';

alter table public.cuentas_ibkr_historico
  add column codigo_ips_fijado text,
  add column motivo_ips_fijado text,
  add column fecha_ips_fijado  date;

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
    id, cuenta_ibkr, codigo_cliente, tipo, creado_en, creado_por, es_propia, fecha_cierre, motivo_cierre,
    codigo_ips_fijado, motivo_ips_fijado, fecha_ips_fijado)
  values (v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.cuenta_ibkr, old.codigo_cliente, old.tipo, old.creado_en, old.creado_por,
    old.es_propia, old.fecha_cierre, old.motivo_cierre,
    old.codigo_ips_fijado, old.motivo_ips_fijado, old.fecha_ips_fijado);
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end $function$;

-- --- 3 · semaforo_evaluaciones -----------------------------------------------------
create table public.semaforo_evaluaciones (
  id                uuid primary key default gen_random_uuid(),
  sync_id           uuid not null references public.sync_ibkr (id),
  fecha_foto        date not null,
  cuenta_ibkr       text not null references public.cuentas_ibkr (cuenta_ibkr) deferrable,
  estado            text not null,
  hallazgos         jsonb not null default '[]',
  metricas          jsonb not null default '{}',
  perfil_aplicado   jsonb,
  limites_aplicados jsonb not null default '{}',
  ips_pendiente     jsonb not null default '[]',
  tipo_cambio       numeric(12,6),
  version_motor     text not null,
  evaluado_por      text not null,
  evaluado_en       timestamptz not null default now(),
  constraint semaforo_unico unique (sync_id, cuenta_ibkr, version_motor),
  constraint semaforo_estado_valido check (estado in ('VERDE', 'AMBAR', 'ROJO', 'EXENTO', 'SIN_PERFIL', 'SIN_DATOS', 'INACTIVA')),
  constraint semaforo_formas check (jsonb_typeof(hallazgos) = 'array' and jsonb_typeof(metricas) = 'object'
                                    and jsonb_typeof(limites_aplicados) = 'object' and jsonb_typeof(ips_pendiente) = 'array'),
  constraint semaforo_version_forma check (version_motor ~ '^semaforo-[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint semaforo_fix_positivo check (tipo_cambio > 0)
);
comment on table public.semaforo_evaluaciones is
  'Evidencia del semáforo (M5) por carga, cuenta y versión del motor (lib/semaforo.ts). Guarda los límites que '
  'aplicó, con su origen: no depende de la tabla viva de M4. Solo agregar; escribe fn_registrar_semaforo.';
create index semaforo_por_cuenta on public.semaforo_evaluaciones (cuenta_ibkr, fecha_foto desc, evaluado_en desc);

create trigger trg_solo_agregar before update or delete on public.semaforo_evaluaciones
  for each row execute function public.fn_solo_agregar();
create trigger trg_solo_agregar_truncate before truncate on public.semaforo_evaluaciones
  for each statement execute function public.fn_solo_agregar();

create function public.fn_registrar_semaforo(p_lote jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := fn_firmante_sesion();
  v_sync    sync_ibkr%rowtype;
  v_version text;
  v_fix     numeric;
  v_evals   jsonb;
  v_malo    text;
  v_n       integer;
begin
  if v_usuario is null then
    raise exception 'Sin sesión: registrar el semáforo exige un usuario autenticado.' using errcode = 'IB401';
  end if;
  if p_lote is null or jsonb_typeof(p_lote) <> 'object' or jsonb_typeof(p_lote -> 'evaluaciones') <> 'array'
     or jsonb_array_length(p_lote -> 'evaluaciones') = 0 then
    raise exception 'El lote debe traer evaluaciones.' using errcode = 'IB400';
  end if;
  select * into v_sync from sync_ibkr where id = (p_lote ->> 'sync_id')::uuid and uso = 'foto_diaria';
  if not found then raise exception 'La carga no existe o no es una foto diaria.' using errcode = 'IB404'; end if;
  v_version := p_lote ->> 'version_motor';
  v_fix := (p_lote ->> 'tipo_cambio')::numeric;
  v_evals := p_lote -> 'evaluaciones';

  select e ->> 'cuenta_ibkr' into v_malo from jsonb_array_elements(v_evals) e
   where not exists (select 1 from cuentas_ibkr c where c.cuenta_ibkr = e ->> 'cuenta_ibkr') limit 1;
  if found then raise exception 'La cuenta % no está en cuentas_ibkr.', coalesce(v_malo, '(vacía)') using errcode = 'IB422'; end if;

  -- Contra la foto: estados con datos exigen foto; SIN_DATOS exige que NO la haya.
  select e ->> 'cuenta_ibkr' into v_malo from jsonb_array_elements(v_evals) e
   where (e ->> 'estado' in ('VERDE', 'AMBAR', 'ROJO', 'INACTIVA')) <>
         exists (select 1 from posiciones_detalle p where p.sync_id = v_sync.id and p.cuenta_ibkr = e ->> 'cuenta_ibkr')
     and e ->> 'estado' not in ('EXENTO', 'SIN_PERFIL')
   limit 1;
  if found then
    raise exception 'La evaluación de % no corresponde a la foto (estado con datos sin foto, o SIN_DATOS con foto).', v_malo
      using errcode = 'IB422';
  end if;

  insert into semaforo_evaluaciones (sync_id, fecha_foto, cuenta_ibkr, estado, hallazgos, metricas, perfil_aplicado,
                                     limites_aplicados, ips_pendiente, tipo_cambio, version_motor, evaluado_por)
  select v_sync.id, v_sync.td, x.cuenta_ibkr, x.estado, coalesce(x.hallazgos, '[]'), coalesce(x.metricas, '{}'),
         x.perfil_aplicado, coalesce(x.limites_aplicados, '{}'), coalesce(x.ips_pendiente, '[]'), v_fix, v_version, v_usuario
    from jsonb_to_recordset(v_evals) as x(cuenta_ibkr text, estado text, hallazgos jsonb, metricas jsonb,
         perfil_aplicado jsonb, limites_aplicados jsonb, ips_pendiente jsonb);
  get diagnostics v_n = row_count;

  insert into bitacora (entidad, entidad_id, accion, usuario, origen, metadata)
  values ('semaforo', v_sync.id::text, 'registro_semaforo', v_usuario, 'aplicacion',
          jsonb_build_object('fecha_foto', v_sync.td, 'version_motor', v_version, 'evaluaciones', v_n,
                             'tipo_cambio', v_fix,
                             'por_estado', (select jsonb_object_agg(estado, n) from
                                (select e ->> 'estado' as estado, count(*) n from jsonb_array_elements(v_evals) e group by 1) t)));
  return jsonb_build_object('sync_id', v_sync.id, 'fecha_foto', v_sync.td, 'evaluaciones', v_n);
end $$;

-- --- 4 · Vista del comité ------------------------------------------------------------
create view public.v_comite_cartera with (security_invoker = true) as
select ci.codigo_cliente,
       ci.tipo,
       ci.es_propia,
       e.fecha_foto,
       e.estado,
       e.metricas ->> 'moneda_base'                                   as moneda_base,
       (e.metricas ->> 'nav_base')::numeric                           as nav_base,
       (e.metricas ->> 'nav_mxn')::numeric                            as nav_mxn,
       e.perfil_aplicado ->> 'perfil'                                 as perfil,
       e.perfil_aplicado ->> 'origen'                                 as origen_perfil,
       (select count(*) from jsonb_array_elements(e.hallazgos) h where h ->> 'severidad' = 'critico')  as criticos,
       (select count(*) from jsonb_array_elements(e.hallazgos) h where h ->> 'severidad' = 'incumple') as incumplimientos,
       (select count(*) from jsonb_array_elements(e.hallazgos) h where h ->> 'severidad' = 'aviso')    as avisos,
       jsonb_array_length(e.ips_pendiente) > 0                         as actualizacion_ips_pendiente,
       e.version_motor,
       e.evaluado_en
  from (select distinct on (cuenta_ibkr) * from public.semaforo_evaluaciones
         order by cuenta_ibkr, fecha_foto desc, evaluado_en desc) e
  join public.cuentas_ibkr ci using (cuenta_ibkr);
comment on view public.v_comite_cartera is
  'La evaluación del semáforo más reciente de cada cuenta. Solo códigos. actualizacion_ips_pendiente es un indicador '
  'aparte (cuestionario de más de vigencia_ips_anios o sin ips_firmado) y NO cambia el estado.';

-- --- 5 · RLS y privilegios --------------------------------------------------------
alter table public.tipo_cambio           enable row level security;
alter table public.semaforo_evaluaciones enable row level security;
create policy tipo_cambio_select_auth           on public.tipo_cambio           for select to authenticated using (true);
create policy semaforo_evaluaciones_select_auth on public.semaforo_evaluaciones for select to authenticated using (true);

revoke all on public.tipo_cambio, public.semaforo_evaluaciones, public.v_comite_cartera
  from public, anon, authenticated, service_role;
grant select on public.tipo_cambio, public.semaforo_evaluaciones, public.v_comite_cartera to authenticated, service_role;

revoke all on function public.fn_registrar_tipo_cambio(text, date, numeric, date, text, text),
                       public.fn_registrar_semaforo(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_registrar_tipo_cambio(text, date, numeric, date, text, text),
                          public.fn_registrar_semaforo(jsonb) to authenticated;

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'semaforo-esquema', 'ddl',
        'Semáforo (M5): semaforo_evaluaciones y fn_registrar_semaforo, tipo_cambio y fn_registrar_tipo_cambio, IPS '
        'fijado en cuentas_ibkr (con histórico) y v_comite_cartera. Solo esquema; el IPS fijado de CSPMU1062 va aparte.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-16-01-semaforo-esquema.sql'));

-- --- 6 · Autoprueba (se revierte entera con IBOK0) ----------------------------------
do $$
declare
  v_sync    uuid := (select s.id from public.sync_ibkr s where s.uso = 'foto_diaria' order by s.td desc limit 1);
  v_con     text := (select p.cuenta_ibkr from public.posiciones_detalle p where p.sync_id = v_sync order by 1 limit 1);
  v_sin     text := (select ci.cuenta_ibkr from public.cuentas_ibkr ci where not exists
                       (select 1 from public.posiciones_detalle p where p.cuenta_ibkr = ci.cuenta_ibkr) order by 1 limit 1);
  v_codigo  text := (select codigo_cliente from public.cuentas_ibkr where cuenta_ibkr = v_con);
  v_lote    jsonb;
  v_r       jsonb;
begin
  begin
    -- tipo_cambio
    v_r := public.fn_registrar_tipo_cambio('SF43718', date '2000-01-03', 18.5, date '2000-01-03', 'autoprueba', null);
    begin
      perform public.fn_registrar_tipo_cambio('SF43718', date '2000-01-03', 18.6, date '2000-01-04', 'autoprueba', 'x');
      raise exception 'autoprueba: el FIX repetido no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB409' then null; end;
    begin
      perform public.fn_registrar_tipo_cambio('SF43718', date '2000-01-05', 0, date '2000-01-05', 'autoprueba', null);
      raise exception 'autoprueba: un FIX en cero no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB400' then null; end;
    begin
      insert into public.tipo_cambio (serie, fecha, valor, fecha_solicitada, fuente, capturado_por)
      values ('SF43718', date '2000-01-06', 18, date '2000-01-07', 'x', 'x');
      raise exception 'autoprueba: un FIX de otro día sin nota no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      update public.tipo_cambio set valor = 1;
      raise exception 'autoprueba: el UPDATE de tipo_cambio no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB405' then null; end;
    begin
      perform set_config('request.jwt.claims', '', true);
      perform public.fn_registrar_tipo_cambio('SF43718', date '2000-01-10', 18, date '2000-01-10', 'x', null);
      raise exception 'autoprueba: un FIX sin sesión no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB401' then null; end;

    -- IPS fijado y su histórico
    begin
      update public.cuentas_ibkr set codigo_ips_fijado = v_codigo where cuenta_ibkr = v_con;
      raise exception 'autoprueba: un IPS fijado sin motivo ni fecha no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      update public.cuentas_ibkr set codigo_ips_fijado = 'CSPFU0000', motivo_ips_fijado = 'x', fecha_ips_fijado = date '2000-01-01'
       where cuenta_ibkr = v_con;
      raise exception 'autoprueba: un IPS fijado a un código inexistente no se detuvo.' using errcode = 'IBFAL';
    exception when foreign_key_violation then null; end;
    update public.cuentas_ibkr set codigo_ips_fijado = v_codigo, motivo_ips_fijado = 'autoprueba', fecha_ips_fijado = date '2000-01-01'
     where cuenta_ibkr = v_con;
    update public.cuentas_ibkr set codigo_ips_fijado = null, motivo_ips_fijado = null, fecha_ips_fijado = null
     where cuenta_ibkr = v_con;
    if (select codigo_ips_fijado from public.cuentas_ibkr_historico where cuenta_ibkr = v_con order by version desc limit 1)
       is distinct from v_codigo then
      raise exception 'autoprueba: el histórico no copió codigo_ips_fijado.' using errcode = 'IBFAL';
    end if;

    -- semáforo
    v_lote := jsonb_build_object('sync_id', v_sync, 'version_motor', 'semaforo-1.0.0', 'tipo_cambio', 18.5,
      'evaluaciones', jsonb_build_array(
        jsonb_build_object('cuenta_ibkr', v_con, 'estado', 'VERDE', 'metricas', jsonb_build_object('nav_base', 1, 'moneda_base', 'MXN'),
                           'perfil_aplicado', jsonb_build_object('perfil', 'Moderado'), 'ips_pendiente', jsonb_build_array('x')),
        jsonb_build_object('cuenta_ibkr', v_sin, 'estado', 'SIN_DATOS')));
    v_r := public.fn_registrar_semaforo(v_lote);
    if (v_r ->> 'evaluaciones')::int <> 2
       or (select estado || '|' || actualizacion_ips_pendiente from public.v_comite_cartera where codigo_cliente = v_codigo)
          is distinct from 'VERDE|true' then
      raise exception 'autoprueba: el registro o la vista del comité no quedaron como se esperaba.' using errcode = 'IBFAL';
    end if;
    begin
      perform public.fn_registrar_semaforo(v_lote);
      raise exception 'autoprueba: el registro repetido no se detuvo.' using errcode = 'IBFAL';
    exception when unique_violation then null; end;
    begin
      perform public.fn_registrar_semaforo(jsonb_set(jsonb_set(v_lote, '{version_motor}', '"semaforo-1.0.1"'),
        '{evaluaciones}', jsonb_build_array(jsonb_build_object('cuenta_ibkr', v_con, 'estado', 'SIN_DATOS'))));
      raise exception 'autoprueba: SIN_DATOS para una cuenta con foto no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB422' then null; end;
    begin
      perform public.fn_registrar_semaforo(jsonb_set(jsonb_set(v_lote, '{version_motor}', '"semaforo-1.0.2"'),
        '{evaluaciones}', jsonb_build_array(jsonb_build_object('cuenta_ibkr', v_sin, 'estado', 'VERDE'))));
      raise exception 'autoprueba: VERDE para una cuenta sin foto no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB422' then null; end;
    begin
      perform public.fn_registrar_semaforo(jsonb_set(jsonb_set(v_lote, '{version_motor}', '"semaforo-1.0.3"'),
        '{evaluaciones}', jsonb_build_array(jsonb_build_object('cuenta_ibkr', v_sin, 'estado', 'GRIS'))));
      raise exception 'autoprueba: un estado inválido no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation or sqlstate 'IB422' then null; end;
    begin
      delete from public.semaforo_evaluaciones;
      raise exception 'autoprueba: el DELETE del semáforo no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB405' then null; end;
    raise exception 'autoprueba completa' using errcode = 'IBOK0';
  exception when sqlstate 'IBOK0' then null;
  end;
end $$;

-- --- 7 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 38
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 19
     or (select count(*) from pg_policies where schemaname = 'public') <> 62
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 42
     or (select count(*) from pg_views where schemaname = 'public') <> 1 then
    raise exception 'verificación: el esquema no quedó en 38 tablas, 19 funciones, 62 políticas, 42 triggers y 1 vista.';
  end if;
  if (select count(*) from public.tipo_cambio) + (select count(*) from public.semaforo_evaluaciones) <> 0
     or (select count(*) from public.cuentas_ibkr_historico) <> (select historico from _antes)
     or (select md5(string_agg((to_jsonb(x) - array['codigo_ips_fijado', 'motivo_ips_fijado', 'fecha_ips_fijado'])::text, '' order by x.id))
           from public.cuentas_ibkr x) is distinct from (select cuentas from _antes)
     or exists (select 1 from public.cuentas_ibkr where codigo_ips_fijado is not null) then
    raise exception 'verificación: quedaron filas de la autoprueba, o cambió cuentas_ibkr más allá de las columnas nuevas.';
  end if;
  if exists (select 1 from pg_class where oid in ('public.tipo_cambio'::regclass, 'public.semaforo_evaluaciones'::regclass)
                and not relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.v_comite_cartera'::regclass
                      and reloptions @> array['security_invoker=true'])
     or has_table_privilege('anon', 'public.v_comite_cartera', 'select')
     or has_table_privilege('authenticated', 'public.semaforo_evaluaciones', 'insert')
     or has_table_privilege('authenticated', 'public.tipo_cambio', 'insert')
     or has_function_privilege('anon', 'public.fn_registrar_semaforo(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.fn_registrar_semaforo(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.fn_registrar_tipo_cambio(text, date, numeric, date, text, text)', 'execute') then
    raise exception 'verificación: RLS, security_invoker o privilegios no son los esperados.';
  end if;
  if (select count(*) from public.bitacora where created_at = now()) <> 1
     or (select count(*) from public.bitacora) <> (select bitacora from _antes) + 1 then
    raise exception 'verificación: la bitácora no tiene solo el asiento manual.';
  end if;
end $$;

select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::text as tablas,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace)::text as funciones,
       (select count(*) from pg_policies where schemaname = 'public')::text as politicas,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where c.relnamespace = 'public'::regnamespace and not t.tgisinternal)::text as triggers,
       (select count(*) from pg_views where schemaname = 'public')::text as vistas,
       ((select bitacora from _antes) || ' → ' || (select count(*) from public.bitacora)) as bitacora;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
