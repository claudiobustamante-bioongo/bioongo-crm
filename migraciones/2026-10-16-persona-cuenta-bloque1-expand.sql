-- ===========================================================================
-- Persona ↔ cuenta · bloque 1 · DDL expand + extensión de fn_bitacora
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre, también en esta
-- cabecera: se escribió ANTES del modo real y no se toca después. El resultado
-- del modo real y la verificación posterior por MCP quedan en el mensaje del
-- commit que lo archiva, junto con el md5 de este archivo.
--
-- Antes, en una réplica PGlite 0.3.7 (Postgres 17.5) con la fn_bitacora de
-- producción (huella verificada) y datos sintéticos: 48/48 (ensayo sin rastro,
-- re-ejecución detenida en la guarda, paridad de asientos antes/después en las
-- tablas existentes, identificador por código o cuenta en las nuevas,
-- restricciones, FK diferibles en un renombre, espejos, RLS y privilegios).
-- Por MCP contra producción: las guardas en verde y la paridad sobre 363 filas
-- de 13 tablas, 0 diferencias.
--
-- Ensayo en producción, 16-oct-2026 (modo=ensayo, mismo cuerpo; terminó en
-- ROLLBACK, código de salida 0):
--
--   paridad fn_bitacora       363 filas comparadas en 10 tablas · 0 diferencias
--   tablas nuevas             6 de 6 · vacías
--   triggers nuevos           6 de 6
--   tablas con trg_bitacora   16 (antes 13)
--   fn_bitacora               secdef true · search_path=public
--   beneficiarios.persona_id  0 no nulos
--
-- (10 tablas: cliente_bloqueos, firmas_cumplimiento y listas_coincidencias
-- están vacías.) Verificado después por MCP: no quedó ningún objeto, fn_bitacora
-- seguía siendo la original y no hubo asientos de bitácora.
--
-- EXPAND: solo crea. Ninguna fila existente cambia. Lo único que se toca de una
-- tabla existente es una columna nueva y vacía (beneficiarios.persona_id) y el
-- texto de fn_bitacora. Los lectores (ficha, IPS, EBR, R03…) siguen leyendo
-- codigo_cliente; se cambian en bloques posteriores, uno por uno.
--
-- QUÉ HACE
--
-- 1. personas: una fila por persona. Sin datos personales propios en el expand:
--    APUNTA, por código, a dónde viven sus datos hoy. Un puntero por registro
--    porque un mismo código puede mezclar personas (CSPMU3071: ficha de una,
--    KYC y PEP de otra; CSPFU2162: ficha de una, IPS contestado por otra):
--      codigo_ficha (clientes) · codigo_kyc (kyc_detalle) · codigo_pep
--      (pep_listas) · codigo_ips (perfil_riesgo) · codigo_ebr (ebr_evaluaciones,
--      la más reciente de ese código).
--    Todos nullable (la titular de CSPMU1062 nace con todo en NULL) y UNIQUE (un
--    registro es de una sola persona). codigo_reporte: el código individual que
--    la identifica; nullable, UNIQUE.
-- 2. cuentas_ibkr: una fila por cuenta. AQUÍ vive el UNIQUE de cuenta_ibkr; el
--    de clientes (clientes_cuenta_ibkr_key) sigue hasta el contract.
-- 3. cuenta_titulares: persona ↔ cuenta con rol (titular | cotitular); a lo
--    más un titular por cuenta.
-- 4. beneficiarios.persona_id: el beneficiario que es una persona del
--    expediente (B2 de CSPFU2963). Nullable, vacía.
-- 5. Espejo + trigger BEFORE UPDATE OR DELETE de las tres tablas nuevas,
--    trg_bitacora en las tres, RLS solo SELECT, sin escritura para la app.
-- 6. fn_bitacora: el identificador legible pasa de
--      coalesce(codigo_cliente, id)
--    a
--      coalesce(codigo_cliente, codigo_reporte, codigo_ficha, cuenta_ibkr, id)
--    para que personas y cuenta_titulares se registren por código o cuenta, no
--    por uuid. PARIDAD: para toda tabla que ya tiene trg_bitacora el resultado
--    es idéntico (ninguna tiene esas tres columnas sin codigo_cliente); el
--    paso 8 lo verifica sobre TODAS las filas existentes. Además gana
--    `set search_path = public`: era la única función SECURITY DEFINER sin él.
--
-- FK: todas DEFERRABLE INITIALLY IMMEDIATE, sin CASCADE (README de renombres).
-- Las columnas codigo_* de personas y codigo_cliente de cuentas_ibkr entran a la
-- lista de renombre.
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
  if to_regclass('public.personas') is not null or to_regclass('public.cuentas_ibkr') is not null
     or to_regclass('public.cuenta_titulares') is not null
     or to_regclass('public.personas_historico') is not null
     or to_regclass('public.cuentas_ibkr_historico') is not null
     or to_regclass('public.cuenta_titulares_historico') is not null then
    raise exception 'guarda: alguna tabla del bloque 1 ya existe; el script no es re-ejecutable.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'beneficiarios' and column_name = 'persona_id') then
    raise exception 'guarda: beneficiarios.persona_id ya existe.';
  end if;
  select string_agg(proname, ',' order by proname) into v
    from pg_proc where pronamespace = 'public'::regnamespace and prorettype = 'trigger'::regtype;
  if v is distinct from 'fn_archivar_bloqueos,fn_archivar_documentos,fn_archivar_firmas,fn_archivar_perfil_riesgo,fn_bitacora' then
    raise exception 'guarda: las funciones de trigger no son las cinco conocidas: %', v;
  end if;
  -- Solo se reemplaza la fn_bitacora que se revisó (huella sin \r, 16-oct-2026).
  if (select md5(replace(prosrc, E'\r', '')) from pg_proc
       where proname = 'fn_bitacora' and pronamespace = 'public'::regnamespace)
     is distinct from 'a20bb7fdb25816271b9748c567de081e' then
    raise exception 'guarda: fn_bitacora no es la versión revisada; no se reemplaza.';
  end if;
  if to_regprocedure('public.fn_firmante_sesion()') is null then
    raise exception 'guarda: falta fn_firmante_sesion().';
  end if;
end $$;

-- --- 1 · personas --------------------------------------------------------------
create table public.personas (
  id              uuid        primary key default gen_random_uuid(),
  codigo_reporte  text,
  codigo_ficha    text references public.clientes (codigo_cliente) deferrable initially immediate,
  codigo_kyc      text references public.clientes (codigo_cliente) deferrable initially immediate,
  codigo_pep      text references public.clientes (codigo_cliente) deferrable initially immediate,
  codigo_ips      text references public.clientes (codigo_cliente) deferrable initially immediate,
  codigo_ebr      text references public.clientes (codigo_cliente) deferrable initially immediate,
  nota            text,
  creado_en       timestamptz not null default now(),
  creado_por      text        not null default coalesce(
                    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo'),
  constraint personas_codigo_reporte_forma check (codigo_reporte ~ '^CSP[FM]U[0-9]{4}$'),
  constraint personas_codigo_reporte_unico unique (codigo_reporte),
  constraint personas_codigo_ficha_unico   unique (codigo_ficha),
  constraint personas_codigo_kyc_unico     unique (codigo_kyc),
  constraint personas_codigo_pep_unico     unique (codigo_pep),
  constraint personas_codigo_ips_unico     unique (codigo_ips),
  constraint personas_codigo_ebr_unico     unique (codigo_ebr),
  constraint personas_nota_llena check (nota is null or btrim(nota) <> '')
);

comment on table public.personas is
  'Una fila por persona (modelo persona ↔ cuenta, bloque 1, expand). Sin datos personales propios: '
  'cada codigo_* apunta al código cuyo registro es de esta persona. Un registro es de una sola persona '
  '(UNIQUE). NULL = la persona no tiene ese registro en el expediente.';
comment on column public.personas.codigo_reporte is
  'Código individual que identifica a la persona. NULL mientras no tenga uno (decisión del 14-oct-2026).';
comment on column public.personas.codigo_ips is
  'Código cuyo perfil_riesgo es el IPS de la persona. La cuenta lo hereda por referencia, no por copia.';
comment on column public.personas.codigo_ebr is
  'Código cuya evaluación EBR más reciente es la de la persona.';

-- --- 2 · cuentas_ibkr ----------------------------------------------------------
create table public.cuentas_ibkr (
  id              uuid        primary key default gen_random_uuid(),
  cuenta_ibkr     text        not null,
  codigo_cliente  text        not null references public.clientes (codigo_cliente) deferrable initially immediate,
  tipo            text        not null,
  creado_en       timestamptz not null default now(),
  creado_por      text        not null default coalesce(
                    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo'),
  constraint cuentas_ibkr_forma          check (cuenta_ibkr ~ '^U[0-9]+$'),
  constraint cuentas_ibkr_tipo_valido    check (tipo in ('individual', 'conjunta')),
  constraint cuentas_ibkr_cuenta_unica   unique (cuenta_ibkr),
  constraint cuentas_ibkr_codigo_unico   unique (codigo_cliente)
);

comment on table public.cuentas_ibkr is
  'Una fila por cuenta IBKR. Aquí vive el UNIQUE de cuenta_ibkr; clientes_cuenta_ibkr_key sigue hasta '
  'el contract. codigo_cliente = el código de contrato de la cuenta (lo reportado).';

-- --- 3 · cuenta_titulares ------------------------------------------------------
create table public.cuenta_titulares (
  id              uuid        primary key default gen_random_uuid(),
  cuenta_ibkr     text        not null references public.cuentas_ibkr (cuenta_ibkr) deferrable initially immediate,
  persona_id      uuid        not null references public.personas (id) deferrable initially immediate,
  rol             text        not null,
  creado_en       timestamptz not null default now(),
  creado_por      text        not null default coalesce(
                    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo'),
  constraint cuenta_titulares_rol_valido check (rol in ('titular', 'cotitular')),
  constraint cuenta_titulares_par_unico  unique (cuenta_ibkr, persona_id)
);
create unique index uq_cuenta_un_titular on public.cuenta_titulares (cuenta_ibkr) where rol = 'titular';
create index idx_cuenta_titulares_persona on public.cuenta_titulares (persona_id);

comment on table public.cuenta_titulares is
  'Persona ↔ cuenta con rol. A lo más un titular por cuenta. Conjunta: EBR = el más alto y IPS = el '
  'más conservador de sus titulares; si alguno falta, la vista de la cuenta devuelve NULL más el faltante.';

-- --- 4 · beneficiarios.persona_id ------------------------------------------------
alter table public.beneficiarios
  add column persona_id uuid references public.personas (id) deferrable initially immediate;
create index idx_beneficiarios_persona on public.beneficiarios (persona_id) where persona_id is not null;
comment on column public.beneficiarios.persona_id is
  'El beneficiario cuando es una persona del expediente (p. ej. B2 de CSPFU2963). NULL = no vinculado.';

-- --- 5 · Espejos ---------------------------------------------------------------
create table public.personas_historico (
  historico_id uuid primary key default gen_random_uuid(),
  version integer not null, archivado_en timestamptz not null default now(), archivado_por text not null,
  operacion text not null check (operacion in ('update', 'delete')), campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null, codigo_reporte text, codigo_ficha text, codigo_kyc text, codigo_pep text,
  codigo_ips text, codigo_ebr text, nota text, creado_en timestamptz, creado_por text,
  constraint personas_historico_version_unica unique (id, version)
);
create table public.cuentas_ibkr_historico (
  historico_id uuid primary key default gen_random_uuid(),
  version integer not null, archivado_en timestamptz not null default now(), archivado_por text not null,
  operacion text not null check (operacion in ('update', 'delete')), campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null, cuenta_ibkr text, codigo_cliente text, tipo text, creado_en timestamptz, creado_por text,
  constraint cuentas_ibkr_historico_version_unica unique (id, version)
);
create table public.cuenta_titulares_historico (
  historico_id uuid primary key default gen_random_uuid(),
  version integer not null, archivado_en timestamptz not null default now(), archivado_por text not null,
  operacion text not null check (operacion in ('update', 'delete')), campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null, cuenta_ibkr text, persona_id uuid, rol text, creado_en timestamptz, creado_por text,
  constraint cuenta_titulares_historico_version_unica unique (id, version)
);

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
    id, codigo_reporte, codigo_ficha, codigo_kyc, codigo_pep, codigo_ips, codigo_ebr, nota, creado_en, creado_por)
  values (v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.codigo_reporte, old.codigo_ficha, old.codigo_kyc, old.codigo_pep, old.codigo_ips, old.codigo_ebr,
    old.nota, old.creado_en, old.creado_por);
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end $$;

create or replace function public.fn_archivar_cuentas_ibkr()
returns trigger language plpgsql security definer set search_path = public as $$
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
    id, cuenta_ibkr, codigo_cliente, tipo, creado_en, creado_por)
  values (v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.cuenta_ibkr, old.codigo_cliente, old.tipo, old.creado_en, old.creado_por);
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end $$;

create or replace function public.fn_archivar_cuenta_titulares()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text; v_version integer; v_campos text[];
begin
  if (tg_op = 'UPDATE') and (to_jsonb(old) is not distinct from to_jsonb(new)) then return new; end if;
  v_usuario := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', 'sql_directo');
  if (tg_op = 'UPDATE') then
    select array_agg(n.key order by n.key) into v_campos
      from jsonb_each_text(to_jsonb(new)) n(key, value) where n.value is distinct from (to_jsonb(old) ->> n.key);
  end if;
  select coalesce(max(version), 0) + 1 into v_version from cuenta_titulares_historico where id = old.id;
  insert into cuenta_titulares_historico (version, archivado_por, operacion, campos_cambiados, snapshot,
    id, cuenta_ibkr, persona_id, rol, creado_en, creado_por)
  values (v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.cuenta_ibkr, old.persona_id, old.rol, old.creado_en, old.creado_por);
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end $$;

create trigger trg_archivar_personas before update or delete on public.personas
  for each row execute function public.fn_archivar_personas();
create trigger trg_archivar_cuentas_ibkr before update or delete on public.cuentas_ibkr
  for each row execute function public.fn_archivar_cuentas_ibkr();
create trigger trg_archivar_cuenta_titulares before update or delete on public.cuenta_titulares
  for each row execute function public.fn_archivar_cuenta_titulares();
create trigger trg_bitacora after insert or update or delete on public.personas
  for each row execute function public.fn_bitacora();
create trigger trg_bitacora after insert or update or delete on public.cuentas_ibkr
  for each row execute function public.fn_bitacora();
create trigger trg_bitacora after insert or update or delete on public.cuenta_titulares
  for each row execute function public.fn_bitacora();

-- --- 6 · RLS y permisos --------------------------------------------------------
alter table public.personas                   enable row level security;
alter table public.cuentas_ibkr               enable row level security;
alter table public.cuenta_titulares           enable row level security;
alter table public.personas_historico         enable row level security;
alter table public.cuentas_ibkr_historico     enable row level security;
alter table public.cuenta_titulares_historico enable row level security;

create policy personas_select_auth                   on public.personas                   for select to authenticated using (true);
create policy cuentas_ibkr_select_auth               on public.cuentas_ibkr               for select to authenticated using (true);
create policy cuenta_titulares_select_auth           on public.cuenta_titulares           for select to authenticated using (true);
create policy personas_historico_select_auth         on public.personas_historico         for select to authenticated using (true);
create policy cuentas_ibkr_historico_select_auth     on public.cuentas_ibkr_historico     for select to authenticated using (true);
create policy cuenta_titulares_historico_select_auth on public.cuenta_titulares_historico for select to authenticated using (true);

revoke all on public.personas, public.cuentas_ibkr, public.cuenta_titulares,
              public.personas_historico, public.cuentas_ibkr_historico, public.cuenta_titulares_historico
  from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.personas, public.cuentas_ibkr, public.cuenta_titulares,
     public.personas_historico, public.cuentas_ibkr_historico, public.cuenta_titulares_historico
  from authenticated;
grant select on public.personas, public.cuentas_ibkr, public.cuenta_titulares,
                public.personas_historico, public.cuentas_ibkr_historico, public.cuenta_titulares_historico
  to authenticated;

revoke execute on function public.fn_archivar_personas(), public.fn_archivar_cuentas_ibkr(),
                           public.fn_archivar_cuenta_titulares()
  from public, anon, authenticated;

-- --- 7 · fn_bitacora: identificador por código o cuenta -------------------------
-- Para que el paso 8 compare: el identificador que la versión ANTERIOR daría a
-- cada fila existente, calculado con su misma expresión.
create temporary table _paridad_antes on commit drop as
select t.tgrelid::regclass::text as tabla, null::text as id_fila, null::text as entidad_id
  from pg_trigger t where false;
do $$
declare r record;
begin
  for r in select distinct t.tgrelid::regclass as tabla from pg_trigger t join pg_proc p on p.oid = t.tgfoid
            where p.proname = 'fn_bitacora' and not t.tgisinternal
              and t.tgrelid not in ('public.personas'::regclass, 'public.cuentas_ibkr'::regclass,
                                    'public.cuenta_titulares'::regclass) loop
    execute format(
      'insert into _paridad_antes select %L, to_jsonb(x) ->> ''id'',
              coalesce(to_jsonb(x) ->> ''codigo_cliente'', to_jsonb(x) ->> ''id'') from %s x',
      r.tabla::text, r.tabla);
  end loop;
end $$;

create or replace function public.fn_bitacora()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id      text;
  v_campo   text;
  v_ant     text;
  v_nue     text;
  v_usuario text;
begin
  -- El identificador legible: el código del cliente si la fila lo tiene; si no,
  -- el de la persona (codigo_reporte, luego codigo_ficha) o la cuenta; si no,
  -- el id. Para las tablas que ya existían el resultado no cambia: ninguna tiene
  -- esas columnas sin codigo_cliente (bloque 1 de persona ↔ cuenta, 16-oct-2026).
  v_id := coalesce(
    to_jsonb(coalesce(new, old)) ->> 'codigo_cliente',
    to_jsonb(coalesce(new, old)) ->> 'codigo_reporte',
    to_jsonb(coalesce(new, old)) ->> 'codigo_ficha',
    to_jsonb(coalesce(new, old)) ->> 'cuenta_ibkr',
    to_jsonb(coalesce(new, old)) ->> 'id'
  );

  -- Quién: el usuario de la sesión de Supabase, o sql_directo si no hay
  v_usuario := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    'sql_directo'
  );

  if (tg_op = 'INSERT') then
    insert into bitacora (entidad, entidad_id, accion, usuario, origen, metadata)
    values (tg_table_name, v_id, 'insert', v_usuario, 'trigger', to_jsonb(new));
    return new;

  elsif (tg_op = 'DELETE') then
    insert into bitacora (entidad, entidad_id, accion, usuario, origen, metadata)
    values (tg_table_name, v_id, 'delete', v_usuario, 'trigger', to_jsonb(old));
    return old;

  elsif (tg_op = 'UPDATE') then
    -- Una fila de bitácora por cada campo que efectivamente cambió
    for v_campo in
      select key from jsonb_each_text(to_jsonb(new))
      where key not in ('updated_at','created_at')
    loop
      v_ant := to_jsonb(old) ->> v_campo;
      v_nue := to_jsonb(new) ->> v_campo;
      if v_ant is distinct from v_nue then
        insert into bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, usuario, origen)
        values (tg_table_name, v_id, 'update', v_campo, v_ant, v_nue, v_usuario, 'trigger');
      end if;
    end loop;
    return new;
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_bitacora() from public, anon, authenticated;

-- --- 8 · Verificación dentro de la transacción ---------------------------------
do $$
declare r record; v_diff bigint := 0; v_n bigint;
begin
  -- Paridad de fn_bitacora: la expresión NUEVA sobre todas las filas existentes
  -- de las tablas que ya tenían trg_bitacora da exactamente lo mismo que la vieja.
  for r in select distinct tabla from _paridad_antes loop
    execute format(
      'select count(*) from _paridad_antes a join %s x on to_jsonb(x) ->> ''id'' = a.id_fila
        where a.tabla = %L and a.entidad_id is distinct from coalesce(
          to_jsonb(x) ->> ''codigo_cliente'', to_jsonb(x) ->> ''codigo_reporte'',
          to_jsonb(x) ->> ''codigo_ficha'', to_jsonb(x) ->> ''cuenta_ibkr'', to_jsonb(x) ->> ''id'')',
      r.tabla, r.tabla) into v_n;
    v_diff := v_diff + v_n;
  end loop;
  if v_diff <> 0 then
    raise exception 'verificación: la paridad de fn_bitacora falla en % filas.', v_diff;
  end if;
  if (select count(*) from _paridad_antes) = 0 then
    raise exception 'verificación: la paridad no comparó ninguna fila.';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public'
        and tablename in ('personas', 'cuentas_ibkr', 'cuenta_titulares', 'personas_historico',
                          'cuentas_ibkr_historico', 'cuenta_titulares_historico')
        and cmd <> 'SELECT') <> 0 then
    raise exception 'verificación: hay políticas de escritura en las tablas nuevas.';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O'
        and tgrelid in ('public.personas'::regclass, 'public.cuentas_ibkr'::regclass,
                        'public.cuenta_titulares'::regclass)) <> 6 then
    raise exception 'verificación: no quedaron los 6 triggers (3 de archivo, 3 de bitácora).';
  end if;
  if exists (select 1 from unnest(array['public.personas', 'public.cuentas_ibkr', 'public.cuenta_titulares']) t
              where has_table_privilege('authenticated', t, 'insert')
                 or has_table_privilege('authenticated', t, 'update')
                 or has_table_privilege('authenticated', t, 'delete')
                 or has_table_privilege('authenticated', t, 'truncate')
                 or has_table_privilege('anon', t, 'select')) then
    raise exception 'verificación: privilegios de más en las tablas nuevas.';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.prorettype = 'trigger'::regtype
               and (has_function_privilege('anon', p.oid, 'execute')
                    or has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception 'verificación: alguna función de trigger es ejecutable por anon o authenticated.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'fn_bitacora' and pronamespace = 'public'::regnamespace
                   and prosecdef and proconfig = array['search_path=public']) then
    raise exception 'verificación: fn_bitacora no quedó SECURITY DEFINER con search_path=public.';
  end if;
  if (select count(*) from public.beneficiarios where persona_id is not null) <> 0 then
    raise exception 'verificación: beneficiarios.persona_id debía nacer vacía.';
  end if;
  if (select count(*) from public.personas) + (select count(*) from public.cuentas_ibkr)
     + (select count(*) from public.cuenta_titulares) <> 0 then
    raise exception 'verificación: las tablas nuevas debían nacer vacías (el backfill es el bloque 2).';
  end if;
end $$;

-- Resultado
select 'paridad fn_bitacora' as chequeo,
       (select count(*) from _paridad_antes)::text || ' filas comparadas en '
       || (select count(distinct tabla) from _paridad_antes) || ' tablas · 0 diferencias' as estado
union all
select 'tablas nuevas', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
         and relname in ('personas', 'cuentas_ibkr', 'cuenta_titulares', 'personas_historico',
                         'cuentas_ibkr_historico', 'cuenta_titulares_historico'))::text || ' de 6 · vacías'
union all
select 'triggers nuevos', (select count(*) from pg_trigger where not tgisinternal
         and tgrelid in ('public.personas'::regclass, 'public.cuentas_ibkr'::regclass,
                         'public.cuenta_titulares'::regclass))::text || ' de 6'
union all
select 'tablas con trg_bitacora', (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
         where p.proname = 'fn_bitacora' and not t.tgisinternal)::text
       || ' (antes ' || (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                          where p.proname = 'fn_bitacora' and not t.tgisinternal
                            and t.tgrelid not in ('public.personas'::regclass, 'public.cuentas_ibkr'::regclass,
                                                  'public.cuenta_titulares'::regclass)) || ')'
union all
select 'fn_bitacora', 'secdef ' || (select prosecdef from pg_proc where proname = 'fn_bitacora' and pronamespace = 'public'::regnamespace)
       || ' · ' || coalesce((select array_to_string(proconfig, ',') from pg_proc where proname = 'fn_bitacora'
                              and pronamespace = 'public'::regnamespace), 'sin config')
union all
select 'beneficiarios.persona_id', (select count(*) from public.beneficiarios where persona_id is not null)::text || ' no nulos';
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
