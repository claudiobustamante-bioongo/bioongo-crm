-- ===========================================================================
-- Bloqueo del cliente + firma de cumplimiento · BLOQUE 2 (plan aprobado 29-sep)
--
-- EJECUTADO el 5 de octubre de 2026 por Claudio Bustamante, a mano, en el SQL
-- Editor de Supabase. Este archivo es el registro de lo que se corrió: del
-- `begin` al `commit` es byte a byte el script ejecutado (B_bloqueo_firma.sql,
-- md5 d7b0492b17cd25dbeb31e106e0605fe6); solo cambió esta cabecera.
--
-- POR QUÉ
--
-- Hasta hoy, confirmar una coincidencia en una lista de sanciones (LPB, OFAC,
-- ONU) cambiaba el estado de la coincidencia, escribía las obligaciones del
-- apartado 10.10 como texto en la bitácora y devolvía un aviso que se perdía
-- al recargar. No bloqueaba al cliente ni exigía firma, para ninguna lista.
-- Suspender operaciones dependía de que alguien leyera el aviso. Era el
-- pendiente del 23-sep en /api/resolver-coincidencia.
--
-- QUÉ HIZO
--
-- 1. firmas_cumplimiento: quién firmó qué acto, con qué rol DECLARADO, con qué
--    declaración y, en un levantamiento, con qué autorización del Oficial.
--    Tres actos: confirmacion_coincidencia, descarte_coincidencia y
--    levantamiento_bloqueo.
-- 2. cliente_bloqueos: a lo más un bloqueo abierto por cliente (índice único
--    parcial); el levantamiento va completo —fecha, quién, motivo, firma— o no
--    va (CHECK).
-- 3. Espejos append-only de las dos, mismo patrón que perfil_riesgo_historico:
--    trigger BEFORE UPDATE OR DELETE, SECURITY DEFINER, RLS de solo SELECT.
--    Más trg_bitacora en las dos tablas vivas.
-- 4. fn_tipos_sanciones(): la lista que bloquea, en un solo lugar del SQL,
--    entre los marcadores TIPOS_SANCIONES:INICIO/FIN. Un test del repo
--    (lib/sanciones-sql.test.ts) lee ESTE archivo y falla si el arreglo difiere
--    de TIPOS_SANCIONES de lib/listas.ts o si aparece otra lista literal.
-- 5. fn_resolver_coincidencia y fn_levantar_bloqueo, SECURITY DEFINER: la
--    ÚNICA vía de escritura de la aplicación. Coincidencia, firma y bloqueo (o
--    firma y levantamiento) quedan todos o ninguno, en la transacción de la
--    llamada. El firmante sale del JWT dentro de la función, nunca de un
--    parámetro; sin sesión, se niegan. Errores con SQLSTATE propio para que la
--    ruta responda 4xx: BL400, BL401, BL404, BL409.
--
-- DECISIONES DE CLAUDIO, 5-oct-2026
--
-- - Sin políticas INSERT/UPDATE para la app en las tablas vivas (el diseño del
--   29-sep decía INSERT): solo escriben las dos funciones. Queda en el COMMENT
--   de las dos tablas.
-- - Levantamiento: se aceptan los dos roles. Con rol 'asesor',
--   autorizacion_oficial es obligatoria (quién autorizó, cuándo y por qué
--   medio): CHECK firmas_levantamiento_asesor_autorizado y validación en la
--   función. Con 'oficial_cumplimiento' es opcional.
-- - El rol se DECLARA y no se verifica hasta la Fase G; consta en el COMMENT.
--
-- QUÉ NO HIZO, A PROPÓSITO
--
-- - codigo_cliente SIN FK en las cuatro tablas nuevas: un renombre futuro no
--   las alcanza solo. migraciones/README.md enlista las tablas que todo
--   renombre debe tocar.
-- - Sin backfill: había 0 coincidencias en la base (guarda 0c).
-- - El sistema NO presenta el reporte de 24 horas: marca, bloquea y exige
--   firma. Quién presenta y cuándo lo deciden Claudio y el Oficial.
-- - No revocó el EXECUTE por defecto de las funciones de trigger: va aparte,
--   en D_revoke.sql (higiene, no explotable).
--
-- VERIFICADO DESPUÉS DE EJECUTAR
--
-- Antes de producción, A, B y C corrieron en la réplica desechable (PGlite,
-- Postgres 17.5) con el esquema real y datos sintéticos: guardas, permisos
-- reales como authenticated y anon, todo-o-nada con una firma que falla a
-- propósito, los dos roles de levantamiento, espejos en UPDATE y DELETE, y la
-- huella antes/después de la prueba con rollback.
--
-- En producción, en orden: A, B (Success), C1, C2a, C2b (ok), C2c.
--
--   C1: los 17 renglones esperados —4 tablas con RLS y solo política SELECT,
--   authenticated sin INSERT/UPDATE/DELETE directo, 4 triggers, índice único
--   parcial WHERE (levantado_en IS NULL), fn_tipos_sanciones() = {LPB,OFAC,ONU},
--   los 3 CHECK del Oficial, fn_levantar_bloqueo con p_autorizacion_oficial,
--   0 coincidencias, 36 clientes.
--
--   C2b (prueba con rollback sobre el primer cliente vigente):
--     ok · rollback hecho · bloqueos 0 · firmas 0 · espejos 0 · listas HUMO 0
--
--   Huella de las 19 tablas de public, antes (C2a) y después (C2c) de C2b:
--     7c9437aa5318f698b1b87d26b5588be3 = 7c9437aa5318f698b1b87d26b5588be3
--     19 tablas · secuencias en public: 0
--
-- Y después, por MCP (solo lectura), el mismo día:
--
--   chequeo                                               resultado
--   tablas nuevas con RLS (sin force)                     4            ✓
--   filas en vivas + espejos                              0            ✓
--   políticas                                             4, todas SELECT a authenticated  ✓
--   INSERT/UPDATE/DELETE de authenticated y anon          false en las 4  ✓
--   triggers                                              trg_archivar_* y trg_bitacora en las 2 vivas  ✓
--   CHECK de firmas / de bloqueos                         7 / 4, más FK a listas_coincidencias y firmas  ✓
--   fn_resolver_coincidencia, fn_levantar_bloqueo         secdef · search_path=public · anon false / auth true  ✓
--   cuerpo de fn_tipos_sanciones                          array['LPB','OFAC','ONU']  ✓
--   COMMENT "sin políticas INSERT" / autorizacion_oficial presentes  ✓
--   listas_control HUMO / bitácora de tablas nuevas       0 / 0        ✓
--   total clientes · tablas public · secuencias           36 · 19 · 0  ✓
--
-- El rol de solo lectura del MCP no puede ejecutar fn_tipos_sanciones()
-- (42501): es lo esperado, solo authenticated tiene EXECUTE. Se verificó su
-- cuerpo en pg_proc.
--
-- `revisada_por`, `firmante` y `archivado_por` dicen el correo de la sesión
-- cuando escribe la aplicación, y `sql_directo` en el espejo cuando el cambio
-- viene del SQL Editor; misma convención que los triggers.
-- ===========================================================================

begin;

-- --- 0 · Guarda de existencia -------------------------------------------------
do $$
begin
  if to_regclass('public.cliente_bloqueos') is not null
     or to_regclass('public.firmas_cumplimiento') is not null
     or to_regprocedure('public.fn_tipos_sanciones()') is not null then
    raise exception 'cliente_bloqueos, firmas_cumplimiento o fn_tipos_sanciones ya existen.';
  end if;
end $$;

-- --- 0b · Lista de sanciones: fuente única en SQL -----------------------------
-- TIPOS_SANCIONES:INICIO — el test del repo compara este arreglo con lib/listas.ts
create function public.fn_tipos_sanciones()
returns text[] language sql immutable set search_path = public as $$
  select array['LPB','OFAC','ONU']::text[]
$$;
-- TIPOS_SANCIONES:FIN

comment on function public.fn_tipos_sanciones() is
  'Tipos de lista cuya coincidencia CONFIRMADA bloquea al cliente. Espeja TIPOS_SANCIONES '
  'de lib/listas.ts; un test del repo falla si difieren.';

-- --- 0c · Guarda de sanciones ya confirmadas --------------------------------
do $$
begin
  -- Una coincidencia de sanciones ya confirmada nacería sin bloqueo. Hoy hay 0;
  -- si deja de ser así, se decide el backfill antes de correr esto.
  if exists (select 1 from listas_coincidencias c join listas_control l on l.id = c.lista_id
              where c.estado = 'confirmada' and l.tipo = any (fn_tipos_sanciones())) then
    raise exception 'Hay coincidencias de sanciones ya confirmadas: decidir backfill de bloqueos.';
  end if;
end $$;

-- --- 1 · firmas_cumplimiento --------------------------------------------------
create table public.firmas_cumplimiento (
  id              uuid        primary key default gen_random_uuid(),
  entidad         text        not null,
  entidad_id      uuid        not null,
  codigo_cliente  text        not null,
  acto            text        not null,
  firmante        text        not null,
  rol             text        not null,
  firmado_en      timestamptz not null default now(),
  declaracion     text        not null,
  autorizacion_oficial text,
  constraint firmas_entidad_valida check (entidad in ('listas_coincidencias','cliente_bloqueos')),
  constraint firmas_acto_valido    check (acto in ('confirmacion_coincidencia',
                                                   'descarte_coincidencia',
                                                   'levantamiento_bloqueo')),
  constraint firmas_acto_entidad   check (
       (acto = 'levantamiento_bloqueo') = (entidad = 'cliente_bloqueos')),
  constraint firmas_rol_valido     check (rol in ('asesor','oficial_cumplimiento')),
  constraint firmas_firmante_lleno check (btrim(firmante) <> ''),
  constraint firmas_declaracion_llena check (btrim(declaracion) <> ''),
  -- Solo el levantamiento lleva autorización del Oficial, y nunca vacía.
  constraint firmas_autorizacion_solo_levantamiento check (
       autorizacion_oficial is null or acto = 'levantamiento_bloqueo'),
  constraint firmas_autorizacion_llena check (
       autorizacion_oficial is null or btrim(autorizacion_oficial) <> ''),
  -- El asesor que levanta un bloqueo declara quién, cuándo y por qué medio lo
  -- autorizó el Oficial de Cumplimiento.
  constraint firmas_levantamiento_asesor_autorizado check (
       acto <> 'levantamiento_bloqueo' or rol <> 'asesor' or autorizacion_oficial is not null)
);

create index idx_firmas_entidad on public.firmas_cumplimiento (entidad, entidad_id);
create index idx_firmas_cliente on public.firmas_cumplimiento (codigo_cliente);

comment on table public.firmas_cumplimiento is
  'Firma de un acto de cumplimiento: confirmar o descartar una coincidencia contra '
  'lista de control, o levantar un bloqueo. La aplicación NO tiene políticas INSERT, '
  'UPDATE ni DELETE sobre esta tabla (decisión del 5-oct-2026): solo escriben las '
  'funciones SECURITY DEFINER fn_resolver_coincidencia y fn_levantar_bloqueo, que toman '
  'el firmante de la sesión. codigo_cliente SIN FK: un renombre no la alcanza sola (ver '
  'migraciones/README.md).';
comment on column public.firmas_cumplimiento.firmante is
  'Usuario de la sesión (email del JWT, o sub si no hay email), tomado DENTRO de la '
  'función. Nunca un parámetro ni una constante.';
comment on column public.firmas_cumplimiento.rol is
  'Rol DECLARADO por quien firma. NO SE VERIFICA contra ningún registro de roles '
  'hasta la Fase G: hoy cualquier sesión puede declararse oficial_cumplimiento.';
comment on column public.firmas_cumplimiento.autorizacion_oficial is
  'Solo en levantamiento_bloqueo. OBLIGATORIA si rol = asesor: quién autorizó, cuándo y '
  'por qué medio (levantar un bloqueo por sanciones es decisión del Oficial de '
  'Cumplimiento). Opcional si rol = oficial_cumplimiento. Es texto declarado, no '
  'verificado, igual que el rol.';
comment on column public.firmas_cumplimiento.entidad_id is
  'id de la coincidencia (confirmación/descarte) o del bloqueo (levantamiento). Sin FK '
  'polimórfica: la integridad la da la función que escribe.';

-- --- 2 · cliente_bloqueos -----------------------------------------------------
create table public.cliente_bloqueos (
  id                    uuid        primary key default gen_random_uuid(),
  codigo_cliente        text        not null,
  coincidencia_id       uuid        not null references public.listas_coincidencias(id),
  motivo                text        not null,
  bloqueado_en          timestamptz not null default now(),
  bloqueado_por         text        not null,
  levantado_en          timestamptz,
  levantado_por         text,
  motivo_levantamiento  text,
  firma_id              uuid        references public.firmas_cumplimiento(id),
  constraint bloqueos_motivo_lleno check (btrim(motivo) <> ''),
  constraint bloqueos_levantamiento_completo check (
       (levantado_en is null) = (levantado_por is null)
   and (levantado_en is null) = (motivo_levantamiento is null)
   and (levantado_en is null) = (firma_id is null)),
  constraint bloqueos_levantamiento_lleno check (
       motivo_levantamiento is null or btrim(motivo_levantamiento) <> ''),
  constraint bloqueos_levantamiento_posterior check (
       levantado_en is null or levantado_en >= bloqueado_en)
);

create unique index uq_bloqueo_abierto_por_cliente
  on public.cliente_bloqueos (codigo_cliente) where levantado_en is null;
create index idx_bloqueos_coincidencia on public.cliente_bloqueos (coincidencia_id);

comment on table public.cliente_bloqueos is
  'Bloqueo de un cliente por coincidencia CONFIRMADA en lista de sanciones (LPB, OFAC, '
  'ONU). A lo más uno abierto por cliente. Mientras esté abierto, el IPS y el portafolio '
  'no se generan; el EBR sí corre. La aplicación NO tiene políticas INSERT, UPDATE ni '
  'DELETE sobre esta tabla (decisión del 5-oct-2026): solo escriben las funciones '
  'SECURITY DEFINER fn_resolver_coincidencia y fn_levantar_bloqueo. El sistema NO '
  'presenta el reporte de 24 horas. codigo_cliente '
  'SIN FK: un renombre no la alcanza sola (ver migraciones/README.md).';
comment on column public.cliente_bloqueos.firma_id is
  'Firma del LEVANTAMIENTO (acto levantamiento_bloqueo). La firma de la confirmación que '
  'abrió el bloqueo se lee por firmas_cumplimiento.entidad_id = coincidencia_id.';

-- --- 3 · Espejos append-only --------------------------------------------------
create table public.firmas_cumplimiento_historico (
  historico_id     uuid        primary key default gen_random_uuid(),
  version          integer     not null,
  archivado_en     timestamptz not null default now(),
  archivado_por    text        not null,
  operacion        text        not null check (operacion in ('update','delete')),
  campos_cambiados text[],
  snapshot         jsonb       not null,
  id               uuid        not null,
  entidad          text,
  entidad_id       uuid,
  codigo_cliente   text,
  acto             text,
  firmante         text,
  rol              text,
  firmado_en       timestamptz,
  declaracion      text,
  autorizacion_oficial text,
  constraint firmas_historico_version_unica unique (id, version)
);

create table public.cliente_bloqueos_historico (
  historico_id          uuid        primary key default gen_random_uuid(),
  version               integer     not null,
  archivado_en          timestamptz not null default now(),
  archivado_por         text        not null,
  operacion             text        not null check (operacion in ('update','delete')),
  campos_cambiados      text[],
  snapshot              jsonb       not null,
  id                    uuid        not null,
  codigo_cliente        text,
  coincidencia_id       uuid,
  motivo                text,
  bloqueado_en          timestamptz,
  bloqueado_por         text,
  levantado_en          timestamptz,
  levantado_por         text,
  motivo_levantamiento  text,
  firma_id              uuid,
  constraint bloqueos_historico_version_unica unique (id, version)
);

comment on table public.firmas_cumplimiento_historico is
  'Espejo append-only de firmas_cumplimiento. Solo escribe trg_archivar_firmas. Cada fila '
  'es el estado ANTERIOR a un UPDATE o DELETE. Versión por id de firma. Sin FK.';
comment on table public.cliente_bloqueos_historico is
  'Espejo append-only de cliente_bloqueos. Solo escribe trg_archivar_bloqueos. Cada fila '
  'es el estado ANTERIOR a un UPDATE o DELETE (el levantamiento archiva el bloqueo '
  'abierto). Versión por id de bloqueo. Sin FK.';

create or replace function public.fn_archivar_firmas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text; v_version integer; v_campos text[];
begin
  if (tg_op = 'UPDATE') and (to_jsonb(old) is not distinct from to_jsonb(new)) then
    return new;
  end if;
  v_usuario := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
                        'sql_directo');
  if (tg_op = 'UPDATE') then
    select array_agg(n.key order by n.key) into v_campos
      from jsonb_each_text(to_jsonb(new)) n(key, value)
     where n.value is distinct from (to_jsonb(old) ->> n.key);
  end if;
  select coalesce(max(version), 0) + 1 into v_version
    from firmas_cumplimiento_historico where id = old.id;
  insert into firmas_cumplimiento_historico (
    version, archivado_por, operacion, campos_cambiados, snapshot,
    id, entidad, entidad_id, codigo_cliente, acto, firmante, rol, firmado_en, declaracion,
    autorizacion_oficial)
  values (
    v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.entidad, old.entidad_id, old.codigo_cliente, old.acto, old.firmante,
    old.rol, old.firmado_en, old.declaracion, old.autorizacion_oficial);
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end $$;

create or replace function public.fn_archivar_bloqueos()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_usuario text; v_version integer; v_campos text[];
begin
  if (tg_op = 'UPDATE') and (to_jsonb(old) is not distinct from to_jsonb(new)) then
    return new;
  end if;
  v_usuario := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
                        'sql_directo');
  if (tg_op = 'UPDATE') then
    select array_agg(n.key order by n.key) into v_campos
      from jsonb_each_text(to_jsonb(new)) n(key, value)
     where n.value is distinct from (to_jsonb(old) ->> n.key);
  end if;
  select coalesce(max(version), 0) + 1 into v_version
    from cliente_bloqueos_historico where id = old.id;
  insert into cliente_bloqueos_historico (
    version, archivado_por, operacion, campos_cambiados, snapshot,
    id, codigo_cliente, coincidencia_id, motivo, bloqueado_en, bloqueado_por,
    levantado_en, levantado_por, motivo_levantamiento, firma_id)
  values (
    v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.codigo_cliente, old.coincidencia_id, old.motivo, old.bloqueado_en,
    old.bloqueado_por, old.levantado_en, old.levantado_por, old.motivo_levantamiento,
    old.firma_id);
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end $$;

-- BEFORE: si el archivado falla, el cambio no ocurre. AFTER: la bitácora.
create trigger trg_archivar_firmas
  before update or delete on public.firmas_cumplimiento
  for each row execute function public.fn_archivar_firmas();
create trigger trg_archivar_bloqueos
  before update or delete on public.cliente_bloqueos
  for each row execute function public.fn_archivar_bloqueos();
create trigger trg_bitacora
  after insert or update or delete on public.firmas_cumplimiento
  for each row execute function public.fn_bitacora();
create trigger trg_bitacora
  after insert or update or delete on public.cliente_bloqueos
  for each row execute function public.fn_bitacora();

-- --- 4 · RLS: se lee; se escribe solo por las funciones -----------------------
-- Sin `force row level security` en ninguna: forzarla sometería al dueño y las
-- funciones SECURITY DEFINER dejarían de poder escribir.
alter table public.firmas_cumplimiento           enable row level security;
alter table public.cliente_bloqueos              enable row level security;
alter table public.firmas_cumplimiento_historico enable row level security;
alter table public.cliente_bloqueos_historico    enable row level security;

create policy firmas_select_auth           on public.firmas_cumplimiento           for select to authenticated using (true);
create policy bloqueos_select_auth         on public.cliente_bloqueos              for select to authenticated using (true);
create policy firmas_historico_select_auth on public.firmas_cumplimiento_historico for select to authenticated using (true);
create policy bloqueos_historico_select_auth on public.cliente_bloqueos_historico  for select to authenticated using (true);

grant select on public.firmas_cumplimiento, public.cliente_bloqueos,
                public.firmas_cumplimiento_historico, public.cliente_bloqueos_historico
  to authenticated;
revoke insert, update, delete on public.firmas_cumplimiento, public.cliente_bloqueos,
                public.firmas_cumplimiento_historico, public.cliente_bloqueos_historico
  from anon, authenticated;

-- --- 5 · Funciones de escritura -----------------------------------------------
create or replace function public.fn_firmante_sesion()
returns text language sql stable set search_path = public as $$
  select nullif(btrim(coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')
$$;

create or replace function public.fn_resolver_coincidencia(
  p_coincidencia_id uuid,
  p_estado          text,
  p_motivo          text,
  p_rol             text,
  p_declaracion     text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_firmante text := fn_firmante_sesion();
  v_c        listas_coincidencias%rowtype;
  v_tipo     text;
  v_firma_id uuid;
  v_bloqueo  uuid;
  v_nuevo    boolean := false;
begin
  if v_firmante is null then
    raise exception 'Sin sesión: la firma exige un usuario autenticado.' using errcode = 'BL401';
  end if;
  if p_estado is null or p_estado not in ('confirmada','descartada') then
    raise exception 'estado debe ser confirmada o descartada.' using errcode = 'BL400';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Falta motivo.' using errcode = 'BL400';
  end if;
  if p_rol is null or p_rol not in ('asesor','oficial_cumplimiento') then
    raise exception 'rol debe ser asesor u oficial_cumplimiento.' using errcode = 'BL400';
  end if;
  if p_declaracion is null or btrim(p_declaracion) = '' then
    raise exception 'Falta la declaración de la firma.' using errcode = 'BL400';
  end if;

  select c.* into v_c from listas_coincidencias c where c.id = p_coincidencia_id for update;
  if not found then
    raise exception 'La coincidencia no existe.' using errcode = 'BL404';
  end if;
  if v_c.estado <> 'pendiente' then
    raise exception 'La coincidencia ya está %.', v_c.estado using errcode = 'BL409';
  end if;
  select l.tipo into v_tipo from listas_control l where l.id = v_c.lista_id;

  update listas_coincidencias
     set estado = p_estado, revisada_por = v_firmante,
         fecha_revision = now(), motivo_resolucion = btrim(p_motivo)
   where id = v_c.id;

  insert into firmas_cumplimiento (entidad, entidad_id, codigo_cliente, acto, firmante, rol, declaracion)
  values ('listas_coincidencias', v_c.id, v_c.codigo_cliente,
          case p_estado when 'confirmada' then 'confirmacion_coincidencia'
                        else 'descarte_coincidencia' end,
          v_firmante, p_rol, btrim(p_declaracion))
  returning id into v_firma_id;

  if p_estado = 'confirmada' and v_tipo = any (fn_tipos_sanciones()) then
    insert into cliente_bloqueos (codigo_cliente, coincidencia_id, motivo, bloqueado_por)
    values (v_c.codigo_cliente, v_c.id,
            'Coincidencia confirmada en lista ' || v_tipo || '. ' || btrim(p_motivo),
            v_firmante)
    on conflict (codigo_cliente) where levantado_en is null do nothing
    returning id into v_bloqueo;
    v_nuevo := v_bloqueo is not null;
    if not v_nuevo then
      -- Ya había uno abierto (otra coincidencia confirmada): no se abre otro.
      select id into v_bloqueo from cliente_bloqueos
       where codigo_cliente = v_c.codigo_cliente and levantado_en is null;
    end if;
  end if;

  return jsonb_build_object(
    'coincidencia_id', v_c.id,
    'codigo_cliente',  v_c.codigo_cliente,
    'estado',          p_estado,
    'tipo_lista',      v_tipo,
    'revisada_por',    v_firmante,
    'firma_id',        v_firma_id,
    'bloqueo_id',      v_bloqueo,
    'bloqueo_nuevo',   v_nuevo);
end $$;

create or replace function public.fn_levantar_bloqueo(
  p_bloqueo_id           uuid,
  p_motivo               text,
  p_rol                  text,
  p_declaracion          text,
  p_autorizacion_oficial text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_firmante text := fn_firmante_sesion();
  v_b        cliente_bloqueos%rowtype;
  v_firma_id uuid;
  v_autoriza text := nullif(btrim(p_autorizacion_oficial), '');
begin
  if v_firmante is null then
    raise exception 'Sin sesión: la firma exige un usuario autenticado.' using errcode = 'BL401';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Falta el motivo del levantamiento.' using errcode = 'BL400';
  end if;
  if p_rol is null or p_rol not in ('asesor','oficial_cumplimiento') then
    raise exception 'rol debe ser asesor u oficial_cumplimiento.' using errcode = 'BL400';
  end if;
  if p_declaracion is null or btrim(p_declaracion) = '' then
    raise exception 'Falta la declaración de la firma.' using errcode = 'BL400';
  end if;
  if p_rol = 'asesor' and v_autoriza is null then
    raise exception 'Levantar un bloqueo con rol asesor exige autorizacion_oficial: quién '
                    'del Oficial de Cumplimiento lo autorizó, cuándo y por qué medio.'
      using errcode = 'BL400';
  end if;

  select * into v_b from cliente_bloqueos where id = p_bloqueo_id for update;
  if not found then
    raise exception 'El bloqueo no existe.' using errcode = 'BL404';
  end if;
  if v_b.levantado_en is not null then
    raise exception 'El bloqueo ya fue levantado.' using errcode = 'BL409';
  end if;

  insert into firmas_cumplimiento (entidad, entidad_id, codigo_cliente, acto, firmante, rol,
                                   declaracion, autorizacion_oficial)
  values ('cliente_bloqueos', v_b.id, v_b.codigo_cliente, 'levantamiento_bloqueo',
          v_firmante, p_rol, btrim(p_declaracion), v_autoriza)
  returning id into v_firma_id;

  update cliente_bloqueos
     set levantado_en = now(), levantado_por = v_firmante,
         motivo_levantamiento = btrim(p_motivo), firma_id = v_firma_id
   where id = v_b.id;

  return jsonb_build_object(
    'bloqueo_id', v_b.id, 'codigo_cliente', v_b.codigo_cliente,
    'levantado_por', v_firmante, 'rol', p_rol, 'firma_id', v_firma_id,
    'autorizacion_oficial', v_autoriza);
end $$;

revoke all on function public.fn_tipos_sanciones()                                  from public, anon;
revoke all on function public.fn_firmante_sesion()                                  from public, anon;
revoke all on function public.fn_resolver_coincidencia(uuid, text, text, text, text) from public, anon;
revoke all on function public.fn_levantar_bloqueo(uuid, text, text, text, text)      from public, anon;
grant execute on function public.fn_tipos_sanciones()                                  to authenticated;
grant execute on function public.fn_firmante_sesion()                                  to authenticated;
grant execute on function public.fn_resolver_coincidencia(uuid, text, text, text, text) to authenticated;
grant execute on function public.fn_levantar_bloqueo(uuid, text, text, text, text)      to authenticated;

-- --- 6 · Verificación dentro de la transacción --------------------------------
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public'
        and tablename in ('firmas_cumplimiento','cliente_bloqueos',
                          'firmas_cumplimiento_historico','cliente_bloqueos_historico')
        and cmd <> 'SELECT') <> 0 then
    raise exception 'Hay políticas de escritura en las tablas nuevas.';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal
        and tgrelid in ('public.firmas_cumplimiento'::regclass, 'public.cliente_bloqueos'::regclass)) <> 4 then
    raise exception 'No quedaron los 4 triggers (2 de archivo, 2 de bitácora).';
  end if;
end $$;

commit;

-- --- Verificación · C1, se corrió aparte después del commit -----------------
--
-- with t(n) as (values ('firmas_cumplimiento'), ('cliente_bloqueos'),
--                      ('firmas_cumplimiento_historico'), ('cliente_bloqueos_historico'))
-- select 'tabla ' || n as chequeo,
--        case when to_regclass('public.' || n) is null then 'no existe'
--             else 'existe · filas ' ||
--                  (xpath('/table/row/c/text()',
--                     query_to_xml(format('select count(*) as c from public.%I', n), false, false, '')))[1]::text
--                  || ' · rls ' || (select relrowsecurity::text from pg_class where oid = ('public.' || n)::regclass)
--        end as valor
--   from t
-- union all
-- select 'políticas en tablas nuevas (cmd)',
--        coalesce((select string_agg(tablename || ':' || cmd, ', ' order by tablename, cmd)
--                    from pg_policies where schemaname = 'public'
--                     and tablename in (select n from t)), '—')
-- union all
-- select 'triggers en tablas nuevas',
--        coalesce((select string_agg(tgrelid::regclass || ':' || tgname, ', ' order by tgrelid::regclass::text, tgname)
--                    from pg_trigger where not tgisinternal
--                     and tgrelid::regclass::text in (select n from t)), '—')
-- union all
-- select 'índice único parcial de bloqueo abierto',
--        coalesce((select pg_get_indexdef(indexrelid::regclass) from pg_index
--                   where indexrelid = to_regclass('public.uq_bloqueo_abierto_por_cliente')), '—')
-- union all
-- select 'funciones nuevas (secdef · execute anon/auth)',
--        coalesce((select string_agg(p.proname || ' ' || p.prosecdef::text || ' · '
--                        || has_function_privilege('anon', p.oid, 'execute')::text || '/'
--                        || has_function_privilege('authenticated', p.oid, 'execute')::text, ', ' order by p.proname)
--                    from pg_proc p where p.pronamespace = 'public'::regnamespace
--                     and p.proname in ('fn_resolver_coincidencia','fn_levantar_bloqueo','fn_firmante_sesion',
--                                       'fn_archivar_firmas','fn_archivar_bloqueos','fn_tipos_sanciones')), '0')
-- union all
-- select 'fn_tipos_sanciones()  (debe ser {LPB,OFAC,ONU})',
--        coalesce((xpath('/table/row/v/text()', query_to_xml(
--           'select public.fn_tipos_sanciones()::text as v', false, false, '')))[1]::text, '—')
-- union all
-- select 'firma de fn_levantar_bloqueo',
--        coalesce((select pg_get_function_identity_arguments(p.oid) from pg_proc p
--                   where p.pronamespace = 'public'::regnamespace and p.proname = 'fn_levantar_bloqueo'), '—')
-- union all
-- select 'CHECK de autorización del Oficial en firmas',
--        coalesce((select string_agg(conname, ', ' order by conname) from pg_constraint
--                   where conrelid = to_regclass('public.firmas_cumplimiento') and contype = 'c'
--                     and conname like 'firmas_%autoriza%'), '—')
-- union all
-- select 'coincidencias pendiente/confirmada/descartada',
--        (select count(*) filter (where estado = 'pendiente') || '/' ||
--                count(*) filter (where estado = 'confirmada') || '/' ||
--                count(*) filter (where estado = 'descartada') from listas_coincidencias)
-- union all
-- select 'sanciones confirmadas sin bloqueo',
--        (select count(*) from listas_coincidencias c join listas_control l on l.id = c.lista_id
--          where c.estado = 'confirmada' and l.tipo in ('LPB','OFAC','ONU')
--            and (to_regclass('public.cliente_bloqueos') is null
--                 or not ((xpath('/table/row/e/text()', query_to_xml(format(
--                      'select exists (select 1 from public.cliente_bloqueos where coincidencia_id = %L) as e',
--                      c.id), false, false, '')))[1]::text::boolean)))::text
-- union all
-- select 'fn_bitacora', (select count(*) from pg_proc where proname = 'fn_bitacora'
--                          and pronamespace = 'public'::regnamespace)::text
-- union all
-- select 'políticas DELETE en listas_coincidencias',
--        (select count(*) from pg_policies where schemaname = 'public'
--           and tablename = 'listas_coincidencias' and cmd = 'DELETE')::text
-- union all
-- select 'escritura directa authenticated (ins/upd/del) en tablas nuevas',
--        coalesce((select string_agg(n || ' ' || has_table_privilege('authenticated', ('public.' || n)::regclass, 'insert')::text
--                        || '/' || has_table_privilege('authenticated', ('public.' || n)::regclass, 'update')::text
--                        || '/' || has_table_privilege('authenticated', ('public.' || n)::regclass, 'delete')::text, ', ')
--                    from t where to_regclass('public.' || n) is not null), '—')
-- union all
-- select 'total clientes', (select count(*) from clientes)::text;
