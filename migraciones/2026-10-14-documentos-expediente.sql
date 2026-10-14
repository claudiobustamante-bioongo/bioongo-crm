-- ===========================================================================
-- Documentos del expediente · sesión 1 · tabla, espejo, funciones y bucket
--
-- EJECUTADO el 14 de octubre de 2026 por Claudio Bustamante, a mano, en el SQL
-- Editor de Supabase. Este archivo es el registro de lo que se corrió: desde el
-- `begin` hasta el final es byte a byte el script ejecutado
-- (documentos-expediente-2026-10-14.sql, md5 caf4294d770acb14c1c2a64f98cddc66);
-- solo cambió esta cabecera.
--
-- POR QUÉ
--
-- Registrar una carta de clasificación firmada exigía SQL a mano (precedente:
-- la carta de CSPFU2963, el mismo día) y la app no tenía dónde guardar el PDF:
-- 0 buckets en Storage, y las ligas de carta_sofisticado_url apuntaban a Google
-- Drive. Este script pone la base; las rutas, la ficha y los tests son la
-- sesión 2.
--
-- QUÉ HIZO
--
-- 1. documentos_expediente: un renglón por PDF. Append-only (authenticated solo
--    SELECT; sin INSERT, UPDATE, DELETE ni TRUNCATE). codigo_cliente sin FK,
--    como firmas_cumplimiento. CHECK de tipo (carta_clasificacion,
--    identificacion, comprobante_domicilio, constancia_fiscal, contrato), forma
--    del código, fecha obligatoria para la carta, sha256, tamaño (1 B a 4 MB),
--    solo PDF y la ruta armada solo con datos del sistema:
--    tipo/codigo/AAAA-MM-DD_sha256[0:12].pdf (o sin-fecha). UNIQUE por ruta y por
--    (codigo, tipo, sha256); cada documento se reemplaza a lo más una vez.
-- 2. documentos_expediente_historico + fn_archivar_documentos (BEFORE UPDATE OR
--    DELETE) y trg_bitacora en la tabla nueva (fn_bitacora: 12 -> 13 tablas).
-- 3. fn_registrar_documento (SECURITY DEFINER): archiva el documento y, si es
--    la carta, mueve la clasificación en la misma transacción. Modos: nueva
--    (-> 203, carta_firmada, carta_sofisticado_firmada, liga interna), adjuntar
--    (ya era 203 por carta sin PDF: solo la liga) y reemplazo (solo la liga).
--    No cambia el status. Errores DX400/401/404/409.
-- 4. fn_registrar_consulta_documento (SECURITY DEFINER): asiento
--    consulta_documento con el usuario de la sesión antes de emitir el enlace
--    firmado. Todo acceso a un documento queda trazado (decisión de Claudio).
-- 5. Bucket `expediente`: privado, 4194304 bytes, solo application/pdf, SIN
--    políticas en storage.objects. Solo el servidor, con la llave secreta
--    (SUPABASE_SERVICE_ROLE_KEY, tipo sb_secret_), sube y firma enlaces.
--
-- QUÉ NO HIZO
--
-- No subió ningún objeto ni registró documentos. No cambió la llave anónima de
-- la app (legacy; pendiente de migrar a publishable en la Fase G). No retiró
-- TRUNCATE de authenticated en las tablas del 5-oct (la RLS no lo detiene; la
-- API no lo expone): solo las tablas nuevas nacen sin él.
--
-- RENOMBRES: documentos_expediente NO se renombra (el CHECK de la ruta lo
-- impide); conserva el código con el que se archivó. Ver migraciones/README.md.
--
-- ROLLBACK: el bucket no se borra por SQL (storage.protect_delete); se borra
-- vacío desde el dashboard. Tablas y funciones, con DROP.
--
-- VERIFICADO DESPUÉS DE EJECUTAR
--
-- Antes de producción, en una réplica PGlite 0.3.7 (Postgres 17.5) con las
-- columnas, CHECK, RLS, privilegios por defecto, fn_bitacora y fn_firmante_sesion
-- reales y datos sintéticos: 62/62. Entre ellas: rollback sin rastro
-- (fingerprint idéntico), re-ejecución detenida en la guarda, cada error DX,
-- carta nueva con 4 MB exactos (8 asientos, todos con el usuario de la sesión),
-- adjuntar, reemplazo, 202 por determinación -> 203 por carta, baja (carta 409,
-- identificación sí), escritura directa rechazada (42501) y el espejo ante un
-- UPDATE y un DELETE desde el SQL Editor. Las 9 guardas, probadas antes por MCP
-- contra producción.
--
-- En producción, la consulta final (sección 7) tal como la devolvió el editor:
--
--   documentos_expediente            0 filas · triggers 2 · políticas SELECT
--   documentos_expediente_historico  0 filas
--   fn_registrar_documento           anon false · authenticated true
--   fn_registrar_consulta_documento  anon false · authenticated true
--   bucket expediente                public false · límite 4194304 · mime application/pdf
--   políticas storage.objects        0
--
-- Y después, por MCP (solo lectura), el mismo día: las 13 restricciones y 5
-- índices esperados; los 2 triggers activos; RLS en las dos tablas con una sola
-- política SELECT para authenticated; ACL {authenticated=rm} (anon sin nada);
-- las 3 funciones SECURITY DEFINER con search_path=public; 0 funciones de
-- trigger ejecutables por anon o authenticated; 1 bucket, 0 objetos, 0 políticas
-- en storage; 0 asientos de documentos.
-- ===========================================================================

begin;

-- --- 0 · Guardas ---------------------------------------------------------------
do $$
declare v text;
begin
  if to_regclass('public.documentos_expediente') is not null
     or to_regclass('public.documentos_expediente_historico') is not null then
    raise exception 'guarda: las tablas de documentos ya existen; el script no es re-ejecutable.';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('fn_registrar_documento', 'fn_registrar_consulta_documento',
                               'fn_archivar_documentos')) then
    raise exception 'guarda: alguna función de documentos ya existe.';
  end if;
  if exists (select 1 from storage.buckets where id = 'expediente') then
    raise exception 'guarda: el bucket expediente ya existe.';
  end if;
  if (select count(*) from storage.buckets) <> 0 then
    raise exception 'guarda: se esperaban 0 buckets.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects') <> 0 then
    raise exception 'guarda: storage.objects ya tiene políticas; revisar antes de seguir.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'guarda: storage.objects sin RLS.';
  end if;
  select string_agg(proname, ',' order by proname) into v
    from pg_proc where pronamespace = 'public'::regnamespace and prorettype = 'trigger'::regtype;
  if v is distinct from 'fn_archivar_bloqueos,fn_archivar_firmas,fn_archivar_perfil_riesgo,fn_bitacora' then
    raise exception 'guarda: las funciones de trigger no son las cuatro conocidas: %', v;
  end if;
  if to_regprocedure('public.fn_firmante_sesion()') is null then
    raise exception 'guarda: falta fn_firmante_sesion().';
  end if;
end $$;

-- --- 1 · documentos_expediente -------------------------------------------------
create table public.documentos_expediente (
  id              uuid        primary key default gen_random_uuid(),
  codigo_cliente  text        not null,
  tipo            text        not null,
  ruta_storage    text        not null,
  fecha_documento date,
  sha256          text        not null,
  tamano_bytes    integer     not null,
  mime            text        not null default 'application/pdf',
  reemplaza_a     uuid        references public.documentos_expediente (id),
  subido_por      text        not null,
  created_at      timestamptz not null default now(),
  constraint documentos_tipo_valido check (tipo in ('carta_clasificacion', 'identificacion',
                                                    'comprobante_domicilio', 'constancia_fiscal',
                                                    'contrato')),
  constraint documentos_codigo_forma   check (codigo_cliente ~ '^CSP[FM]U[0-9]{4}$'),
  constraint documentos_carta_con_fecha check (tipo <> 'carta_clasificacion' or fecha_documento is not null),
  constraint documentos_sha256_forma   check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint documentos_tamano         check (tamano_bytes between 1 and 4194304),
  constraint documentos_mime_pdf       check (mime = 'application/pdf'),
  constraint documentos_subido_por_lleno check (btrim(subido_por) <> ''),
  constraint documentos_no_se_reemplaza_a_si check (reemplaza_a is distinct from id),
  -- La ruta sale SOLO de datos del sistema: tipo/codigo/fecha_hash12.pdf. Ningún
  -- nombre de persona ni nombre original del archivo puede entrar ahí.
  constraint documentos_ruta_forma check (
        ruta_storage ~ '^[a-z_]+/CSP[FM]U[0-9]{4}/([0-9]{4}-[0-9]{2}-[0-9]{2}|sin-fecha)_[0-9a-f]{12}\.pdf$'
    and split_part(ruta_storage, '/', 1) = tipo
    and split_part(ruta_storage, '/', 2) = codigo_cliente
    and substring(ruta_storage from '_([0-9a-f]{12})\.pdf$') = left(sha256, 12)
    and (fecha_documento is null) = (position('/sin-fecha_' in ruta_storage) > 0)),
  constraint documentos_ruta_unica    unique (ruta_storage),
  constraint documentos_archivo_unico unique (codigo_cliente, tipo, sha256)
);

create index idx_documentos_cliente_tipo on public.documentos_expediente (codigo_cliente, tipo, created_at desc);
create unique index uq_documentos_reemplazo_unico on public.documentos_expediente (reemplaza_a)
  where reemplaza_a is not null;

comment on table public.documentos_expediente is
  'PDF archivados del expediente (bucket privado `expediente`). Append-only: solo escribe '
  'fn_registrar_documento. codigo_cliente sin FK a propósito (evidencia, como firmas_cumplimiento): '
  'se renombra a mano. Un PDF equivocado no se borra: se archiva el bueno con reemplaza_a.';
comment on column public.documentos_expediente.ruta_storage is
  'Llave del objeto en el bucket expediente: tipo/codigo/AAAA-MM-DD_sha256[0:12].pdf (o sin-fecha). '
  'Nunca se renombra: el vínculo vigente vive en esta tabla y la integridad la da sha256.';
comment on column public.documentos_expediente.fecha_documento is
  'Fecha que consta en el documento; para la carta, la fecha de firma (obligatoria). '
  'NULL = no consta.';
comment on column public.documentos_expediente.sha256 is
  'sha256 del PDF calculado por el servidor al recibirlo.';
comment on column public.documentos_expediente.reemplaza_a is
  'Documento al que corrige. Cada documento se reemplaza a lo más una vez.';
comment on column public.documentos_expediente.subido_por is
  'Usuario de la sesión (fn_firmante_sesion), nunca un dato que mande el navegador.';

-- --- 2 · Espejo append-only ------------------------------------------------------
create table public.documentos_expediente_historico (
  historico_id     uuid        primary key default gen_random_uuid(),
  version          integer     not null,
  archivado_en     timestamptz not null default now(),
  archivado_por    text        not null,
  operacion        text        not null check (operacion in ('update', 'delete')),
  campos_cambiados text[],
  snapshot         jsonb       not null,
  id               uuid        not null,
  codigo_cliente   text,
  tipo             text,
  ruta_storage     text,
  fecha_documento  date,
  sha256           text,
  tamano_bytes     integer,
  mime             text,
  reemplaza_a      uuid,
  subido_por       text,
  created_at       timestamptz,
  constraint documentos_historico_version_unica unique (id, version)
);

comment on table public.documentos_expediente_historico is
  'Espejo de documentos_expediente: la versión anterior de toda fila tocada por UPDATE o DELETE '
  '(solo posible desde el SQL Editor). Lo llena fn_archivar_documentos.';

create or replace function public.fn_archivar_documentos()
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
    from documentos_expediente_historico where id = old.id;
  insert into documentos_expediente_historico (
    version, archivado_por, operacion, campos_cambiados, snapshot,
    id, codigo_cliente, tipo, ruta_storage, fecha_documento, sha256, tamano_bytes, mime,
    reemplaza_a, subido_por, created_at)
  values (
    v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.codigo_cliente, old.tipo, old.ruta_storage, old.fecha_documento, old.sha256,
    old.tamano_bytes, old.mime, old.reemplaza_a, old.subido_por, old.created_at);
  if (tg_op = 'DELETE') then return old; end if;
  return new;
end $$;

create trigger trg_archivar_documentos before update or delete on public.documentos_expediente
  for each row execute function public.fn_archivar_documentos();
create trigger trg_bitacora after insert or update or delete on public.documentos_expediente
  for each row execute function public.fn_bitacora();

-- --- 3 · RLS y permisos --------------------------------------------------------
alter table public.documentos_expediente           enable row level security;
alter table public.documentos_expediente_historico enable row level security;

create policy documentos_select_auth           on public.documentos_expediente           for select to authenticated using (true);
create policy documentos_historico_select_auth on public.documentos_expediente_historico for select to authenticated using (true);

-- Más estricto que el precedente del 5-oct: anon no conserva nada, y TRUNCATE
-- (que la RLS no detiene) también se retira a authenticated.
revoke all on public.documentos_expediente, public.documentos_expediente_historico from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.documentos_expediente, public.documentos_expediente_historico from authenticated;
grant select on public.documentos_expediente, public.documentos_expediente_historico to authenticated;

-- --- 4 · Funciones de escritura --------------------------------------------------
create or replace function public.fn_registrar_documento(
  p_codigo_cliente  text,
  p_tipo            text,
  p_ruta_storage    text,
  p_sha256          text,
  p_tamano_bytes    integer,
  p_fecha_documento date,
  p_reemplaza_a     uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_usuario      text := fn_firmante_sesion();
  v_hoy          date := (now() at time zone 'America/Mexico_City')::date;
  v_ruta         text;
  v_cli          clientes%rowtype;
  v_prev         documentos_expediente%rowtype;
  v_id           uuid;
  v_liga         text;
  v_modo         text := 'archivo';
begin
  if v_usuario is null then
    raise exception 'Sin sesión: archivar un documento exige un usuario autenticado.' using errcode = 'DX401';
  end if;
  if p_tipo is null or p_tipo not in ('carta_clasificacion', 'identificacion', 'comprobante_domicilio',
                                      'constancia_fiscal', 'contrato') then
    raise exception 'Tipo de documento no válido.' using errcode = 'DX400';
  end if;
  if p_codigo_cliente is null or p_codigo_cliente !~ '^CSP[FM]U[0-9]{4}$' then
    raise exception 'Código de cliente con forma inválida.' using errcode = 'DX400';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'sha256 con forma inválida.' using errcode = 'DX400';
  end if;
  if p_tamano_bytes is null or p_tamano_bytes not between 1 and 4194304 then
    raise exception 'El PDF está vacío o excede 4 MB.' using errcode = 'DX400';
  end if;
  if p_tipo = 'carta_clasificacion' and p_fecha_documento is null then
    raise exception 'La carta de clasificación exige su fecha de firma.' using errcode = 'DX400';
  end if;
  if p_fecha_documento > v_hoy then
    raise exception 'La fecha del documento no puede ser futura.' using errcode = 'DX400';
  end if;
  v_ruta := p_tipo || '/' || p_codigo_cliente || '/'
            || coalesce(to_char(p_fecha_documento, 'YYYY-MM-DD'), 'sin-fecha')
            || '_' || left(p_sha256, 12) || '.pdf';
  if p_ruta_storage is distinct from v_ruta then
    raise exception 'La ruta no corresponde al documento.' using errcode = 'DX400';
  end if;

  select * into v_cli from clientes where codigo_cliente = p_codigo_cliente for update;
  if not found then
    raise exception 'El cliente no existe.' using errcode = 'DX404';
  end if;
  if exists (select 1 from documentos_expediente
              where codigo_cliente = p_codigo_cliente and tipo = p_tipo and sha256 = p_sha256) then
    raise exception 'Ese mismo archivo ya está en el expediente.' using errcode = 'DX409';
  end if;

  if p_reemplaza_a is not null then
    select * into v_prev from documentos_expediente where id = p_reemplaza_a;
    if not found then
      raise exception 'El documento a reemplazar no existe.' using errcode = 'DX404';
    end if;
    if v_prev.codigo_cliente <> p_codigo_cliente or v_prev.tipo <> p_tipo then
      raise exception 'Solo se reemplaza un documento del mismo cliente y del mismo tipo.' using errcode = 'DX400';
    end if;
    if exists (select 1 from documentos_expediente where reemplaza_a = p_reemplaza_a) then
      raise exception 'Ese documento ya fue reemplazado.' using errcode = 'DX409';
    end if;
  end if;

  if p_tipo = 'carta_clasificacion' then
    if v_cli.status = 'baja' then
      raise exception 'Cliente de baja: no se registra una carta de clasificación.' using errcode = 'DX409';
    end if;
    if p_reemplaza_a is not null then
      if v_cli.clasificacion_fuente is distinct from 'carta_firmada' then
        raise exception 'Solo se reemplaza la carta de un cliente clasificado por carta.' using errcode = 'DX409';
      end if;
      v_modo := 'reemplazo';
    elsif v_cli.clasificacion_fuente = 'carta_firmada' then
      if exists (select 1 from documentos_expediente
                  where codigo_cliente = p_codigo_cliente and tipo = 'carta_clasificacion') then
        raise exception 'El cliente ya tiene su carta en el expediente; para corregir el PDF, reemplázalo.'
          using errcode = 'DX409';
      end if;
      v_modo := 'adjuntar';
    else
      v_modo := 'nueva';
    end if;
  end if;

  insert into documentos_expediente (codigo_cliente, tipo, ruta_storage, fecha_documento, sha256,
                                     tamano_bytes, reemplaza_a, subido_por)
  values (p_codigo_cliente, p_tipo, p_ruta_storage, p_fecha_documento, p_sha256,
          p_tamano_bytes, p_reemplaza_a, v_usuario)
  returning id into v_id;

  v_liga := '/api/documentos/' || v_id;
  if v_modo = 'nueva' then
    update clientes
       set clasificacion_inversionista = '203',
           clasificacion_fuente        = 'carta_firmada',
           clasificacion_fecha         = v_hoy,
           clasificacion_nota          = 'Carta de clasificación firmada; fecha de firma: '
                                         || to_char(p_fecha_documento, 'DD-MM-YYYY')
                                         || '. Registrada desde la ficha (documento ' || v_id
                                         || '); clasificacion_fecha es la de registro.',
           carta_sofisticado_firmada   = true,
           carta_sofisticado_url       = v_liga
     where codigo_cliente = p_codigo_cliente;
  elsif v_modo in ('adjuntar', 'reemplazo') then
    update clientes set carta_sofisticado_url = v_liga where codigo_cliente = p_codigo_cliente;
  end if;

  insert into bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo,
                        motivo, usuario, origen, metadata)
  values ('documentos_expediente', p_codigo_cliente,
          case when p_tipo = 'carta_clasificacion' then 'registro_carta_clasificacion' else 'archivo_documento' end,
          case v_modo when 'nueva' then 'clasificacion_inversionista'
                      when 'archivo' then null else 'carta_sofisticado_url' end,
          case v_modo when 'nueva' then v_cli.clasificacion_inversionista
                      when 'archivo' then null else v_cli.carta_sofisticado_url end,
          case v_modo when 'nueva' then '203' when 'archivo' then null else v_liga end,
          case v_modo
            when 'nueva'     then 'Carta de clasificación firmada el ' || to_char(p_fecha_documento, 'DD-MM-YYYY')
                                  || ' registrada desde la ficha: 203 por carta (R03 J-0315, campo 6).'
            when 'adjuntar'  then 'PDF de la carta adjuntado a un cliente que ya era 203 por carta; la clasificación no cambia.'
            when 'reemplazo' then 'PDF de la carta reemplazado por corrección; la clasificación no cambia.'
            else 'Documento archivado en el expediente (' || p_tipo || ').'
          end,
          v_usuario, 'aplicacion',
          jsonb_build_object('documento_id', v_id, 'tipo', p_tipo, 'modo', v_modo,
                             'sha256', p_sha256, 'tamano_bytes', p_tamano_bytes,
                             'fecha_documento', p_fecha_documento, 'ruta_storage', p_ruta_storage,
                             'reemplaza_a', p_reemplaza_a,
                             'clasificacion_anterior', v_cli.clasificacion_inversionista,
                             'fuente_anterior', v_cli.clasificacion_fuente,
                             'liga_anterior', v_cli.carta_sofisticado_url));

  return jsonb_build_object('documento_id', v_id, 'codigo_cliente', p_codigo_cliente, 'tipo', p_tipo,
                            'modo', v_modo, 'ruta_storage', p_ruta_storage, 'liga', v_liga,
                            'subido_por', v_usuario);
end $$;

comment on function public.fn_registrar_documento(text, text, text, text, integer, date, uuid) is
  'Archiva un PDF ya subido al bucket expediente. Si es la carta de clasificación, mueve la '
  'clasificación (modo nueva) o solo la liga (adjuntar / reemplazo) en la misma transacción. '
  'Usuario de la sesión; errores DX400/401/404/409.';

create or replace function public.fn_registrar_consulta_documento(p_documento_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := fn_firmante_sesion();
  v_doc     documentos_expediente%rowtype;
begin
  if v_usuario is null then
    raise exception 'Sin sesión: consultar un documento exige un usuario autenticado.' using errcode = 'DX401';
  end if;
  select * into v_doc from documentos_expediente where id = p_documento_id;
  if not found then
    raise exception 'El documento no existe.' using errcode = 'DX404';
  end if;
  insert into bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
  values ('documentos_expediente', v_doc.codigo_cliente, 'consulta_documento',
          'Consulta de un documento del expediente: se emite un enlace firmado de corta duración.',
          v_usuario, 'aplicacion',
          jsonb_build_object('documento_id', v_doc.id, 'tipo', v_doc.tipo,
                             'ruta_storage', v_doc.ruta_storage));
  return jsonb_build_object('documento_id', v_doc.id, 'codigo_cliente', v_doc.codigo_cliente,
                            'tipo', v_doc.tipo, 'ruta_storage', v_doc.ruta_storage);
end $$;

comment on function public.fn_registrar_consulta_documento(uuid) is
  'Asienta consulta_documento con el usuario de la sesión y devuelve la ruta para que el '
  'servidor emita el enlace firmado. Se llama ANTES de firmar: todo acceso queda trazado.';

revoke all on function public.fn_registrar_documento(text, text, text, text, integer, date, uuid) from public, anon;
revoke all on function public.fn_registrar_consulta_documento(uuid)                               from public, anon;
grant execute on function public.fn_registrar_documento(text, text, text, text, integer, date, uuid) to authenticated;
grant execute on function public.fn_registrar_consulta_documento(uuid)                               to authenticated;
revoke execute on function public.fn_archivar_documentos() from public, anon, authenticated;

-- --- 5 · Bucket privado --------------------------------------------------------
-- Las columnas de lifecycle van en NULL: protect_bucket_control_insert solo deja
-- fijarlas al rol de servicio de Storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expediente', 'expediente', false, 4194304, array['application/pdf']);

-- --- 6 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public'
        and tablename in ('documentos_expediente', 'documentos_expediente_historico')
        and cmd <> 'SELECT') <> 0 then
    raise exception 'verificación: hay políticas de escritura en las tablas nuevas.';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal
        and tgrelid = 'public.documentos_expediente'::regclass and tgenabled = 'O') <> 2 then
    raise exception 'verificación: no quedaron los 2 triggers (archivo y bitácora).';
  end if;
  if has_table_privilege('authenticated', 'public.documentos_expediente', 'insert')
     or has_table_privilege('authenticated', 'public.documentos_expediente', 'update')
     or has_table_privilege('authenticated', 'public.documentos_expediente', 'delete')
     or has_table_privilege('authenticated', 'public.documentos_expediente', 'truncate')
     or has_table_privilege('anon', 'public.documentos_expediente', 'select') then
    raise exception 'verificación: privilegios de más en documentos_expediente.';
  end if;
  if has_function_privilege('anon', 'public.fn_registrar_documento(text, text, text, text, integer, date, uuid)', 'execute')
     or has_function_privilege('anon', 'public.fn_registrar_consulta_documento(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.fn_registrar_documento(text, text, text, text, integer, date, uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.fn_registrar_consulta_documento(uuid)', 'execute') then
    raise exception 'verificación: EXECUTE de las funciones RPC.';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.prorettype = 'trigger'::regtype
               and (has_function_privilege('anon', p.oid, 'execute')
                    or has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception 'verificación: alguna función de trigger es ejecutable por anon o authenticated.';
  end if;
  if not exists (select 1 from storage.buckets where id = 'expediente' and public = false
                   and file_size_limit = 4194304 and allowed_mime_types = array['application/pdf']) then
    raise exception 'verificación: el bucket no quedó privado, con 4 MB y solo PDF.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects') <> 0 then
    raise exception 'verificación: storage.objects tiene políticas.';
  end if;
end $$;

commit;

-- --- 7 · Resultado (C) -----------------------------------------------------------
select 'documentos_expediente' as objeto,
       (select count(*) from public.documentos_expediente)::text || ' filas · triggers '
       || (select count(*) from pg_trigger where not tgisinternal and tgrelid = 'public.documentos_expediente'::regclass)
       || ' · políticas ' || (select string_agg(cmd, ',') from pg_policies where tablename = 'documentos_expediente') as estado
union all
select 'documentos_expediente_historico',
       (select count(*) from public.documentos_expediente_historico)::text || ' filas'
union all
select 'fn_registrar_documento',
       'anon ' || has_function_privilege('anon', 'public.fn_registrar_documento(text, text, text, text, integer, date, uuid)', 'execute')
       || ' · authenticated ' || has_function_privilege('authenticated', 'public.fn_registrar_documento(text, text, text, text, integer, date, uuid)', 'execute')
union all
select 'fn_registrar_consulta_documento',
       'anon ' || has_function_privilege('anon', 'public.fn_registrar_consulta_documento(uuid)', 'execute')
       || ' · authenticated ' || has_function_privilege('authenticated', 'public.fn_registrar_consulta_documento(uuid)', 'execute')
union all
select 'bucket expediente',
       (select 'public ' || public || ' · límite ' || file_size_limit || ' · mime ' || array_to_string(allowed_mime_types, ',')
          from storage.buckets where id = 'expediente')
union all
select 'políticas storage.objects',
       (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects')::text;
