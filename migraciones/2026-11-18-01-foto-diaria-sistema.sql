-- ===========================================================================
-- M2 fase 2 · foto diaria automática: funciones de sistema, eventos y control
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: solo esquema.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026). La salida del
-- real, la verificación por MCP y el md5 van en el mensaje del commit.
--
-- Réplica del repo (npm run replica, datos sintéticos): ensayo sin rastro; real
-- 39 tablas, 31 funciones, 63 políticas, 44 triggers, 2 vistas, un asiento;
-- re-ejecución detenida en la guarda. Doce mutaciones, cada una detenida por su
-- razón: _sistema firmando 'aplicacion', sin rechazar cuentas cerradas o de baja,
-- la carga manual firmando 'sistema', _sistema ejecutable por authenticated,
-- referencia_flex visible para authenticated, el trigger del FIX firmando otro
-- usuario, el control anotando dos veces, el estado ignorando la versión del
-- motor, números de cuenta sin enmascarar, el lote sin evaluaciones aceptado,
-- la vista sin security_invoker y un núcleo ejecutable por service_role.
-- La autoprueba encontró un defecto de fn_registrar_semaforo (16-nov): un lote
-- SIN la clave «evaluaciones» pasaba (0 evaluaciones y un asiento); el núcleo lo
-- corrige con coalesce.
-- Ensayo en producción, 18-nov-2026 (ROLLBACK, código de salida 0, md5 del archivo
-- ensayado 33dd8c2ac6a320b37527eaa99fffe645, que solo difiere de este en esta
-- cabecera): 39 tablas, 31 funciones, 63 políticas, 44 triggers, 2 vistas;
-- bitácora 1847 → 1848. Verificado después por MCP: nada nuevo, fn_cargar_ibkr
-- intacta (md5), 19 funciones, bitácora en 1847.
--
-- POR QUÉ
--
-- Diseño de la fase 2 aprobado por Claudio (Día 62; ajustes del 18-nov-2026): la
-- Edge Function ibkr-foto-diaria (lib/foto-diaria-sistema.ts, commit 769661c)
-- carga la foto diaria, el FIX y el semáforo sin una persona en la sesión. Las
-- funciones de hoy exigen sesión (IB401) y firman 'aplicacion'. Esta migración
-- les separa el NÚCLEO (las mismas validaciones, con el usuario y el origen como
-- parámetros) y añade las variantes _sistema (usuario sistema:ibkr-cron, origen
-- sistema), con EXECUTE solo para service_role. Los nombres y argumentos son los
-- de RPC en lib/foto-diaria-sistema.ts. El cron va en la migración 02.
--
-- QUÉ HACE
--
-- 1. ibkr_cron_eventos (solo agregar): un evento por paso de cada ejecución
--    (foto, fix, semaforo) y del control de las 08:00 (control → error). Sin
--    trg_bitacora por renglón: la tabla misma es la evidencia (como las fotos).
--    referencia_flex solo la lee service_role; authenticated lee el resto.
-- 2. Núcleos fn_cargar_ibkr_nucleo, fn_registrar_tipo_cambio_nucleo y
--    fn_registrar_semaforo_nucleo (sin EXECUTE para nadie: solo los llaman las
--    funciones de abajo). fn_cargar_ibkr, fn_registrar_tipo_cambio y
--    fn_registrar_semaforo quedan como capa: sesión obligatoria y 'aplicacion',
--    el mismo comportamiento de hoy.
-- 3. _sistema (service_role): fn_cargar_ibkr_sistema (solo foto_diaria; rechaza
--    una cuenta cerrada o de baja), fn_registrar_tipo_cambio_sistema,
--    fn_registrar_semaforo_sistema. Fijan los claims de la transacción a
--    sistema:ibkr-cron para que también los triggers de bitácora lo firmen así.
-- 4. Lectura para la función (service_role): fn_foto_diaria_estado,
--    fn_foto_diaria_referencia, fn_foto_diaria_tipo_cambio,
--    fn_datos_semaforo_sistema (la misma consulta de evaluar.mjs); escritura:
--    fn_anotar_evento_foto (valida y enmascara números de cuenta).
-- 5. fn_control_foto_diaria (para pg_cron a las 08:00; sin EXECUTE para nadie):
--    «error» si hoy ninguna ejecución dejó la foto cargada, ya cargada u omitida.
-- 6. v_foto_diaria_estado (security_invoker): un renglón por día para la
--    pantalla Hoy.
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
  if to_regclass('public.ibkr_cron_eventos') is not null
     or to_regprocedure('public.fn_cargar_ibkr_sistema(jsonb)') is not null
     or to_regclass('public.v_foto_diaria_estado') is not null then
    raise exception 'guarda: el esquema de la foto automática ya existe; el script no es re-ejecutable.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.fn_cargar_ibkr(jsonb)'::regprocedure)
       is distinct from '5377329f3a9c3945062903d49482872c'
     or (select md5(prosrc) from pg_proc where oid = 'public.fn_registrar_tipo_cambio(text,date,numeric,date,text,text)'::regprocedure)
       is distinct from '78c1c2b27fabaaf1cff76ecbce93657f'
     or (select md5(prosrc) from pg_proc where oid = 'public.fn_registrar_semaforo(jsonb)'::regprocedure)
       is distinct from 'b6c6d059b65253917afbc09657cf7fa7' then
    raise exception 'guarda: fn_cargar_ibkr, fn_registrar_tipo_cambio o fn_registrar_semaforo no son la versión esperada (md5).';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 38
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 19
     or (select count(*) from pg_policies where schemaname = 'public') <> 62
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 42
     or (select count(*) from pg_views where schemaname = 'public') <> 1 then
    raise exception 'guarda: el esquema no es el esperado (38 tablas, 19 funciones, 62 políticas, 42 triggers, 1 vista).';
  end if;
  if not exists (select 1 from public.cuentas_ibkr ci join public.clientes c using (codigo_cliente)
                  where ci.fecha_cierre is null and c.status <> 'baja')
     or not exists (select 1 from public.cuentas_ibkr ci join public.clientes c using (codigo_cliente)
                     where ci.fecha_cierre is not null or c.status = 'baja') then
    raise exception 'guarda: la autoprueba necesita una cuenta vigente y una cerrada o de baja.';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select count(*) from public.bitacora) as bitacora,
       (select count(*) from public.sync_ibkr) as syncs,
       (select count(*) from public.tipo_cambio) as fixes,
       (select count(*) from public.semaforo_evaluaciones) as semaforo;

-- --- 1 · Eventos de la foto automática ----------------------------------------------
create table public.ibkr_cron_eventos (
  id              uuid primary key default gen_random_uuid(),
  td              date,
  paso            text not null,
  resultado       text not null,
  referencia_flex text,
  sync_id         uuid references public.sync_ibkr (id),
  detalle         jsonb not null default '{}',
  creado_por      text not null default 'sistema:ibkr-cron',
  creado_en       timestamptz not null default clock_timestamp(),
  constraint ibkr_evento_paso_valido check (paso in ('foto', 'fix', 'semaforo', 'control')),
  constraint ibkr_evento_resultado_valido
    check (resultado in ('pedido', 'no_listo', 'sin_nav', 'cargado', 'ya_cargado', 'omitido', 'error')),
  constraint ibkr_evento_control_es_error check (paso <> 'control' or resultado = 'error'),
  constraint ibkr_evento_td_salvo_control check (td is not null or paso = 'control'),
  constraint ibkr_evento_referencia
    check (referencia_flex is null
           or (paso = 'foto' and resultado in ('pedido', 'no_listo') and referencia_flex ~ '^[A-Za-z0-9]{1,64}$')),
  constraint ibkr_evento_detalle_objeto check (jsonb_typeof(detalle) = 'object')
);
create index ibkr_cron_eventos_td on public.ibkr_cron_eventos (td, paso, creado_en desc);
create index ibkr_cron_eventos_creado on public.ibkr_cron_eventos (creado_en desc);
comment on table public.ibkr_cron_eventos is
  'Foto diaria automática (M2 fase 2): un evento por paso de cada ejecución y del control de las 08:00. Solo agregar.';

create trigger trg_solo_agregar before update or delete on public.ibkr_cron_eventos
  for each row execute function public.fn_solo_agregar();
create trigger trg_solo_agregar_truncate before truncate on public.ibkr_cron_eventos
  for each statement execute function public.fn_solo_agregar();

-- --- 2 · Núcleos y capas de sesión ----------------------------------------------------
create function public.fn_cargar_ibkr_nucleo(p_payload jsonb, p_usuario text, p_origen text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_usuario  text := nullif(btrim(coalesce(p_usuario, '')), '');
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
  if p_origen is null or p_origen not in ('aplicacion', 'sistema') then
    raise exception 'Origen inválido.' using errcode = 'IB400';
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
  values ('sync_ibkr', v_sync::text, 'carga_ibkr', v_usuario, p_origen,
          jsonb_build_object('uso', v_uso, 'ventana', v_ventana, 'fd', v_fd, 'td', v_td,
                             'cuentas', v_cuentas, 'renglones', v_n, 'ignoradas', v_ign,
                             'descuadres', jsonb_array_length(v_desc), 'xml_sha256', v_sha));

  return jsonb_build_object('sync_id', v_sync, 'cuentas', v_cuentas, 'renglones', v_n);
end $$;

create or replace function public.fn_cargar_ibkr(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := fn_firmante_sesion();
begin
  if v_usuario is null then
    raise exception 'Sin sesión: cargar IBKR exige un usuario autenticado.' using errcode = 'IB401';
  end if;
  return fn_cargar_ibkr_nucleo(p_payload, v_usuario, 'aplicacion');
end $$;

create function public.fn_registrar_tipo_cambio_nucleo(p_serie text, p_fecha date, p_valor numeric,
  p_fecha_solicitada date, p_fuente text, p_nota text, p_usuario text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_usuario text := nullif(btrim(coalesce(p_usuario, '')), '');
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

create or replace function public.fn_registrar_tipo_cambio(p_serie text, p_fecha date, p_valor numeric,
  p_fecha_solicitada date, p_fuente text, p_nota text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := fn_firmante_sesion();
begin
  if v_usuario is null then
    raise exception 'Sin sesión: registrar un tipo de cambio exige un usuario autenticado.' using errcode = 'IB401';
  end if;
  return fn_registrar_tipo_cambio_nucleo(p_serie, p_fecha, p_valor, p_fecha_solicitada, p_fuente, p_nota, v_usuario);
end $$;

create function public.fn_registrar_semaforo_nucleo(p_lote jsonb, p_usuario text, p_origen text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_usuario text := nullif(btrim(coalesce(p_usuario, '')), '');
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
  if p_origen is null or p_origen not in ('aplicacion', 'sistema') then
    raise exception 'Origen inválido.' using errcode = 'IB400';
  end if;
  -- coalesce: sin la clave «evaluaciones», jsonb_typeof da NULL y la versión del 16-nov dejaba pasar el
  -- lote vacío (0 evaluaciones y un asiento en la bitácora). Encontrado por la autoprueba del 18-nov.
  if p_lote is null or jsonb_typeof(p_lote) <> 'object'
     or coalesce(jsonb_typeof(p_lote -> 'evaluaciones'), '') <> 'array'
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
  values ('semaforo', v_sync.id::text, 'registro_semaforo', v_usuario, p_origen,
          jsonb_build_object('fecha_foto', v_sync.td, 'version_motor', v_version, 'evaluaciones', v_n,
                             'tipo_cambio', v_fix,
                             'por_estado', (select jsonb_object_agg(estado, n) from
                                (select e ->> 'estado' as estado, count(*) n from jsonb_array_elements(v_evals) e group by 1) t)));
  return jsonb_build_object('sync_id', v_sync.id, 'fecha_foto', v_sync.td, 'evaluaciones', v_n);
end $$;

create or replace function public.fn_registrar_semaforo(p_lote jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := fn_firmante_sesion();
begin
  if v_usuario is null then
    raise exception 'Sin sesión: registrar el semáforo exige un usuario autenticado.' using errcode = 'IB401';
  end if;
  return fn_registrar_semaforo_nucleo(p_lote, v_usuario, 'aplicacion');
end $$;

-- --- 3 · Variantes de sistema (service_role) -------------------------------------------
create function public.fn_cargar_ibkr_sistema(p_carga jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if p_carga is null or jsonb_typeof(p_carga) <> 'object' or (p_carga ->> 'uso') is distinct from 'foto_diaria' then
    raise exception 'La carga automática solo admite foto_diaria.' using errcode = 'IB400';
  end if;
  if jsonb_typeof(p_carga -> 'posiciones') = 'array' then
    select count(*) into v_n
      from jsonb_array_elements(p_carga -> 'posiciones') r
      join cuentas_ibkr ci on ci.cuenta_ibkr = r ->> 'cuenta_ibkr'
      join clientes c on c.codigo_cliente = ci.codigo_cliente
     where ci.fecha_cierre is not null or c.status = 'baja';
    if v_n > 0 then
      raise exception 'La carga automática trae % renglón(es) de cuentas cerradas o de baja: no se carga.', v_n
        using errcode = 'IB422';
    end if;
  end if;
  perform set_config('request.jwt.claims', json_build_object('email', 'sistema:ibkr-cron', 'canal', 'sistema')::text, true);
  return fn_cargar_ibkr_nucleo(p_carga, 'sistema:ibkr-cron', 'sistema');
end $$;

create function public.fn_registrar_tipo_cambio_sistema(p_serie text, p_fecha date, p_valor numeric,
  p_fecha_solicitada date, p_fuente text, p_nota text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claims', json_build_object('email', 'sistema:ibkr-cron', 'canal', 'sistema')::text, true);
  return fn_registrar_tipo_cambio_nucleo(p_serie, p_fecha, p_valor, p_fecha_solicitada, p_fuente, p_nota, 'sistema:ibkr-cron');
end $$;

create function public.fn_registrar_semaforo_sistema(p_lote jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claims', json_build_object('email', 'sistema:ibkr-cron', 'canal', 'sistema')::text, true);
  return fn_registrar_semaforo_nucleo(p_lote, 'sistema:ibkr-cron', 'sistema');
end $$;

-- --- 4 · Lectura y eventos para la Edge Function ---------------------------------------
create function public.fn_foto_diaria_estado(p_td date, p_version_motor text)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (select id from sync_ibkr where uso = 'foto_diaria' and td = p_td order by confirmado_en desc limit 1),
  u as (select distinct on (paso) paso, resultado, referencia_flex, detalle
          from ibkr_cron_eventos where td = p_td and paso in ('foto', 'fix', 'semaforo')
         order by paso, creado_en desc, id desc)
  select jsonb_build_object(
    'sync_id', (select id from s),
    'ultimo', coalesce((select jsonb_object_agg(paso, jsonb_build_object('resultado', resultado,
                 'referencia_flex', referencia_flex, 'detalle', detalle)) from u), '{}'),
    'semaforo_registrado', exists (select 1 from semaforo_evaluaciones e
                                    where e.sync_id = (select id from s) and e.version_motor = p_version_motor))
$$;

create function public.fn_foto_diaria_referencia()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object('cuenta_ibkr', ci.cuenta_ibkr, 'codigo_cliente', ci.codigo_cliente,
        'tipo', ci.tipo, 'status', c.status, 'fecha_baja', c.fecha_baja, 'fecha_cierre', ci.fecha_cierre,
        'es_propia', ci.es_propia) order by ci.codigo_cliente)
      from cuentas_ibkr ci join clientes c using (codigo_cliente)), '[]'),
    'catalogo', coalesce((select jsonb_agg(ticker order by ticker) from catalogo_instrumentos), '[]'))
$$;

create function public.fn_foto_diaria_tipo_cambio(p_serie text, p_fecha date)
returns numeric language sql stable security definer set search_path = public as $$
  select valor from tipo_cambio where serie = p_serie and fecha = p_fecha
$$;

-- La misma consulta que scripts/semaforo/evaluar.mjs, para UNA carga dada.
create function public.fn_datos_semaforo_sistema(p_sync uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_td date;
begin
  select td into v_td from sync_ibkr where id = p_sync and uso = 'foto_diaria';
  if not found then raise exception 'La carga no existe o no es una foto diaria.' using errcode = 'IB404'; end if;
  return jsonb_build_object(
    'sync', jsonb_build_object('id', p_sync, 'td', v_td),
    'foto', (select coalesce(jsonb_agg(jsonb_build_object('cuenta_ibkr', cuenta_ibkr, 'tipo_renglon', tipo_renglon, 'ticker', ticker,
        'asset_category', asset_category, 'sub_category', sub_category, 'valor_base', valor_base, 'moneda_base', moneda_base)), '[]')
      from posiciones_detalle where sync_id = p_sync),
    'cuentas', (select coalesce(jsonb_agg(jsonb_build_object('cuenta_ibkr', ci.cuenta_ibkr, 'codigo_cliente', ci.codigo_cliente,
        'tipo', ci.tipo, 'es_propia', ci.es_propia, 'fecha_cierre', ci.fecha_cierre, 'status', c.status,
        'codigo_ips_fijado', ci.codigo_ips_fijado)), '[]')
      from cuentas_ibkr ci join clientes c using (codigo_cliente)),
    'titulares', (select coalesce(jsonb_agg(jsonb_build_object('cuenta_ibkr', ct.cuenta_ibkr, 'rol', ct.rol,
        'codigo_ips', p.codigo_ips, 'codigo_ficha', p.codigo_ficha)), '[]')
      from cuenta_titulares ct join personas p on p.id = ct.persona_id),
    'perfiles', (select coalesce(jsonb_agg(jsonb_build_object('codigo', pr.codigo_cliente,
        'perfil', coalesce(pr.perfil_ajustado, pr.resultado_perfil), 'fase', pr.fase,
        'fecha_calculo', pr.fecha_calculo::date, 'fecha_cuestionario', pr.fecha_evaluacion,
        'ips_firmado', exists (select 1 from documentos_expediente d
                                where d.codigo_cliente = pr.codigo_cliente and d.tipo = 'ips_firmado'))), '[]')
      from perfil_riesgo pr),
    'limites_fase', (select coalesce(jsonb_object_agg(fase, jsonb_build_object('rv_max_pct', rv_max_pct, 'rf_min_pct', rf_min_pct,
        'liquidez_min_pct', liquidez_min_pct)), '{}') from limites_fase),
    'limites_perfil', (select coalesce(jsonb_object_agg(perfil, techos), '{}') from
        (select perfil, jsonb_object_agg(clase_activo, max_pct) techos from limites_perfil group by perfil) x),
    'reglas_perfil', (select coalesce(jsonb_object_agg(perfil, jsonb_build_object('duracion_gob_menor_a', duracion_gob_menor_a,
        'liquidez_min_pct', liquidez_min_pct, 'efectivo_cuenta_rf', efectivo_cuenta_rf, 'rv_total_max_pct', rv_total_max_pct)), '{}')
      from reglas_perfil),
    'parametros', (select coalesce(jsonb_object_agg(clave, coalesce(valor_num::text, valor_fecha::text, valor_bool::text)), '{}')
      from parametros_cumplimiento),
    'catalogo', (select coalesce(jsonb_agg(jsonb_build_object('ticker', ticker, 'clase_activo', clase_activo, 'elegible', elegible,
        'es_equivalente_efectivo', es_equivalente_efectivo, 'duracion_efectiva', duracion_efectiva)), '[]')
      from catalogo_instrumentos),
    'prorrateo', (select coalesce(jsonb_agg(jsonb_build_object('ticker', ticker, 'clase_activo', clase_activo, 'factor', factor)), '[]')
      from catalogo_prorrateo));
end $$;

create function public.fn_anotar_evento_foto(p_evento jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_td      date;
  v_sync    uuid;
  v_detalle jsonb;
  v_id      uuid;
begin
  if p_evento is null or jsonb_typeof(p_evento) <> 'object' then
    raise exception 'El evento no es un objeto.' using errcode = 'IB400';
  end if;
  if (p_evento ->> 'paso') is null or (p_evento ->> 'paso') not in ('foto', 'fix', 'semaforo') then
    raise exception 'paso debe ser foto, fix o semaforo (el control lo anota fn_control_foto_diaria).' using errcode = 'IB400';
  end if;
  begin
    v_td := (p_evento ->> 'td')::date;
    v_sync := nullif(p_evento ->> 'sync_id', '')::uuid;
  exception when others then
    raise exception 'td o sync_id con forma inválida.' using errcode = 'IB400';
  end;
  if v_td is null then raise exception 'Falta td.' using errcode = 'IB400'; end if;
  if v_sync is not null and not exists (select 1 from sync_ibkr where id = v_sync) then
    raise exception 'sync_id no existe.' using errcode = 'IB404';
  end if;
  v_detalle := coalesce(p_evento -> 'detalle', '{}');
  if jsonb_typeof(v_detalle) <> 'object' then raise exception 'detalle debe ser un objeto.' using errcode = 'IB400'; end if;
  -- Defensa en profundidad: la función ya sanea, pero ningún número de cuenta entra a la tabla.
  v_detalle := regexp_replace(v_detalle::text, '\mU[0-9]{5,}\M', 'U••••', 'g')::jsonb;
  insert into ibkr_cron_eventos (td, paso, resultado, referencia_flex, sync_id, detalle)
  values (v_td, p_evento ->> 'paso', p_evento ->> 'resultado', nullif(p_evento ->> 'referencia_flex', ''), v_sync, v_detalle)
  returning id into v_id;
  return v_id;
end $$;

-- --- 5 · Control de las 08:00 (pg_cron) ------------------------------------------------
create function public.fn_control_foto_diaria()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_td  date;
  v_ult text;
begin
  if exists (select 1 from ibkr_cron_eventos
              where paso = 'foto' and resultado in ('cargado', 'ya_cargado', 'omitido')
                and (creado_en at time zone 'America/Mexico_City')::date = v_hoy) then
    return 'ok';
  end if;
  if exists (select 1 from ibkr_cron_eventos
              where paso = 'control' and (creado_en at time zone 'America/Mexico_City')::date = v_hoy) then
    return 'error'; -- ya anotado hoy
  end if;
  select td, resultado into v_td, v_ult from ibkr_cron_eventos
   where paso = 'foto' and (creado_en at time zone 'America/Mexico_City')::date = v_hoy
   order by creado_en desc, id desc limit 1;
  insert into ibkr_cron_eventos (td, paso, resultado, detalle)
  values (v_td, 'control', 'error', jsonb_build_object(
    'motivo', case when v_td is null then 'Ninguna ejecución de la foto automática dejó eventos hoy.'
                   else 'La foto del td no quedó cargada ni omitida a las 08:00.' end,
    'ultimo_resultado_foto', v_ult,
    'recuperar', 'docs/ESPEC_IBKR_Flex.md §7.2'));
  return 'error';
end $$;

-- --- 6 · Vista para la pantalla Hoy -------------------------------------------------------
create view public.v_foto_diaria_estado with (security_invoker = true) as
with e as (
  select (creado_en at time zone 'America/Mexico_City')::date as dia, td, paso, resultado, sync_id, detalle, creado_en,
         row_number() over (partition by (creado_en at time zone 'America/Mexico_City')::date, paso
                            order by creado_en desc, id desc) as rn
    from public.ibkr_cron_eventos)
select dia,
       max(td) filter (where paso <> 'control')                      as td,
       max(resultado) filter (where paso = 'foto' and rn = 1)         as foto,
       max(sync_id::text) filter (where paso = 'foto' and rn = 1)::uuid as sync_id,
       max(resultado) filter (where paso = 'fix' and rn = 1)          as fix,
       max(resultado) filter (where paso = 'semaforo' and rn = 1)     as semaforo,
       bool_or(paso = 'control')                                      as alerta_control,
       max(coalesce(detalle ->> 'mensaje', detalle ->> 'motivo')) filter (where resultado = 'error' and rn = 1)
                                                                      as ultimo_error,
       max(creado_en)                                                 as ultimo_evento_en,
       count(*)                                                       as eventos
  from e
 group by dia;

-- --- 7 · RLS y privilegios -----------------------------------------------------------------
alter table public.ibkr_cron_eventos enable row level security;
create policy ibkr_cron_eventos_select_auth on public.ibkr_cron_eventos for select to authenticated using (true);
revoke all on public.ibkr_cron_eventos, public.v_foto_diaria_estado from public, anon, authenticated, service_role;
grant select (id, td, paso, resultado, sync_id, detalle, creado_por, creado_en) on public.ibkr_cron_eventos to authenticated;
grant select on public.ibkr_cron_eventos to service_role;
grant select on public.v_foto_diaria_estado to authenticated, service_role;

revoke all on function
  public.fn_cargar_ibkr_nucleo(jsonb, text, text),
  public.fn_registrar_tipo_cambio_nucleo(text, date, numeric, date, text, text, text),
  public.fn_registrar_semaforo_nucleo(jsonb, text, text),
  public.fn_control_foto_diaria(),
  public.fn_cargar_ibkr_sistema(jsonb),
  public.fn_registrar_tipo_cambio_sistema(text, date, numeric, date, text, text),
  public.fn_registrar_semaforo_sistema(jsonb),
  public.fn_foto_diaria_estado(date, text),
  public.fn_foto_diaria_referencia(),
  public.fn_foto_diaria_tipo_cambio(text, date),
  public.fn_datos_semaforo_sistema(uuid),
  public.fn_anotar_evento_foto(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.fn_cargar_ibkr_sistema(jsonb),
  public.fn_registrar_tipo_cambio_sistema(text, date, numeric, date, text, text),
  public.fn_registrar_semaforo_sistema(jsonb),
  public.fn_foto_diaria_estado(date, text),
  public.fn_foto_diaria_referencia(),
  public.fn_foto_diaria_tipo_cambio(text, date),
  public.fn_datos_semaforo_sistema(uuid),
  public.fn_anotar_evento_foto(jsonb)
  to service_role;

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'foto_diaria_sistema', 'migracion',
        'M2 fase 2: funciones de sistema para la foto diaria automática (núcleos + _sistema), ibkr_cron_eventos, '
        'control de las 08:00 y v_foto_diaria_estado. Diseño aprobado por Claudio (Día 62; ajustes del 18-nov-2026).',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-18-01-foto-diaria-sistema.sql'));

-- --- 8 · Autoprueba (se revierte entera con IBOK0) ----------------------------------
do $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_con    text;
  v_baja   text;
  v_r      jsonb;
  v_sync   uuid;
  v_est    jsonb;
  v_id     uuid;
  v_carga  jsonb;
  v_txt    text;
begin
  select ci.cuenta_ibkr into v_con from public.cuentas_ibkr ci join public.clientes c using (codigo_cliente)
   where ci.fecha_cierre is null and c.status <> 'baja' order by ci.cuenta_ibkr limit 1;
  select ci.cuenta_ibkr into v_baja from public.cuentas_ibkr ci join public.clientes c using (codigo_cliente)
   where ci.fecha_cierre is not null or c.status = 'baja' order by ci.cuenta_ibkr limit 1;
  begin
    v_carga := jsonb_build_object('uso', 'foto_diaria', 'fd', '2000-01-03', 'td', '2000-01-03', 'to_date_ibkr', '2000-01-03',
      'xml_sha256', encode(sha256('autoprueba-sistema'::bytea), 'hex'), 'cuentas_xml', 1, 'ignoradas', 0, 'descuadres', '[]'::jsonb,
      'posiciones', jsonb_build_array(
        jsonb_build_object('cuenta_ibkr', v_con, 'tipo_renglon', 'efectivo', 'ticker', 'EFECTIVO', 'valor_base', 100, 'moneda_base', 'MXN'),
        jsonb_build_object('cuenta_ibkr', v_con, 'tipo_renglon', 'nav_ibkr', 'ticker', 'NAV_IBKR', 'valor_base', 100, 'moneda_base', 'MXN')));

    -- a · carga de sistema: firma sistema:ibkr-cron, origen sistema
    v_r := public.fn_cargar_ibkr_sistema(v_carga);
    v_sync := (v_r ->> 'sync_id')::uuid;
    if (select confirmado_por from public.sync_ibkr where id = v_sync) is distinct from 'sistema:ibkr-cron'
       or (select usuario || '|' || origen from public.bitacora where entidad = 'sync_ibkr' and entidad_id = v_sync::text)
          is distinct from 'sistema:ibkr-cron|sistema' then
      raise exception 'autoprueba: la carga de sistema no quedó firmada por sistema:ibkr-cron con origen sistema.' using errcode = 'IBFAL';
    end if;
    -- b · solo foto_diaria; c · ni cerradas ni de baja; d · el mismo td no se recarga
    begin
      perform public.fn_cargar_ibkr_sistema(jsonb_set(v_carga, '{uso}', '"rendimiento"'));
      raise exception 'autoprueba: un rendimiento por la vía de sistema no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB400' then null; end;
    begin
      perform public.fn_cargar_ibkr_sistema(jsonb_set(jsonb_set(jsonb_set(v_carga, '{xml_sha256}',
        to_jsonb(encode(sha256('autoprueba-baja'::bytea), 'hex'))), '{posiciones,0,cuenta_ibkr}', to_jsonb(v_baja)),
        '{posiciones,1,cuenta_ibkr}', to_jsonb(v_baja)));
      raise exception 'autoprueba: una cuenta cerrada o de baja no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB422' then null; end;
    begin
      perform public.fn_cargar_ibkr_sistema(jsonb_set(v_carga, '{xml_sha256}', to_jsonb(encode(sha256('autoprueba-otra'::bytea), 'hex'))));
      raise exception 'autoprueba: una segunda foto del mismo td no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB409' then null; end;

    -- e · la carga manual sigue igual: firma de la sesión y origen aplicacion; sin sesión, IB401
    perform set_config('request.jwt.claims', v_claims, true);
    v_r := public.fn_cargar_ibkr(jsonb_set(jsonb_set(jsonb_set(jsonb_set(v_carga, '{xml_sha256}',
      to_jsonb(encode(sha256('autoprueba-manual'::bytea), 'hex'))), '{fd}', '"2000-01-04"'), '{td}', '"2000-01-04"'),
      '{to_date_ibkr}', '"2000-01-04"'));
    if (select usuario || '|' || origen from public.bitacora where entidad = 'sync_ibkr' and entidad_id = v_r ->> 'sync_id')
       is distinct from (v_claims::jsonb ->> 'email') || '|aplicacion' then
      raise exception 'autoprueba: la carga manual cambió de firma u origen.' using errcode = 'IBFAL';
    end if;
    -- (cada bloque borra la sesión dentro de sí: al capturar la excepción, set_config se revierte)
    begin
      perform set_config('request.jwt.claims', '', true);
      perform public.fn_cargar_ibkr(v_carga);
      raise exception 'autoprueba: una carga manual sin sesión no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB401' then null; end;
    begin
      perform set_config('request.jwt.claims', '', true);
      perform public.fn_registrar_semaforo(jsonb_build_object('sync_id', v_sync, 'evaluaciones',
        jsonb_build_array(jsonb_build_object('cuenta_ibkr', v_con, 'estado', 'AMBAR'))));
      raise exception 'autoprueba: un semáforo manual sin sesión no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB401' then null; end;
    begin
      perform public.fn_registrar_semaforo(jsonb_build_object('sync_id', v_sync));
      raise exception 'autoprueba: un lote sin evaluaciones no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB400' then null; end;
    if fn_firmante_sesion() is distinct from (v_claims::jsonb ->> 'email') then
      raise exception 'autoprueba: la sesión del script no se conservó.' using errcode = 'IBFAL';
    end if;

    -- f · FIX de sistema (el trigger de bitácora también lo firma sistema)
    v_r := public.fn_registrar_tipo_cambio_sistema('SF43718', date '2000-01-03', 18.5, date '2000-01-03', 'autoprueba', null);
    if (select capturado_por from public.tipo_cambio where fecha = date '2000-01-03') is distinct from 'sistema:ibkr-cron'
       or (select usuario from public.bitacora where entidad = 'tipo_cambio' and entidad_id = v_r ->> 'id')
          is distinct from 'sistema:ibkr-cron'
       or public.fn_foto_diaria_tipo_cambio('SF43718', date '2000-01-03') is distinct from 18.5
       or public.fn_foto_diaria_tipo_cambio('SF43718', date '2000-01-02') is not null then
      raise exception 'autoprueba: el FIX de sistema o su lectura no quedaron como se esperaba.' using errcode = 'IBFAL';
    end if;

    -- g · semáforo de sistema
    v_r := public.fn_registrar_semaforo_sistema(jsonb_build_object('sync_id', v_sync, 'version_motor', 'semaforo-1.1.0',
      'tipo_cambio', 18.5, 'evaluaciones', jsonb_build_array(jsonb_build_object('cuenta_ibkr', v_con, 'estado', 'AMBAR'))));
    if (select evaluado_por from public.semaforo_evaluaciones where sync_id = v_sync) is distinct from 'sistema:ibkr-cron'
       or (select usuario || '|' || origen from public.bitacora where entidad = 'semaforo' and entidad_id = v_sync::text)
          is distinct from 'sistema:ibkr-cron|sistema' then
      raise exception 'autoprueba: el semáforo de sistema no quedó firmado por sistema con origen sistema.' using errcode = 'IBFAL';
    end if;

    -- h · eventos: validación, enmascarado, solo agregar
    v_id := public.fn_anotar_evento_foto(jsonb_build_object('td', '2000-01-03', 'paso', 'foto', 'resultado', 'pedido',
      'referencia_flex', '123456789', 'detalle', jsonb_build_object('nota', 'cuenta ' || v_con)));
    if (select detalle ->> 'nota' from public.ibkr_cron_eventos where id = v_id) ~ 'U[0-9]{5,}' then
      raise exception 'autoprueba: un número de cuenta entró al evento.' using errcode = 'IBFAL';
    end if;
    begin
      perform public.fn_anotar_evento_foto(jsonb_build_object('td', '2000-01-03', 'paso', 'fix', 'resultado', 'cargado',
        'referencia_flex', '1'));
      raise exception 'autoprueba: una referencia fuera del paso foto no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      perform public.fn_anotar_evento_foto(jsonb_build_object('td', '2000-01-03', 'paso', 'control', 'resultado', 'error'));
      raise exception 'autoprueba: un control anotado por la función no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB400' then null; end;
    begin
      perform public.fn_anotar_evento_foto(jsonb_build_object('td', '2000-01-03', 'paso', 'foto', 'resultado', 'listo'));
      raise exception 'autoprueba: un resultado inválido no se detuvo.' using errcode = 'IBFAL';
    exception when check_violation then null; end;
    begin
      update public.ibkr_cron_eventos set resultado = 'cargado';
      raise exception 'autoprueba: el UPDATE de eventos no se detuvo.' using errcode = 'IBFAL';
    exception when sqlstate 'IB405' then null; end;

    -- i · estado del td
    perform public.fn_anotar_evento_foto(jsonb_build_object('td', '2000-01-03', 'paso', 'fix', 'resultado', 'cargado',
      'detalle', jsonb_build_object('valor', 18.5)));
    v_est := public.fn_foto_diaria_estado(date '2000-01-03', 'semaforo-1.1.0');
    if (v_est ->> 'sync_id')::uuid is distinct from v_sync
       or v_est #>> '{ultimo,foto,resultado}' is distinct from 'pedido'
       or v_est #>> '{ultimo,foto,referencia_flex}' is distinct from '123456789'
       or v_est #>> '{ultimo,fix,detalle,valor}' is distinct from '18.5'
       or (v_est ->> 'semaforo_registrado')::boolean is not true
       or (public.fn_foto_diaria_estado(date '2000-01-03', 'semaforo-9.9.9') ->> 'semaforo_registrado')::boolean
       or public.fn_foto_diaria_estado(date '2000-01-05', 'semaforo-1.1.0') is distinct from
          '{"sync_id": null, "ultimo": {}, "semaforo_registrado": false}'::jsonb then
      raise exception 'autoprueba: fn_foto_diaria_estado no devolvió lo esperado: %', v_est using errcode = 'IBFAL';
    end if;

    -- j · lecturas para la función
    if jsonb_array_length(public.fn_foto_diaria_referencia() -> 'cuentas') <> (select count(*) from public.cuentas_ibkr)
       or (public.fn_datos_semaforo_sistema(v_sync) #>> '{sync,td}') is distinct from '2000-01-03'
       or jsonb_array_length(public.fn_datos_semaforo_sistema(v_sync) -> 'foto') <> 2 then
      raise exception 'autoprueba: las lecturas para la función no quedaron como se esperaba.' using errcode = 'IBFAL';
    end if;
    begin
      perform public.fn_datos_semaforo_sistema(gen_random_uuid());
      raise exception 'autoprueba: datos de una carga inexistente no se detuvieron.' using errcode = 'IBFAL';
    exception when sqlstate 'IB404' then null; end;

    -- k · control de las 08:00: hoy sin foto terminal → error, una sola vez; con foto cargada → ok
    -- En sentencias separadas: dentro de una sola expresión, el conteo no vería lo que insertó el control.
    v_txt := public.fn_control_foto_diaria();
    v_txt := v_txt || '|' || public.fn_control_foto_diaria();
    v_txt := v_txt || '|' || (select count(*) from public.ibkr_cron_eventos where paso = 'control');
    if v_txt <> 'error|error|1' then
      raise exception 'autoprueba: el control no anotó un solo error (%).', v_txt using errcode = 'IBFAL';
    end if;
    perform public.fn_anotar_evento_foto(jsonb_build_object('td', '2000-01-03', 'paso', 'foto', 'resultado', 'cargado',
      'sync_id', v_sync));
    if public.fn_control_foto_diaria() <> 'ok'
       or (select foto || '|' || alerta_control from public.v_foto_diaria_estado
            where dia = (now() at time zone 'America/Mexico_City')::date) is distinct from 'cargado|true' then
      raise exception 'autoprueba: el control con foto cargada o la vista del día no quedaron como se esperaba.' using errcode = 'IBFAL';
    end if;
    raise exception 'autoprueba completa' using errcode = 'IBOK0';
  exception when sqlstate 'IBOK0' then null;
  end;
end $$;

-- --- 9 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 39
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 31
     or (select count(*) from pg_policies where schemaname = 'public') <> 63
     or (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and not t.tgisinternal) <> 44
     or (select count(*) from pg_views where schemaname = 'public') <> 2 then
    raise exception 'verificación: el esquema no quedó en 39 tablas, 31 funciones, 63 políticas, 44 triggers y 2 vistas.';
  end if;
  if (select count(*) from public.ibkr_cron_eventos) <> 0
     or (select count(*) from public.sync_ibkr) <> (select syncs from _antes)
     or (select count(*) from public.tipo_cambio) <> (select fixes from _antes)
     or (select count(*) from public.semaforo_evaluaciones) <> (select semaforo from _antes) then
    raise exception 'verificación: quedaron filas de la autoprueba.';
  end if;
  if current_setting('request.jwt.claims', true)::jsonb ->> 'canal' is distinct from 'psql' then
    raise exception 'verificación: los claims de la sesión no volvieron a los del script.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ibkr_cron_eventos'::regclass)
     or not exists (select 1 from pg_class where oid = 'public.v_foto_diaria_estado'::regclass
                      and reloptions @> array['security_invoker=true'])
     or has_column_privilege('authenticated', 'public.ibkr_cron_eventos', 'referencia_flex', 'select')
     or not has_column_privilege('authenticated', 'public.ibkr_cron_eventos', 'detalle', 'select')
     or has_table_privilege('authenticated', 'public.ibkr_cron_eventos', 'insert')
     or has_table_privilege('anon', 'public.v_foto_diaria_estado', 'select')
     or not has_table_privilege('authenticated', 'public.v_foto_diaria_estado', 'select')
     or has_function_privilege('authenticated', 'public.fn_cargar_ibkr_sistema(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.fn_anotar_evento_foto(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.fn_cargar_ibkr_sistema(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.fn_datos_semaforo_sistema(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.fn_cargar_ibkr_nucleo(jsonb, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.fn_registrar_semaforo_nucleo(jsonb, text, text)', 'execute')
     or has_function_privilege('service_role', 'public.fn_control_foto_diaria()', 'execute')
     or not has_function_privilege('authenticated', 'public.fn_cargar_ibkr(jsonb)', 'execute')
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
