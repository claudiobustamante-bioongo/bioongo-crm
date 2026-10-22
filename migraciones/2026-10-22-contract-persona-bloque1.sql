-- ===========================================================================
-- Contract persona ↔ cuenta · bloque 1 · expand por persona_id + backfill
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
-- con cada fila en su dueño, identidad igual a la ficha, 9/9 tablas sin otro
-- cambio y espejos extendidos; re-ejecución detenida en la guarda; una fila de
-- KYC sin persona ni conjunta detiene el ensayo sin rastro.
-- Ensayo en producción, 22-oct-2026 (ROLLBACK, código de salida 0):
--   kyc / pep       25 persona · 4 histórico · total 29
--   perfil          31 persona · 4 sin persona (conjunta) · total 35
--   ebr             128 persona · 20 sin persona (conjunta) · total 148
--   propietario     25 persona · 4 cuenta · total 29
--   beneficiarios   15 persona · 5 cuenta · total 20
--   transaccional.  32 cuenta · total 32
--   identidad 32 de 32 · tablas sin otro cambio 9 de 9 · espejos perfil +31,
--   personas +32 · 731 asientos de bitácora.
-- Verificado después por MCP: ninguna columna nueva, beneficiarios.persona_id con
-- su nombre de antes y la bitácora sin asientos del ensayo.
--
-- POR QUÉ
--
-- El formulario de onboarding escribirá por persona, y una persona puede existir
-- antes de tener cuenta (y por lo tanto código). Este bloque prepara la estructura
-- definitiva SIN cambiar a ningún lector: todo es columna nueva y nullable, y
-- codigo_cliente sigue intacto. Los lectores pasan a persona_id en los bloques
-- 2 (IPS), 3 (EBR) y 4 (ficha y /editar); el contract (NOT NULL) es el 5.
--
-- QUÉ HACE (decisiones de Claudio del 22-oct-2026)
--
-- 1. Dueño por persona (persona_id): kyc_detalle, pep_listas, perfil_riesgo,
--    ebr_evaluaciones; propietario_real y beneficiarios cuando son de una ficha.
--    Backfill desde los punteros de personas (codigo_kyc, codigo_pep, codigo_ips,
--    codigo_ebr) o, en propietario_real y beneficiarios, desde codigo_ficha.
-- 2. Dueño por cuenta (cuenta_ibkr): transaccionalidad (toda: es declaración por
--    contrato; el total por persona será una vista); propietario_real y
--    beneficiarios de las filas de las cuatro cuentas conjuntas (CSPFU1488,
--    CSPFU2162, CSPFU8588, CSPMU3071).
-- 3. KYC y PEP de esas cuatro conjuntas: históricos, conservados por PLD, con
--    no_vigente_motivo («previo al modelo persona, no vigente»), sin persona.
--    Perfil y EBR de las conjuntas: sin persona y SIN marca hasta los bloques 2 y 3.
-- 4. beneficiarios.persona_id (el «beneficiario es la persona X», bloque 1 de
--    persona↔cuenta) pasa a llamarse beneficiario_persona_id; persona_id es ahora
--    el dueño.
-- 5. Identidad en personas como COPIA de la ficha (clientes sigue siendo la fuente
--    hasta el bloque 4, que la refresca reportando antes qué cambió).
-- 6. Los espejos (perfil_riesgo_historico, personas_historico) y sus funciones de
--    archivo se extienden con las columnas nuevas.
--
-- No se tocan filas fuera de las columnas nuevas; la verificación lo comprueba con
-- huellas de cada tabla sin esas columnas.
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
declare v text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
               and ((table_name in ('kyc_detalle', 'pep_listas', 'perfil_riesgo', 'ebr_evaluaciones', 'propietario_real')
                     and column_name = 'persona_id')
                    or (table_name = 'beneficiarios' and column_name = 'beneficiario_persona_id')
                    or (table_name = 'transaccionalidad' and column_name = 'cuenta_ibkr')
                    or (table_name = 'personas' and column_name = 'rfc'))) then
    raise exception 'guarda: alguna columna del bloque ya existe; el script no es re-ejecutable.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'beneficiarios' and column_name = 'persona_id') then
    raise exception 'guarda: falta beneficiarios.persona_id (la del bloque 1 de persona↔cuenta).';
  end if;
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc where proname = 'fn_archivar_perfil_riesgo'
       and pronamespace = 'public'::regnamespace) is distinct from '54c9f5e10b5c4372550f21fc6da41935'
     or (select md5(replace(prosrc, E'\r', '')) from pg_proc where proname = 'fn_archivar_personas'
       and pronamespace = 'public'::regnamespace) is distinct from '165fd3419b5e40b17c568535074d5e52' then
    raise exception 'guarda: fn_archivar_perfil_riesgo o fn_archivar_personas no son las versiones revisadas.';
  end if;
  -- Las cuatro conjuntas existen como cuenta conjunta y no son ficha de nadie.
  if (select count(*) from public.cuentas_ibkr where tipo = 'conjunta'
        and codigo_cliente in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071')) <> 4
     or exists (select 1 from public.personas
                 where codigo_ficha in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071')) then
    raise exception 'guarda: las cuatro cuentas conjuntas no están como se revisó.';
  end if;
  -- Toda fila es de una ficha de persona o de una de esas conjuntas: nada queda sin dueño.
  select string_agg(distinct t || ':' || c, ',') into v from (
    select 'kyc' t, codigo_cliente c from public.kyc_detalle
    union all select 'pep', codigo_cliente from public.pep_listas
    union all select 'perfil', codigo_cliente from public.perfil_riesgo
    union all select 'ebr', codigo_cliente from public.ebr_evaluaciones
    union all select 'propietario', codigo_cliente from public.propietario_real
    union all select 'beneficiario', codigo_cliente from public.beneficiarios) x
   where c not in (select codigo_ficha from public.personas)
     and c not in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071');
  if v is not null then raise exception 'guarda: filas sin ficha de persona ni cuenta conjunta: %', v; end if;
  if exists (select 1 from public.transaccionalidad t
              where not exists (select 1 from public.cuentas_ibkr ci where ci.codigo_cliente = t.codigo_cliente)) then
    raise exception 'guarda: hay transaccionalidad de un código sin cuenta.';
  end if;
  -- Los punteros de personas apuntan a filas de su propio código (bloque 2).
  if exists (select 1 from public.personas where coalesce(codigo_kyc, codigo_ficha) <> codigo_ficha
               or coalesce(codigo_pep, codigo_ficha) <> codigo_ficha or coalesce(codigo_ips, codigo_ficha) <> codigo_ficha
               or coalesce(codigo_ebr, codigo_ficha) <> codigo_ficha) then
    raise exception 'guarda: algún puntero de personas no es su propio código.';
  end if;
end $$;

-- Huellas de lo que NO debe cambiar (cada tabla sin las columnas nuevas).
create temporary table _huella (tabla text primary key, antes text, despues text) on commit drop;
insert into _huella (tabla, antes)
select 'kyc_detalle', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from public.kyc_detalle x
union all select 'pep_listas', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from public.pep_listas x
union all select 'perfil_riesgo', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from public.perfil_riesgo x
union all select 'ebr_evaluaciones', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from public.ebr_evaluaciones x
union all select 'propietario_real', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from public.propietario_real x
union all select 'beneficiarios', md5(coalesce(string_agg((to_jsonb(x) - 'persona_id')::text, '' order by x.id), '')) from public.beneficiarios x
union all select 'transaccionalidad', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from public.transaccionalidad x
union all select 'personas', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.id), '')) from public.personas x
union all select 'clientes', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.codigo_cliente), '')) from public.clientes x;
create temporary table _b2 on commit drop as select id, persona_id from public.beneficiarios where persona_id is not null;

-- --- 1 · beneficiarios: el «beneficiario es la persona X» cambia de nombre ---------
alter table public.beneficiarios rename column persona_id to beneficiario_persona_id;
alter table public.beneficiarios rename constraint beneficiarios_persona_id_fkey to beneficiarios_beneficiario_persona_id_fkey;
alter index public.idx_beneficiarios_persona rename to idx_beneficiarios_beneficiario_persona;
comment on column public.beneficiarios.beneficiario_persona_id is
  'El beneficiario cuando es una persona del expediente (p. ej. B2 de CSPFU2963). NULL = no vinculado. '
  'Antes se llamaba persona_id (renombrada el 22-oct-2026; persona_id es ahora el dueño).';

-- --- 2 · Columnas nuevas -------------------------------------------------------
alter table public.kyc_detalle
  add column persona_id uuid references public.personas (id) deferrable initially immediate,
  add column no_vigente_motivo text,
  add constraint kyc_no_vigente_lleno check (no_vigente_motivo is null or btrim(no_vigente_motivo) <> ''),
  add constraint kyc_vigente_o_persona check (no_vigente_motivo is null or persona_id is null);
alter table public.pep_listas
  add column persona_id uuid references public.personas (id) deferrable initially immediate,
  add column no_vigente_motivo text,
  add constraint pep_no_vigente_lleno check (no_vigente_motivo is null or btrim(no_vigente_motivo) <> ''),
  add constraint pep_vigente_o_persona check (no_vigente_motivo is null or persona_id is null);
alter table public.perfil_riesgo
  add column persona_id uuid references public.personas (id) deferrable initially immediate;
alter table public.perfil_riesgo_historico add column persona_id uuid;
alter table public.ebr_evaluaciones
  add column persona_id uuid references public.personas (id) deferrable initially immediate;
alter table public.propietario_real
  add column persona_id uuid references public.personas (id) deferrable initially immediate,
  add column cuenta_ibkr text references public.cuentas_ibkr (cuenta_ibkr) deferrable initially immediate,
  add constraint propietario_un_dueno check (persona_id is null or cuenta_ibkr is null);
alter table public.beneficiarios
  add column persona_id uuid references public.personas (id) deferrable initially immediate,
  add column cuenta_ibkr text references public.cuentas_ibkr (cuenta_ibkr) deferrable initially immediate,
  add constraint beneficiarios_un_dueno check (persona_id is null or cuenta_ibkr is null);
alter table public.transaccionalidad
  add column cuenta_ibkr text references public.cuentas_ibkr (cuenta_ibkr) deferrable initially immediate;

create unique index uq_kyc_por_persona    on public.kyc_detalle (persona_id)   where persona_id is not null;
create unique index uq_pep_por_persona    on public.pep_listas (persona_id)    where persona_id is not null;
create unique index uq_perfil_por_persona on public.perfil_riesgo (persona_id) where persona_id is not null;
create index idx_ebr_persona_fecha        on public.ebr_evaluaciones (persona_id, fecha_evaluacion desc) where persona_id is not null;
create index idx_propietario_persona      on public.propietario_real (persona_id) where persona_id is not null;
create index idx_beneficiarios_dueno      on public.beneficiarios (persona_id) where persona_id is not null;
create index idx_transaccionalidad_cuenta on public.transaccionalidad (cuenta_ibkr);

-- Identidad: COPIA de la ficha; clientes sigue siendo la fuente hasta el bloque 4.
alter table public.personas
  add column nombre text, add column apellido_paterno text, add column apellido_materno text,
  add column genero text, add column fecha_nacimiento date, add column rfc text, add column curp text,
  add column estado_civil text, add column correo text, add column celular text,
  add column grado_estudios text, add column ocupacion text, add column ingreso_neto_mensual numeric,
  add column ahorros_aprox numeric, add column identidad_copiada_en timestamptz;
alter table public.personas_historico
  add column nombre text, add column apellido_paterno text, add column apellido_materno text,
  add column genero text, add column fecha_nacimiento date, add column rfc text, add column curp text,
  add column estado_civil text, add column correo text, add column celular text,
  add column grado_estudios text, add column ocupacion text, add column ingreso_neto_mensual numeric,
  add column ahorros_aprox numeric, add column identidad_copiada_en timestamptz;

comment on column public.kyc_detalle.no_vigente_motivo is
  'NULL = vigente. Con texto: histórico conservado por PLD y excluido de todo cálculo.';
comment on column public.pep_listas.no_vigente_motivo is
  'NULL = vigente. Con texto: histórico conservado por PLD y excluido de todo cálculo.';
comment on column public.transaccionalidad.cuenta_ibkr is
  'La transaccionalidad es declaración por contrato: de la cuenta. El total por persona será una vista.';
comment on column public.personas.identidad_copiada_en is
  'Identidad COPIADA de clientes (ficha) en esta fecha. clientes es la fuente hasta el bloque 4 del '
  'contract, que la refresca reportando antes qué cambió.';

-- --- 3 · Espejos: las funciones de archivo copian también lo nuevo ---------------
create or replace function public.fn_archivar_perfil_riesgo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario text;
  v_version integer;
  v_campos  text[];
begin
  -- Un UPDATE que no cambió ningún valor no merece una versión.
  if (tg_op = 'UPDATE') and (to_jsonb(old) is not distinct from to_jsonb(new)) then
    return new;
  end if;
  v_usuario := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo');
  if (tg_op = 'UPDATE') then
    select array_agg(nuevo.key order by nuevo.key) into v_campos
      from jsonb_each_text(to_jsonb(new)) as nuevo(key, value)
     where nuevo.value is distinct from (to_jsonb(old) ->> nuevo.key);
  end if;
  select coalesce(max(version), 0) + 1 into v_version
    from perfil_riesgo_historico where codigo_cliente = old.codigo_cliente;
  insert into perfil_riesgo_historico (
    version, archivado_por, operacion, campos_cambiados, snapshot,
    id, codigo_cliente, objetivo_inversion, ganancia_deseada, horizonte,
    tolerancia_perdida, resultado_perfil, perfil_ia, respuestas_completas,
    fecha_evaluacion, created_at, reaccion_caida_10, negocio_propio,
    percepcion_riesgo_empleo, prefiere_ingreso_seguro, no_puede_perder,
    colchon_liquidez, dependientes, situacion_habitacional, ahorros, hipoteca,
    otras_deudas, fase, tolerancia_puntos, tolerancia_nivel, capacidad_puntos,
    capacidad_nivel, puntuacion_ponderada, perfil_solicitado_cliente,
    bitacora_calculo, fecha_calculo, tiene_ahorros, comentario_asesor,
    perfil_ajustado_por, fecha_ajuste, perfil_ajustado, ajustado_por, persona_id
  ) values (
    v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.codigo_cliente, old.objetivo_inversion, old.ganancia_deseada,
    old.horizonte, old.tolerancia_perdida, old.resultado_perfil, old.perfil_ia,
    old.respuestas_completas, old.fecha_evaluacion, old.created_at,
    old.reaccion_caida_10, old.negocio_propio, old.percepcion_riesgo_empleo,
    old.prefiere_ingreso_seguro, old.no_puede_perder, old.colchon_liquidez,
    old.dependientes, old.situacion_habitacional, old.ahorros, old.hipoteca,
    old.otras_deudas, old.fase, old.tolerancia_puntos, old.tolerancia_nivel,
    old.capacidad_puntos, old.capacidad_nivel, old.puntuacion_ponderada,
    old.perfil_solicitado_cliente, old.bitacora_calculo, old.fecha_calculo,
    old.tiene_ahorros, old.comentario_asesor, old.perfil_ajustado_por,
    old.fecha_ajuste, old.perfil_ajustado, old.ajustado_por, old.persona_id
  );
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end;
$$;

create or replace function public.fn_archivar_personas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text; v_version integer; v_campos text[];
begin
  if (tg_op = 'UPDATE') and (to_jsonb(old) is not distinct from to_jsonb(new)) then return new; end if;
  v_usuario := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo');
  if (tg_op = 'UPDATE') then
    select array_agg(n.key order by n.key) into v_campos
      from jsonb_each_text(to_jsonb(new)) n(key, value) where n.value is distinct from (to_jsonb(old) ->> n.key);
  end if;
  select coalesce(max(version), 0) + 1 into v_version from personas_historico where id = old.id;
  insert into personas_historico (version, archivado_por, operacion, campos_cambiados, snapshot,
    id, codigo_reporte, codigo_ficha, codigo_kyc, codigo_pep, codigo_ips, codigo_ebr, nota, creado_en, creado_por,
    nombre, apellido_paterno, apellido_materno, genero, fecha_nacimiento, rfc, curp, estado_civil, correo, celular,
    grado_estudios, ocupacion, ingreso_neto_mensual, ahorros_aprox, identidad_copiada_en)
  values (v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.codigo_reporte, old.codigo_ficha, old.codigo_kyc, old.codigo_pep, old.codigo_ips, old.codigo_ebr,
    old.nota, old.creado_en, old.creado_por,
    old.nombre, old.apellido_paterno, old.apellido_materno, old.genero, old.fecha_nacimiento, old.rfc, old.curp,
    old.estado_civil, old.correo, old.celular, old.grado_estudios, old.ocupacion, old.ingreso_neto_mensual,
    old.ahorros_aprox, old.identidad_copiada_en);
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end $$;
revoke execute on function public.fn_archivar_perfil_riesgo(), public.fn_archivar_personas()
  from public, anon, authenticated;

-- --- 4 · Backfill ---------------------------------------------------------------
update public.kyc_detalle k set persona_id = p.id from public.personas p where p.codigo_kyc = k.codigo_cliente;
update public.pep_listas x set persona_id = p.id from public.personas p where p.codigo_pep = x.codigo_cliente;
update public.perfil_riesgo r set persona_id = p.id from public.personas p where p.codigo_ips = r.codigo_cliente;
update public.ebr_evaluaciones e set persona_id = p.id from public.personas p where p.codigo_ebr = e.codigo_cliente;
update public.propietario_real x set persona_id = p.id from public.personas p where p.codigo_ficha = x.codigo_cliente;
update public.beneficiarios b set persona_id = p.id from public.personas p where p.codigo_ficha = b.codigo_cliente;

update public.propietario_real x set cuenta_ibkr = ci.cuenta_ibkr from public.cuentas_ibkr ci
 where ci.codigo_cliente = x.codigo_cliente and x.codigo_cliente in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071');
update public.beneficiarios b set cuenta_ibkr = ci.cuenta_ibkr from public.cuentas_ibkr ci
 where ci.codigo_cliente = b.codigo_cliente and b.codigo_cliente in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071');
update public.transaccionalidad t set cuenta_ibkr = ci.cuenta_ibkr from public.cuentas_ibkr ci
 where ci.codigo_cliente = t.codigo_cliente;

update public.kyc_detalle set no_vigente_motivo =
  'Previo al modelo persona, no vigente: KYC capturado en la fila de la cuenta conjunta ' || codigo_cliente
  || '. Conservado por PLD; excluido de todo cálculo (decisión del 22-oct-2026).'
 where codigo_cliente in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071');
update public.pep_listas set no_vigente_motivo =
  'Previo al modelo persona, no vigente: PEP capturado en la fila de la cuenta conjunta ' || codigo_cliente
  || '. Conservado por PLD; excluido de todo cálculo (decisión del 22-oct-2026).'
 where codigo_cliente in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071');

update public.personas p
   set nombre = c.nombre, apellido_paterno = c.apellido_paterno, apellido_materno = c.apellido_materno,
       genero = c.genero, fecha_nacimiento = c.fecha_nacimiento, rfc = c.rfc, curp = c.curp,
       estado_civil = c.estado_civil, correo = c.correo, celular = c.celular, grado_estudios = c.grado_estudios,
       ocupacion = c.ocupacion, ingreso_neto_mensual = c.ingreso_neto_mensual, ahorros_aprox = c.ahorros_aprox,
       identidad_copiada_en = now()
  from public.clientes c where c.codigo_cliente = p.codigo_ficha;

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('personas', 'contract-bloque1', 'contract_persona',
        'Contract persona ↔ cuenta, bloque 1: persona_id y cuenta_ibkr como dueños nuevos (columnas nullables), '
        'backfill desde los punteros de personas, KYC y PEP de las cuatro conjuntas marcados como históricos, '
        'beneficiarios.persona_id renombrada a beneficiario_persona_id e identidad copiada a personas.',
        fn_firmante_sesion(), 'migracion', jsonb_build_object('canal', 'psql'));

-- --- 5 · Verificación dentro de la transacción ---------------------------------
create temporary table _conteo on commit drop as
select 'kyc' t, count(*) filter (where persona_id is not null) persona, count(*) filter (where no_vigente_motivo is not null) historico,
       0::bigint cuenta, count(*) filter (where persona_id is null and no_vigente_motivo is null) sin_dueno, count(*) total from public.kyc_detalle
union all select 'pep', count(*) filter (where persona_id is not null), count(*) filter (where no_vigente_motivo is not null), 0,
       count(*) filter (where persona_id is null and no_vigente_motivo is null), count(*) from public.pep_listas
union all select 'perfil', count(*) filter (where persona_id is not null), 0, 0,
       count(*) filter (where persona_id is null and codigo_cliente not in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071')), count(*) from public.perfil_riesgo
union all select 'ebr', count(*) filter (where persona_id is not null), 0, 0,
       count(*) filter (where persona_id is null and codigo_cliente not in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071')), count(*) from public.ebr_evaluaciones
union all select 'propietario', count(*) filter (where persona_id is not null), 0, count(*) filter (where cuenta_ibkr is not null),
       count(*) filter (where persona_id is null and cuenta_ibkr is null), count(*) from public.propietario_real
union all select 'beneficiarios', count(*) filter (where persona_id is not null), 0, count(*) filter (where cuenta_ibkr is not null),
       count(*) filter (where persona_id is null and cuenta_ibkr is null), count(*) from public.beneficiarios
union all select 'transaccionalidad', 0, 0, count(*) filter (where cuenta_ibkr is not null),
       count(*) filter (where cuenta_ibkr is null), count(*) from public.transaccionalidad;

do $$
declare v text; n bigint;
begin
  if exists (select 1 from _conteo where sin_dueno > 0) then
    select string_agg(t || ' ' || sin_dueno, ', ') into v from _conteo where sin_dueno > 0;
    raise exception 'verificación: filas sin dueño: %', v;
  end if;
  -- Cada persona_id coincide con su puntero o con su ficha.
  select count(*) into n from (
    select 1 from public.kyc_detalle k join public.personas p on p.id = k.persona_id where p.codigo_kyc <> k.codigo_cliente
    union all select 1 from public.pep_listas x join public.personas p on p.id = x.persona_id where p.codigo_pep <> x.codigo_cliente
    union all select 1 from public.perfil_riesgo r join public.personas p on p.id = r.persona_id where p.codigo_ips <> r.codigo_cliente
    union all select 1 from public.ebr_evaluaciones e join public.personas p on p.id = e.persona_id where p.codigo_ebr <> e.codigo_cliente
    union all select 1 from public.propietario_real x join public.personas p on p.id = x.persona_id where p.codigo_ficha <> x.codigo_cliente
    union all select 1 from public.beneficiarios b join public.personas p on p.id = b.persona_id where p.codigo_ficha <> b.codigo_cliente
    union all select 1 from public.transaccionalidad t join public.cuentas_ibkr ci on ci.cuenta_ibkr = t.cuenta_ibkr where ci.codigo_cliente <> t.codigo_cliente) z;
  if n <> 0 then raise exception 'verificación: % filas con un dueño que no corresponde a su código.', n; end if;
  -- Las cuatro conjuntas: KYC y PEP históricos, propietario y beneficiarios a la cuenta, perfil y EBR sin persona.
  if exists (select 1 from public.kyc_detalle where codigo_cliente in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071')
               and (no_vigente_motivo is null or persona_id is not null))
     or exists (select 1 from public.pep_listas where codigo_cliente in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071')
               and (no_vigente_motivo is null or persona_id is not null))
     or exists (select 1 from public.kyc_detalle where no_vigente_motivo is not null
               and codigo_cliente not in ('CSPFU1488', 'CSPFU2162', 'CSPFU8588', 'CSPMU3071')) then
    raise exception 'verificación: los históricos de las conjuntas no quedaron como se decidió.';
  end if;
  -- Identidad: copia exacta de la ficha.
  select count(*) into n from public.personas p join public.clientes c on c.codigo_cliente = p.codigo_ficha
   where row(p.nombre, p.apellido_paterno, p.apellido_materno, p.genero, p.fecha_nacimiento, p.rfc, p.curp, p.estado_civil,
             p.correo, p.celular, p.grado_estudios, p.ocupacion, p.ingreso_neto_mensual, p.ahorros_aprox)
         is distinct from
         row(c.nombre, c.apellido_paterno, c.apellido_materno, c.genero, c.fecha_nacimiento, c.rfc, c.curp, c.estado_civil,
             c.correo, c.celular, c.grado_estudios, c.ocupacion, c.ingreso_neto_mensual, c.ahorros_aprox)
      or p.identidad_copiada_en is null;
  if n <> 0 then raise exception 'verificación: % personas con la identidad distinta de su ficha.', n; end if;
  -- El B2 sigue vinculado, ahora en beneficiario_persona_id.
  if (select count(*) from public.beneficiarios b join _b2 on _b2.id = b.id and _b2.persona_id = b.beneficiario_persona_id)
     <> (select count(*) from _b2)
     or (select count(*) from public.beneficiarios where beneficiario_persona_id is not null) <> (select count(*) from _b2) then
    raise exception 'verificación: el vínculo del beneficiario B2 no sobrevivió al cambio de nombre.';
  end if;
  -- Nada más cambió: huellas sin las columnas nuevas.
  update _huella h set despues = x.h from (
    select 'kyc_detalle' t, md5(coalesce(string_agg((to_jsonb(x) - 'persona_id' - 'no_vigente_motivo')::text, '' order by x.id), '')) h from public.kyc_detalle x
    union all select 'pep_listas', md5(coalesce(string_agg((to_jsonb(x) - 'persona_id' - 'no_vigente_motivo')::text, '' order by x.id), '')) from public.pep_listas x
    union all select 'perfil_riesgo', md5(coalesce(string_agg((to_jsonb(x) - 'persona_id')::text, '' order by x.id), '')) from public.perfil_riesgo x
    union all select 'ebr_evaluaciones', md5(coalesce(string_agg((to_jsonb(x) - 'persona_id')::text, '' order by x.id), '')) from public.ebr_evaluaciones x
    union all select 'propietario_real', md5(coalesce(string_agg((to_jsonb(x) - 'persona_id' - 'cuenta_ibkr')::text, '' order by x.id), '')) from public.propietario_real x
    union all select 'beneficiarios', md5(coalesce(string_agg((to_jsonb(x) - 'persona_id' - 'cuenta_ibkr' - 'beneficiario_persona_id')::text, '' order by x.id), '')) from public.beneficiarios x
    union all select 'transaccionalidad', md5(coalesce(string_agg((to_jsonb(x) - 'cuenta_ibkr')::text, '' order by x.id), '')) from public.transaccionalidad x
    union all select 'personas', md5(coalesce(string_agg((to_jsonb(x) - 'nombre' - 'apellido_paterno' - 'apellido_materno' - 'genero'
         - 'fecha_nacimiento' - 'rfc' - 'curp' - 'estado_civil' - 'correo' - 'celular' - 'grado_estudios' - 'ocupacion'
         - 'ingreso_neto_mensual' - 'ahorros_aprox' - 'identidad_copiada_en')::text, '' order by x.id), '')) from public.personas x
    union all select 'clientes', md5(coalesce(string_agg(to_jsonb(x)::text, '' order by x.codigo_cliente), '')) from public.clientes x) x
   where h.tabla = x.t;
  select string_agg(tabla, ',') into v from _huella where antes is distinct from despues;
  if v is not null then raise exception 'verificación: cambió algo fuera de las columnas nuevas en: %', v; end if;
  -- Bitácora de la transacción: todo con el usuario pasado.
  if exists (select 1 from public.bitacora where created_at = now()
               and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: hay asientos sin el usuario pasado.';
  end if;
end $$;

select t as tabla, persona::text || ' persona · ' || cuenta || ' cuenta · ' || historico || ' histórico · '
       || (total - persona - cuenta - historico) || ' sin persona (conjunta, hasta bloques 2-3) · total ' || total as estado
  from _conteo
union all
select 'identidad en personas', (select count(*) from public.personas where identidad_copiada_en is not null)::text
       || ' de ' || (select count(*) from public.personas)::text || ' copiadas, iguales a su ficha'
union all
select 'tablas sin otro cambio', (select count(*) from _huella where antes = despues)::text || ' de ' || (select count(*) from _huella)::text
union all
select 'espejos', 'perfil +' || (select count(*) from public.perfil_riesgo_historico where archivado_en = now())
       || ' · personas +' || (select count(*) from public.personas_historico where archivado_en = now())
union all
select 'asientos de bitácora', (select count(*) from public.bitacora where created_at = now())::text;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
