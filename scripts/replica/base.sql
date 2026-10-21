-- ============================================================================
-- base.sql · réplica PGlite · SOLO ESQUEMA de public, sin una fila de datos.
-- Última migración incluida: 2026-10-21-pep-procedencia-cspfu6388.sql
-- Generado desde el catálogo de producción el 2026-10-21 09:31 (CDMX)
-- con scripts/replica/generar-base.sql. No se edita a mano: se regenera.
-- ============================================================================
set check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.fn_archivar_bloqueos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_archivar_cuenta_titulares()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_archivar_cuentas_ibkr()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_archivar_documentos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_archivar_firmas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_archivar_perfil_riesgo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_usuario text;
  v_version integer;
  v_campos  text[];
begin
  -- Un UPDATE que no cambió ningún valor no merece una versión.
  if (tg_op = 'UPDATE') and (to_jsonb(old) is not distinct from to_jsonb(new)) then
    return new;
  end if;

  v_usuario := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    'sql_directo'
  );

  -- Qué cambió. En DELETE queda null: no hay `new` contra qué comparar.
  -- No se excluye created_at como en fn_bitacora: si alguien lo movió, se ve.
  if (tg_op = 'UPDATE') then
    select array_agg(nuevo.key order by nuevo.key)
      into v_campos
      from jsonb_each_text(to_jsonb(new)) as nuevo(key, value)
     where nuevo.value is distinct from (to_jsonb(old) ->> nuevo.key);
  end if;

  select coalesce(max(version), 0) + 1
    into v_version
    from perfil_riesgo_historico
   where codigo_cliente = old.codigo_cliente;

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
    perfil_ajustado_por, fecha_ajuste, perfil_ajustado, ajustado_por
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
    old.fecha_ajuste, old.perfil_ajustado, old.ajustado_por
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_archivar_personas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_bitacora()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.fn_firmante_sesion()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select nullif(btrim(coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')
$function$
;
CREATE OR REPLACE FUNCTION public.fn_levantar_bloqueo(p_bloqueo_id uuid, p_motivo text, p_rol text, p_declaracion text, p_autorizacion_oficial text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_registrar_consulta_documento(p_documento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_registrar_documento(p_codigo_cliente text, p_tipo text, p_ruta_storage text, p_sha256 text, p_tamano_bytes integer, p_fecha_documento date, p_reemplaza_a uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_resolver_coincidencia(p_coincidencia_id uuid, p_estado text, p_motivo text, p_rol text, p_declaracion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.fn_tipos_sanciones()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select array['LPB','OFAC','ONU']::text[]
$function$
;
create table public.beneficiarios (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  nombre_completo text,
  relacion text,
  proporcion numeric,
  genero text,
  fecha_nacimiento date,
  rfc text,
  domicilio_completo text,
  ocupacion text,
  lugar_nacimiento text,
  respuestas_completas jsonb,
  created_at timestamp with time zone default now(),
  persona_id uuid
);
create table public.bitacora (
  id uuid default gen_random_uuid() not null,
  entidad text not null,
  entidad_id text not null,
  accion text not null,
  campo text,
  valor_anterior text,
  valor_nuevo text,
  motivo text,
  usuario text,
  origen text default 'trigger'::text not null,
  metadata jsonb,
  created_at timestamp with time zone default now() not null
);
create table public.cliente_bloqueos (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  coincidencia_id uuid not null,
  motivo text not null,
  bloqueado_en timestamp with time zone default now() not null,
  bloqueado_por text not null,
  levantado_en timestamp with time zone,
  levantado_por text,
  motivo_levantamiento text,
  firma_id uuid
);
create table public.cliente_bloqueos_historico (
  historico_id uuid default gen_random_uuid() not null,
  version integer not null,
  archivado_en timestamp with time zone default now() not null,
  archivado_por text not null,
  operacion text not null,
  campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null,
  codigo_cliente text,
  coincidencia_id uuid,
  motivo text,
  bloqueado_en timestamp with time zone,
  bloqueado_por text,
  levantado_en timestamp with time zone,
  levantado_por text,
  motivo_levantamiento text,
  firma_id uuid
);
create table public.clientes (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  status text default 'lead_nuevo'::text,
  nombre text,
  apellido_paterno text,
  apellido_materno text,
  genero text,
  fecha_nacimiento date,
  rfc text,
  curp text,
  estado_civil text,
  correo text,
  celular text,
  grado_estudios text,
  ocupacion text,
  ingreso_neto_mensual numeric,
  ahorros_aprox numeric,
  fecha_lead timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  cuenta_ibkr text,
  es_conjunta boolean default false,
  codigo_cotitular text,
  fecha_aniversario date,
  fecha_ultima_revision date,
  carta_sofisticado_firmada boolean default false,
  carta_sofisticado_url text,
  ocupacion_pb text,
  ocupacion_pb_fecha date,
  ocupacion_pb_fuente text,
  realiza_actividad_vulnerable boolean,
  actividades_vulnerables jsonb,
  actividad_vulnerable_fecha date,
  actividad_vulnerable_fuente text,
  documentos_completos boolean default false,
  actividad_vulnerable_detalle text,
  fecha_baja date,
  motivo_baja text,
  clasificacion_inversionista text,
  clasificacion_fuente text,
  clasificacion_fecha date,
  clasificacion_nota text
);
create table public.codigos_alias (
  id uuid default gen_random_uuid() not null,
  codigo_anterior text not null,
  codigo_actual text not null,
  fecha date not null,
  motivo text not null,
  referencia text not null,
  registrado_en timestamp with time zone default now() not null,
  registrado_por text default COALESCE(((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'email'::text), 'sql_directo'::text) not null
);
create table public.cuenta_titulares (
  id uuid default gen_random_uuid() not null,
  cuenta_ibkr text not null,
  persona_id uuid not null,
  rol text not null,
  creado_en timestamp with time zone default now() not null,
  creado_por text default COALESCE(((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'email'::text), 'sql_directo'::text) not null
);
create table public.cuenta_titulares_historico (
  historico_id uuid default gen_random_uuid() not null,
  version integer not null,
  archivado_en timestamp with time zone default now() not null,
  archivado_por text not null,
  operacion text not null,
  campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null,
  cuenta_ibkr text,
  persona_id uuid,
  rol text,
  creado_en timestamp with time zone,
  creado_por text
);
create table public.cuentas_ibkr (
  id uuid default gen_random_uuid() not null,
  cuenta_ibkr text not null,
  codigo_cliente text not null,
  tipo text not null,
  creado_en timestamp with time zone default now() not null,
  creado_por text default COALESCE(((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'email'::text), 'sql_directo'::text) not null
);
create table public.cuentas_ibkr_historico (
  historico_id uuid default gen_random_uuid() not null,
  version integer not null,
  archivado_en timestamp with time zone default now() not null,
  archivado_por text not null,
  operacion text not null,
  campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null,
  cuenta_ibkr text,
  codigo_cliente text,
  tipo text,
  creado_en timestamp with time zone,
  creado_por text
);
create table public.documentos_expediente (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  tipo text not null,
  ruta_storage text not null,
  fecha_documento date,
  sha256 text not null,
  tamano_bytes integer not null,
  mime text default 'application/pdf'::text not null,
  reemplaza_a uuid,
  subido_por text not null,
  created_at timestamp with time zone default now() not null
);
create table public.documentos_expediente_historico (
  historico_id uuid default gen_random_uuid() not null,
  version integer not null,
  archivado_en timestamp with time zone default now() not null,
  archivado_por text not null,
  operacion text not null,
  campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null,
  codigo_cliente text,
  tipo text,
  ruta_storage text,
  fecha_documento date,
  sha256 text,
  tamano_bytes integer,
  mime text,
  reemplaza_a uuid,
  subido_por text,
  created_at timestamp with time zone
);
create table public.ebr_evaluaciones (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  grado_riesgo text not null,
  regimen text not null,
  razon_clasificacion text not null,
  fundamento_clasificacion text not null,
  supuestos_evaluados jsonb not null,
  supuestos_activos smallint not null,
  matriz_factores jsonb not null,
  matriz_puntaje_total smallint not null,
  matriz_banda text not null,
  es_pep boolean default false not null,
  pep_extranjero boolean default false not null,
  aplica_medidas_pep boolean default false not null,
  requiere_aprobacion_oficial boolean default false not null,
  en_lista_bloqueadas boolean default false not null,
  alerta_critica text,
  evaluacion_preliminar boolean not null,
  motivos_preliminar jsonb default '[]'::jsonb not null,
  verificaciones_pendientes jsonb default '[]'::jsonb not null,
  observaciones jsonb default '[]'::jsonb not null,
  entrada jsonb not null,
  fecha_evaluacion timestamp with time zone default now() not null,
  override_source text default 'automatic'::text not null,
  elaboro text not null,
  revisa_autoriza text not null,
  created_at timestamp with time zone default now() not null
);
create table public.firmas_cumplimiento (
  id uuid default gen_random_uuid() not null,
  entidad text not null,
  entidad_id uuid not null,
  codigo_cliente text not null,
  acto text not null,
  firmante text not null,
  rol text not null,
  firmado_en timestamp with time zone default now() not null,
  declaracion text not null,
  autorizacion_oficial text
);
create table public.firmas_cumplimiento_historico (
  historico_id uuid default gen_random_uuid() not null,
  version integer not null,
  archivado_en timestamp with time zone default now() not null,
  archivado_por text not null,
  operacion text not null,
  campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null,
  entidad text,
  entidad_id uuid,
  codigo_cliente text,
  acto text,
  firmante text,
  rol text,
  firmado_en timestamp with time zone,
  declaracion text,
  autorizacion_oficial text
);
create table public.kyc_detalle (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  nacionalidad text,
  pais_nacimiento text,
  estado_nacimiento text,
  calle text,
  numero_exterior text,
  numero_interior text,
  colonia text,
  municipio text,
  ciudad text,
  estado text,
  codigo_postal text,
  domicilio_fiscal_igual boolean,
  domicilio_fiscal text,
  regimen_fiscal text,
  empresa text,
  puesto text,
  nivel_jerarquico text,
  giro_empresa text,
  sector_empresa text,
  tipo_ingresos text,
  tiene_vinculos_patrimoniales boolean,
  respuestas_completas jsonb,
  fecha_kyc timestamp with time zone,
  created_at timestamp with time zone default now(),
  entidad_federativa_pb text
);
create table public.listas_coincidencias (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  lista_id uuid not null,
  registro_id uuid not null,
  tipo_match text not null,
  valor_cliente text not null,
  valor_lista text not null,
  estado text default 'pendiente'::text not null,
  revisada_por text,
  fecha_revision timestamp with time zone,
  motivo_resolucion text,
  detectada_en timestamp with time zone default now() not null
);
create table public.listas_control (
  id uuid default gen_random_uuid() not null,
  tipo text not null,
  obligatoria boolean default false not null,
  fuente text not null,
  fecha_lista date not null,
  fecha_carga timestamp with time zone default now() not null,
  cargada_por text,
  registros integer default 0 not null,
  archivo_nombre text,
  vigente boolean default true not null,
  observaciones text
);
create table public.listas_registros (
  id uuid default gen_random_uuid() not null,
  lista_id uuid not null,
  nombre text not null,
  nombre_norm text not null,
  rfc text,
  curp text,
  alias text,
  programa text,
  pais text,
  observaciones text,
  created_at timestamp with time zone default now() not null
);
create table public.pep_listas (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  es_pep boolean,
  cargo_publico text,
  institucion text,
  pais_cargo text,
  tiene_relacionado_pep boolean,
  cargo_relacionado text,
  pais_relacionado text,
  institucion_relacionado text,
  resultado_screening text,
  fecha_screening date,
  respuestas_completas jsonb,
  created_at timestamp with time zone default now(),
  es_pep_nacional boolean default false,
  es_pep_extranjero boolean default false,
  familiar_pep_nacional boolean default false,
  familiar_pep_extranjero boolean default false,
  pep_declaracion_fecha date,
  pep_declaracion_fuente text
);
create table public.perfil_riesgo (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  objetivo_inversion text,
  ganancia_deseada text,
  horizonte text,
  tolerancia_perdida text,
  resultado_perfil text,
  perfil_ia text,
  respuestas_completas jsonb,
  fecha_evaluacion date,
  created_at timestamp with time zone default now(),
  reaccion_caida_10 text,
  negocio_propio text,
  percepcion_riesgo_empleo text,
  prefiere_ingreso_seguro text,
  no_puede_perder text,
  colchon_liquidez text,
  dependientes integer,
  situacion_habitacional text,
  ahorros numeric,
  hipoteca numeric,
  otras_deudas numeric,
  fase text,
  tolerancia_puntos integer,
  tolerancia_nivel integer,
  capacidad_puntos integer,
  capacidad_nivel integer,
  puntuacion_ponderada numeric,
  perfil_solicitado_cliente text,
  bitacora_calculo jsonb,
  fecha_calculo timestamp with time zone,
  tiene_ahorros text,
  comentario_asesor text,
  perfil_ajustado_por text,
  fecha_ajuste timestamp with time zone,
  perfil_ajustado text,
  ajustado_por text
);
create table public.perfil_riesgo_historico (
  historico_id uuid default gen_random_uuid() not null,
  version integer not null,
  archivado_en timestamp with time zone default now() not null,
  archivado_por text not null,
  operacion text not null,
  campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null,
  codigo_cliente text not null,
  objetivo_inversion text,
  ganancia_deseada text,
  horizonte text,
  tolerancia_perdida text,
  resultado_perfil text,
  perfil_ia text,
  respuestas_completas jsonb,
  fecha_evaluacion date,
  created_at timestamp with time zone,
  reaccion_caida_10 text,
  negocio_propio text,
  percepcion_riesgo_empleo text,
  prefiere_ingreso_seguro text,
  no_puede_perder text,
  colchon_liquidez text,
  dependientes integer,
  situacion_habitacional text,
  ahorros numeric,
  hipoteca numeric,
  otras_deudas numeric,
  fase text,
  tolerancia_puntos integer,
  tolerancia_nivel integer,
  capacidad_puntos integer,
  capacidad_nivel integer,
  puntuacion_ponderada numeric,
  perfil_solicitado_cliente text,
  bitacora_calculo jsonb,
  fecha_calculo timestamp with time zone,
  tiene_ahorros text,
  comentario_asesor text,
  perfil_ajustado_por text,
  fecha_ajuste timestamp with time zone,
  perfil_ajustado text,
  ajustado_por text
);
create table public.personas (
  id uuid default gen_random_uuid() not null,
  codigo_reporte text,
  codigo_ficha text,
  codigo_kyc text,
  codigo_pep text,
  codigo_ips text,
  codigo_ebr text,
  nota text,
  creado_en timestamp with time zone default now() not null,
  creado_por text default COALESCE(((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb ->> 'email'::text), 'sql_directo'::text) not null
);
create table public.personas_historico (
  historico_id uuid default gen_random_uuid() not null,
  version integer not null,
  archivado_en timestamp with time zone default now() not null,
  archivado_por text not null,
  operacion text not null,
  campos_cambiados text[],
  snapshot jsonb not null,
  id uuid not null,
  codigo_reporte text,
  codigo_ficha text,
  codigo_kyc text,
  codigo_pep text,
  codigo_ips text,
  codigo_ebr text,
  nota text,
  creado_en timestamp with time zone,
  creado_por text
);
create table public.portafolios (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  universo text not null,
  fase text not null,
  perfil text not null,
  posiciones jsonb not null,
  liquidez_pct numeric,
  renta_variable_pct numeric,
  tech_pct numeric,
  validaciones jsonb,
  posiciones_ajustadas jsonb,
  comentario_asesor text,
  ajustado_por text,
  fecha_ajuste timestamp with time zone,
  fecha_generacion timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  advertencias jsonb,
  bitacora jsonb
);
create table public.propietario_real (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  aplica boolean,
  nombre text,
  apellido_paterno text,
  apellido_materno text,
  genero text,
  fecha_nacimiento date,
  curp text,
  rfc text,
  nacionalidad text,
  pais_residencia text,
  regimen_fiscal text,
  celular text,
  domicilio_completo text,
  respuestas_completas jsonb,
  created_at timestamp with time zone default now()
);
create table public.transaccionalidad (
  id uuid default gen_random_uuid() not null,
  codigo_cliente text not null,
  ahorro_declarado numeric,
  monto_inicial_deposito numeric,
  depositos_mensuales integer,
  retiros_mensuales integer,
  rango_deposito_mensual text,
  rango_retiro_mensual text,
  fecha_declaracion date,
  created_at timestamp with time zone default now()
);
alter table beneficiarios add constraint beneficiarios_pkey PRIMARY KEY (id);
alter table bitacora add constraint bitacora_pkey PRIMARY KEY (id);
alter table cliente_bloqueos_historico add constraint bloqueos_historico_version_unica UNIQUE (id, version);
alter table cliente_bloqueos_historico add constraint cliente_bloqueos_historico_operacion_check CHECK ((operacion = ANY (ARRAY['update'::text, 'delete'::text])));
alter table cliente_bloqueos_historico add constraint cliente_bloqueos_historico_pkey PRIMARY KEY (historico_id);
alter table cliente_bloqueos add constraint bloqueos_levantamiento_completo CHECK ((((levantado_en IS NULL) = (levantado_por IS NULL)) AND ((levantado_en IS NULL) = (motivo_levantamiento IS NULL)) AND ((levantado_en IS NULL) = (firma_id IS NULL))));
alter table cliente_bloqueos add constraint bloqueos_levantamiento_lleno CHECK (((motivo_levantamiento IS NULL) OR (btrim(motivo_levantamiento) <> ''::text)));
alter table cliente_bloqueos add constraint bloqueos_levantamiento_posterior CHECK (((levantado_en IS NULL) OR (levantado_en >= bloqueado_en)));
alter table cliente_bloqueos add constraint bloqueos_motivo_lleno CHECK ((btrim(motivo) <> ''::text));
alter table cliente_bloqueos add constraint cliente_bloqueos_pkey PRIMARY KEY (id);
alter table clientes add constraint clientes_actividad_vulnerable_procedencia CHECK ((((realiza_actividad_vulnerable IS NULL) = (actividad_vulnerable_fuente IS NULL)) AND ((actividad_vulnerable_fuente IS NULL) OR (actividad_vulnerable_fuente = ANY (ARRAY['cliente'::text, 'asesor'::text])))));
alter table clientes add constraint clientes_baja_completa CHECK ((((status = 'baja'::text) = (fecha_baja IS NOT NULL)) AND ((status = 'baja'::text) = (motivo_baja IS NOT NULL))));
alter table clientes add constraint clientes_clasificacion_203_solo_por_carta CHECK (((clasificacion_inversionista IS DISTINCT FROM '203'::text) OR (clasificacion_fuente = 'carta_firmada'::text)));
alter table clientes add constraint clientes_clasificacion_carta CHECK (((clasificacion_fuente IS DISTINCT FROM 'carta_firmada'::text) OR ((clasificacion_inversionista = '203'::text) AND (carta_sofisticado_firmada IS TRUE))));
alter table clientes add constraint clientes_clasificacion_determinacion_motivada CHECK (((clasificacion_fuente IS DISTINCT FROM 'determinacion_asesor'::text) OR ((clasificacion_nota IS NOT NULL) AND (btrim(clasificacion_nota) <> ''::text))));
alter table clientes add constraint clientes_clasificacion_procedencia CHECK ((((clasificacion_inversionista IS NULL) = (clasificacion_fuente IS NULL)) AND ((clasificacion_inversionista IS NULL) = (clasificacion_fecha IS NULL)) AND ((clasificacion_fuente IS NULL) OR (clasificacion_fuente = ANY (ARRAY['carta_firmada'::text, 'determinacion_asesor'::text])))));
alter table clientes add constraint clientes_clasificacion_valida CHECK (((clasificacion_inversionista IS NULL) OR (clasificacion_inversionista = ANY (ARRAY['201'::text, '202'::text, '203'::text, '204'::text]))));
alter table clientes add constraint clientes_codigo_cliente_key UNIQUE (codigo_cliente);
alter table clientes add constraint clientes_cuenta_ibkr_key UNIQUE (cuenta_ibkr);
alter table clientes add constraint clientes_pkey PRIMARY KEY (id);
alter table clientes add constraint clientes_status_valido CHECK ((status = ANY (ARRAY['lead_nuevo'::text, 'vigente'::text, 'inactivo'::text, 'baja'::text])));
alter table codigos_alias add constraint codigos_alias_codigo_anterior_key UNIQUE (codigo_anterior);
alter table codigos_alias add constraint codigos_alias_distintos CHECK ((codigo_anterior <> codigo_actual));
alter table codigos_alias add constraint codigos_alias_pkey PRIMARY KEY (id);
alter table cuenta_titulares_historico add constraint cuenta_titulares_historico_operacion_check CHECK ((operacion = ANY (ARRAY['update'::text, 'delete'::text])));
alter table cuenta_titulares_historico add constraint cuenta_titulares_historico_pkey PRIMARY KEY (historico_id);
alter table cuenta_titulares_historico add constraint cuenta_titulares_historico_version_unica UNIQUE (id, version);
alter table cuenta_titulares add constraint cuenta_titulares_par_unico UNIQUE (cuenta_ibkr, persona_id);
alter table cuenta_titulares add constraint cuenta_titulares_pkey PRIMARY KEY (id);
alter table cuenta_titulares add constraint cuenta_titulares_rol_valido CHECK ((rol = ANY (ARRAY['titular'::text, 'cotitular'::text])));
alter table cuentas_ibkr_historico add constraint cuentas_ibkr_historico_operacion_check CHECK ((operacion = ANY (ARRAY['update'::text, 'delete'::text])));
alter table cuentas_ibkr_historico add constraint cuentas_ibkr_historico_pkey PRIMARY KEY (historico_id);
alter table cuentas_ibkr_historico add constraint cuentas_ibkr_historico_version_unica UNIQUE (id, version);
alter table cuentas_ibkr add constraint cuentas_ibkr_codigo_unico UNIQUE (codigo_cliente);
alter table cuentas_ibkr add constraint cuentas_ibkr_cuenta_unica UNIQUE (cuenta_ibkr);
alter table cuentas_ibkr add constraint cuentas_ibkr_forma CHECK ((cuenta_ibkr ~ '^U[0-9]+$'::text));
alter table cuentas_ibkr add constraint cuentas_ibkr_pkey PRIMARY KEY (id);
alter table cuentas_ibkr add constraint cuentas_ibkr_tipo_valido CHECK ((tipo = ANY (ARRAY['individual'::text, 'conjunta'::text])));
alter table documentos_expediente_historico add constraint documentos_expediente_historico_operacion_check CHECK ((operacion = ANY (ARRAY['update'::text, 'delete'::text])));
alter table documentos_expediente_historico add constraint documentos_expediente_historico_pkey PRIMARY KEY (historico_id);
alter table documentos_expediente_historico add constraint documentos_historico_version_unica UNIQUE (id, version);
alter table documentos_expediente add constraint documentos_archivo_unico UNIQUE (codigo_cliente, tipo, sha256);
alter table documentos_expediente add constraint documentos_carta_con_fecha CHECK (((tipo <> 'carta_clasificacion'::text) OR (fecha_documento IS NOT NULL)));
alter table documentos_expediente add constraint documentos_codigo_forma CHECK ((codigo_cliente ~ '^CSP[FM]U[0-9]{4}$'::text));
alter table documentos_expediente add constraint documentos_expediente_pkey PRIMARY KEY (id);
alter table documentos_expediente add constraint documentos_mime_pdf CHECK ((mime = 'application/pdf'::text));
alter table documentos_expediente add constraint documentos_no_se_reemplaza_a_si CHECK ((reemplaza_a IS DISTINCT FROM id));
alter table documentos_expediente add constraint documentos_ruta_forma CHECK (((ruta_storage ~ '^[a-z_]+/CSP[FM]U[0-9]{4}/([0-9]{4}-[0-9]{2}-[0-9]{2}|sin-fecha)_[0-9a-f]{12}\.pdf$'::text) AND (split_part(ruta_storage, '/'::text, 1) = tipo) AND (split_part(ruta_storage, '/'::text, 2) = codigo_cliente) AND ("substring"(ruta_storage, '_([0-9a-f]{12})\.pdf$'::text) = "left"(sha256, 12)) AND ((fecha_documento IS NULL) = (POSITION(('/sin-fecha_'::text) IN (ruta_storage)) > 0))));
alter table documentos_expediente add constraint documentos_ruta_unica UNIQUE (ruta_storage);
alter table documentos_expediente add constraint documentos_sha256_forma CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text));
alter table documentos_expediente add constraint documentos_subido_por_lleno CHECK ((btrim(subido_por) <> ''::text));
alter table documentos_expediente add constraint documentos_tamano CHECK (((tamano_bytes >= 1) AND (tamano_bytes <= 4194304)));
alter table documentos_expediente add constraint documentos_tipo_valido CHECK ((tipo = ANY (ARRAY['carta_clasificacion'::text, 'identificacion'::text, 'comprobante_domicilio'::text, 'constancia_fiscal'::text, 'contrato'::text])));
alter table ebr_evaluaciones add constraint ebr_evaluaciones_grado_riesgo_check CHECK ((grado_riesgo = ANY (ARRAY['BAJO'::text, 'ALTO'::text])));
alter table ebr_evaluaciones add constraint ebr_evaluaciones_matriz_banda_check CHECK ((matriz_banda = ANY (ARRAY['Baja'::text, 'Media'::text, 'Alta'::text])));
alter table ebr_evaluaciones add constraint ebr_evaluaciones_matriz_puntaje_total_check CHECK (((matriz_puntaje_total >= 43) AND (matriz_puntaje_total <= 130)));
alter table ebr_evaluaciones add constraint ebr_evaluaciones_pkey PRIMARY KEY (id);
alter table ebr_evaluaciones add constraint ebr_evaluaciones_regimen_check CHECK ((regimen = ANY (ARRAY['Ordinario'::text, 'Reforzado'::text])));
alter table ebr_evaluaciones add constraint ebr_evaluaciones_supuestos_activos_check CHECK (((supuestos_activos >= 0) AND (supuestos_activos <= 3)));
alter table firmas_cumplimiento_historico add constraint firmas_cumplimiento_historico_operacion_check CHECK ((operacion = ANY (ARRAY['update'::text, 'delete'::text])));
alter table firmas_cumplimiento_historico add constraint firmas_cumplimiento_historico_pkey PRIMARY KEY (historico_id);
alter table firmas_cumplimiento_historico add constraint firmas_historico_version_unica UNIQUE (id, version);
alter table firmas_cumplimiento add constraint firmas_acto_entidad CHECK (((acto = 'levantamiento_bloqueo'::text) = (entidad = 'cliente_bloqueos'::text)));
alter table firmas_cumplimiento add constraint firmas_acto_valido CHECK ((acto = ANY (ARRAY['confirmacion_coincidencia'::text, 'descarte_coincidencia'::text, 'levantamiento_bloqueo'::text])));
alter table firmas_cumplimiento add constraint firmas_autorizacion_llena CHECK (((autorizacion_oficial IS NULL) OR (btrim(autorizacion_oficial) <> ''::text)));
alter table firmas_cumplimiento add constraint firmas_autorizacion_solo_levantamiento CHECK (((autorizacion_oficial IS NULL) OR (acto = 'levantamiento_bloqueo'::text)));
alter table firmas_cumplimiento add constraint firmas_cumplimiento_pkey PRIMARY KEY (id);
alter table firmas_cumplimiento add constraint firmas_declaracion_llena CHECK ((btrim(declaracion) <> ''::text));
alter table firmas_cumplimiento add constraint firmas_entidad_valida CHECK ((entidad = ANY (ARRAY['listas_coincidencias'::text, 'cliente_bloqueos'::text])));
alter table firmas_cumplimiento add constraint firmas_firmante_lleno CHECK ((btrim(firmante) <> ''::text));
alter table firmas_cumplimiento add constraint firmas_levantamiento_asesor_autorizado CHECK (((acto <> 'levantamiento_bloqueo'::text) OR (rol <> 'asesor'::text) OR (autorizacion_oficial IS NOT NULL)));
alter table firmas_cumplimiento add constraint firmas_rol_valido CHECK ((rol = ANY (ARRAY['asesor'::text, 'oficial_cumplimiento'::text])));
alter table kyc_detalle add constraint kyc_detalle_codigo_cliente_key UNIQUE (codigo_cliente);
alter table kyc_detalle add constraint kyc_detalle_pkey PRIMARY KEY (id);
alter table listas_coincidencias add constraint listas_coincidencias_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'confirmada'::text, 'descartada'::text])));
alter table listas_coincidencias add constraint listas_coincidencias_pkey PRIMARY KEY (id);
alter table listas_coincidencias add constraint listas_coincidencias_tipo_match_check CHECK ((tipo_match = ANY (ARRAY['rfc_exacto'::text, 'curp_exacto'::text, 'nombre_exacto'::text])));
alter table listas_control add constraint listas_control_pkey PRIMARY KEY (id);
alter table listas_control add constraint listas_control_tipo_check CHECK ((tipo = ANY (ARRAY['LPB'::text, 'PEP_NACIONAL'::text, 'OFAC'::text, 'SAT_69B'::text, 'ONU'::text])));
alter table listas_registros add constraint listas_registros_pkey PRIMARY KEY (id);
alter table pep_listas add constraint pep_listas_pkey PRIMARY KEY (id);
alter table perfil_riesgo_historico add constraint perfil_riesgo_historico_operacion_check CHECK ((operacion = ANY (ARRAY['update'::text, 'delete'::text])));
alter table perfil_riesgo_historico add constraint perfil_riesgo_historico_pkey PRIMARY KEY (historico_id);
alter table perfil_riesgo_historico add constraint perfil_riesgo_historico_version_unica UNIQUE (codigo_cliente, version);
alter table perfil_riesgo add constraint perfil_riesgo_codigo_cliente_key UNIQUE (codigo_cliente);
alter table perfil_riesgo add constraint perfil_riesgo_perfil_ajustado_valido CHECK (((perfil_ajustado IS NULL) OR (perfil_ajustado = ANY (ARRAY['Alto'::text, 'Moderado'::text, 'Bajo'::text, 'Libre de Riesgo'::text]))));
alter table perfil_riesgo add constraint perfil_riesgo_pkey PRIMARY KEY (id);
alter table personas_historico add constraint personas_historico_operacion_check CHECK ((operacion = ANY (ARRAY['update'::text, 'delete'::text])));
alter table personas_historico add constraint personas_historico_pkey PRIMARY KEY (historico_id);
alter table personas_historico add constraint personas_historico_version_unica UNIQUE (id, version);
alter table personas add constraint personas_codigo_ebr_unico UNIQUE (codigo_ebr);
alter table personas add constraint personas_codigo_ficha_unico UNIQUE (codigo_ficha);
alter table personas add constraint personas_codigo_ips_unico UNIQUE (codigo_ips);
alter table personas add constraint personas_codigo_kyc_unico UNIQUE (codigo_kyc);
alter table personas add constraint personas_codigo_pep_unico UNIQUE (codigo_pep);
alter table personas add constraint personas_codigo_reporte_forma CHECK ((codigo_reporte ~ '^CSP[FM]U[0-9]{4}$'::text));
alter table personas add constraint personas_codigo_reporte_unico UNIQUE (codigo_reporte);
alter table personas add constraint personas_nota_llena CHECK (((nota IS NULL) OR (btrim(nota) <> ''::text)));
alter table personas add constraint personas_pkey PRIMARY KEY (id);
alter table portafolios add constraint portafolios_pkey PRIMARY KEY (id);
alter table portafolios add constraint portafolios_universo_check CHECK ((universo = ANY (ARRAY['UCITS'::text, 'EEUU'::text])));
alter table propietario_real add constraint propietario_real_pkey PRIMARY KEY (id);
alter table transaccionalidad add constraint transaccionalidad_cliente_fecha_key UNIQUE (codigo_cliente, fecha_declaracion);
alter table transaccionalidad add constraint transaccionalidad_pkey PRIMARY KEY (id);
alter table beneficiarios add constraint beneficiarios_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table beneficiarios add constraint beneficiarios_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES personas(id) DEFERRABLE;
alter table cliente_bloqueos add constraint cliente_bloqueos_coincidencia_id_fkey FOREIGN KEY (coincidencia_id) REFERENCES listas_coincidencias(id);
alter table cliente_bloqueos add constraint cliente_bloqueos_firma_id_fkey FOREIGN KEY (firma_id) REFERENCES firmas_cumplimiento(id);
alter table clientes add constraint clientes_codigo_cotitular_fkey FOREIGN KEY (codigo_cotitular) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table cuenta_titulares add constraint cuenta_titulares_cuenta_ibkr_fkey FOREIGN KEY (cuenta_ibkr) REFERENCES cuentas_ibkr(cuenta_ibkr) DEFERRABLE;
alter table cuenta_titulares add constraint cuenta_titulares_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES personas(id) DEFERRABLE;
alter table cuentas_ibkr add constraint cuentas_ibkr_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table documentos_expediente add constraint documentos_expediente_reemplaza_a_fkey FOREIGN KEY (reemplaza_a) REFERENCES documentos_expediente(id);
alter table ebr_evaluaciones add constraint ebr_evaluaciones_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table kyc_detalle add constraint kyc_detalle_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table listas_coincidencias add constraint listas_coincidencias_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table listas_coincidencias add constraint listas_coincidencias_lista_id_fkey FOREIGN KEY (lista_id) REFERENCES listas_control(id);
alter table listas_coincidencias add constraint listas_coincidencias_registro_id_fkey FOREIGN KEY (registro_id) REFERENCES listas_registros(id);
alter table listas_registros add constraint listas_registros_lista_id_fkey FOREIGN KEY (lista_id) REFERENCES listas_control(id) ON DELETE CASCADE;
alter table pep_listas add constraint pep_listas_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table perfil_riesgo add constraint perfil_riesgo_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table personas add constraint personas_codigo_ebr_fkey FOREIGN KEY (codigo_ebr) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table personas add constraint personas_codigo_ficha_fkey FOREIGN KEY (codigo_ficha) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table personas add constraint personas_codigo_ips_fkey FOREIGN KEY (codigo_ips) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table personas add constraint personas_codigo_kyc_fkey FOREIGN KEY (codigo_kyc) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table personas add constraint personas_codigo_pep_fkey FOREIGN KEY (codigo_pep) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table portafolios add constraint portafolios_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table propietario_real add constraint propietario_real_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
alter table transaccionalidad add constraint transaccionalidad_codigo_cliente_fkey FOREIGN KEY (codigo_cliente) REFERENCES clientes(codigo_cliente) DEFERRABLE;
CREATE INDEX bitacora_entidad_idx ON public.bitacora USING btree (entidad, entidad_id, created_at DESC);
CREATE INDEX bitacora_fecha_idx ON public.bitacora USING btree (created_at DESC);
CREATE INDEX ebr_evaluaciones_cliente_fecha_idx ON public.ebr_evaluaciones USING btree (codigo_cliente, fecha_evaluacion DESC);
CREATE INDEX idx_beneficiarios_persona ON public.beneficiarios USING btree (persona_id) WHERE (persona_id IS NOT NULL);
CREATE INDEX idx_bloqueos_coincidencia ON public.cliente_bloqueos USING btree (coincidencia_id);
CREATE INDEX idx_cuenta_titulares_persona ON public.cuenta_titulares USING btree (persona_id);
CREATE INDEX idx_documentos_cliente_tipo ON public.documentos_expediente USING btree (codigo_cliente, tipo, created_at DESC);
CREATE INDEX idx_firmas_cliente ON public.firmas_cumplimiento USING btree (codigo_cliente);
CREATE INDEX idx_firmas_entidad ON public.firmas_cumplimiento USING btree (entidad, entidad_id);
CREATE INDEX idx_prh_archivado ON public.perfil_riesgo_historico USING btree (archivado_en DESC);
CREATE INDEX listas_coincidencias_cliente_idx ON public.listas_coincidencias USING btree (codigo_cliente, estado);
CREATE INDEX listas_coincidencias_estado_idx ON public.listas_coincidencias USING btree (estado) WHERE (estado = 'pendiente'::text);
CREATE INDEX listas_registros_lista_idx ON public.listas_registros USING btree (lista_id);
CREATE INDEX listas_registros_nombre_idx ON public.listas_registros USING btree (nombre_norm);
CREATE INDEX listas_registros_rfc_idx ON public.listas_registros USING btree (rfc) WHERE (rfc IS NOT NULL);
CREATE UNIQUE INDEX uq_bloqueo_abierto_por_cliente ON public.cliente_bloqueos USING btree (codigo_cliente) WHERE (levantado_en IS NULL);
CREATE UNIQUE INDEX uq_cuenta_un_titular ON public.cuenta_titulares USING btree (cuenta_ibkr) WHERE (rol = 'titular'::text);
CREATE UNIQUE INDEX uq_documentos_reemplazo_unico ON public.documentos_expediente USING btree (reemplaza_a) WHERE (reemplaza_a IS NOT NULL);
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.beneficiarios FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_archivar_bloqueos BEFORE DELETE OR UPDATE ON public.cliente_bloqueos FOR EACH ROW EXECUTE FUNCTION fn_archivar_bloqueos();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.cliente_bloqueos FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_archivar_cuenta_titulares BEFORE DELETE OR UPDATE ON public.cuenta_titulares FOR EACH ROW EXECUTE FUNCTION fn_archivar_cuenta_titulares();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.cuenta_titulares FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_archivar_cuentas_ibkr BEFORE DELETE OR UPDATE ON public.cuentas_ibkr FOR EACH ROW EXECUTE FUNCTION fn_archivar_cuentas_ibkr();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.cuentas_ibkr FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_archivar_documentos BEFORE DELETE OR UPDATE ON public.documentos_expediente FOR EACH ROW EXECUTE FUNCTION fn_archivar_documentos();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.documentos_expediente FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_bitacora AFTER DELETE OR UPDATE ON public.ebr_evaluaciones FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_archivar_firmas BEFORE DELETE OR UPDATE ON public.firmas_cumplimiento FOR EACH ROW EXECUTE FUNCTION fn_archivar_firmas();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.firmas_cumplimiento FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.kyc_detalle FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.listas_coincidencias FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.listas_control FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.pep_listas FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_archivar_perfil_riesgo BEFORE DELETE OR UPDATE ON public.perfil_riesgo FOR EACH ROW EXECUTE FUNCTION fn_archivar_perfil_riesgo();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.perfil_riesgo FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_archivar_personas BEFORE DELETE OR UPDATE ON public.personas FOR EACH ROW EXECUTE FUNCTION fn_archivar_personas();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.personas FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.propietario_real FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
CREATE TRIGGER trg_bitacora AFTER INSERT OR DELETE OR UPDATE ON public.transaccionalidad FOR EACH ROW EXECUTE FUNCTION fn_bitacora();
alter table public.beneficiarios enable row level security;
alter table public.bitacora enable row level security;
alter table public.cliente_bloqueos enable row level security;
alter table public.cliente_bloqueos_historico enable row level security;
alter table public.clientes enable row level security;
alter table public.codigos_alias enable row level security;
alter table public.cuenta_titulares enable row level security;
alter table public.cuenta_titulares_historico enable row level security;
alter table public.cuentas_ibkr enable row level security;
alter table public.cuentas_ibkr_historico enable row level security;
alter table public.documentos_expediente enable row level security;
alter table public.documentos_expediente_historico enable row level security;
alter table public.ebr_evaluaciones enable row level security;
alter table public.firmas_cumplimiento enable row level security;
alter table public.firmas_cumplimiento_historico enable row level security;
alter table public.kyc_detalle enable row level security;
alter table public.listas_coincidencias enable row level security;
alter table public.listas_control enable row level security;
alter table public.listas_registros enable row level security;
alter table public.pep_listas enable row level security;
alter table public.perfil_riesgo enable row level security;
alter table public.perfil_riesgo_historico enable row level security;
alter table public.personas enable row level security;
alter table public.personas_historico enable row level security;
alter table public.portafolios enable row level security;
alter table public.propietario_real enable row level security;
alter table public.transaccionalidad enable row level security;
create policy benef_insert_auth on public.beneficiarios as permissive for insert to authenticated with check (true);
create policy benef_select_auth on public.beneficiarios as permissive for select to authenticated using (true);
create policy benef_update_auth on public.beneficiarios as permissive for update to authenticated using (true) with check (true);
create policy bitacora_insert_auth on public.bitacora as permissive for insert to authenticated with check (true);
create policy bitacora_select_auth on public.bitacora as permissive for select to authenticated using (true);
create policy bloqueos_historico_select_auth on public.cliente_bloqueos_historico as permissive for select to authenticated using (true);
create policy bloqueos_select_auth on public.cliente_bloqueos as permissive for select to authenticated using (true);
create policy clientes_insert_auth on public.clientes as permissive for insert to authenticated with check (true);
create policy clientes_select_auth on public.clientes as permissive for select to authenticated using (true);
create policy clientes_update_auth on public.clientes as permissive for update to authenticated using (true) with check (true);
create policy leads_publico_insert on public.clientes as permissive for insert to anon with check ((status = 'lead_nuevo'::text));
create policy codigos_alias_select_auth on public.codigos_alias as permissive for select to authenticated using (true);
create policy cuenta_titulares_historico_select_auth on public.cuenta_titulares_historico as permissive for select to authenticated using (true);
create policy cuenta_titulares_select_auth on public.cuenta_titulares as permissive for select to authenticated using (true);
create policy cuentas_ibkr_historico_select_auth on public.cuentas_ibkr_historico as permissive for select to authenticated using (true);
create policy cuentas_ibkr_select_auth on public.cuentas_ibkr as permissive for select to authenticated using (true);
create policy documentos_historico_select_auth on public.documentos_expediente_historico as permissive for select to authenticated using (true);
create policy documentos_select_auth on public.documentos_expediente as permissive for select to authenticated using (true);
create policy ebr_insert_auth on public.ebr_evaluaciones as permissive for insert to authenticated with check (true);
create policy ebr_select_auth on public.ebr_evaluaciones as permissive for select to authenticated using (true);
create policy firmas_historico_select_auth on public.firmas_cumplimiento_historico as permissive for select to authenticated using (true);
create policy firmas_select_auth on public.firmas_cumplimiento as permissive for select to authenticated using (true);
create policy kyc_insert_auth on public.kyc_detalle as permissive for insert to authenticated with check (true);
create policy kyc_select_auth on public.kyc_detalle as permissive for select to authenticated using (true);
create policy kyc_update_auth on public.kyc_detalle as permissive for update to authenticated using (true) with check (true);
create policy listas_coinc_ins on public.listas_coincidencias as permissive for insert to authenticated with check (true);
create policy listas_coinc_sel on public.listas_coincidencias as permissive for select to authenticated using (true);
create policy listas_coinc_upd on public.listas_coincidencias as permissive for update to authenticated using (true) with check (true);
create policy listas_control_ins on public.listas_control as permissive for insert to authenticated with check (true);
create policy listas_control_sel on public.listas_control as permissive for select to authenticated using (true);
create policy listas_control_upd on public.listas_control as permissive for update to authenticated using (true) with check (true);
create policy listas_registros_ins on public.listas_registros as permissive for insert to authenticated with check (true);
create policy listas_registros_sel on public.listas_registros as permissive for select to authenticated using (true);
create policy pep_insert_auth on public.pep_listas as permissive for insert to authenticated with check (true);
create policy pep_select_auth on public.pep_listas as permissive for select to authenticated using (true);
create policy pep_update_auth on public.pep_listas as permissive for update to authenticated using (true) with check (true);
create policy perfil_historico_select_auth on public.perfil_riesgo_historico as permissive for select to authenticated using (true);
create policy perfil_insert_auth on public.perfil_riesgo as permissive for insert to authenticated with check (true);
create policy perfil_select_auth on public.perfil_riesgo as permissive for select to authenticated using (true);
create policy perfil_update_auth on public.perfil_riesgo as permissive for update to authenticated using (true) with check (true);
create policy personas_historico_select_auth on public.personas_historico as permissive for select to authenticated using (true);
create policy personas_select_auth on public.personas as permissive for select to authenticated using (true);
create policy portafolios_insert_auth on public.portafolios as permissive for insert to authenticated with check (true);
create policy portafolios_select_auth on public.portafolios as permissive for select to authenticated using (true);
create policy portafolios_update_auth on public.portafolios as permissive for update to authenticated using (true) with check (true);
create policy prop_insert_auth on public.propietario_real as permissive for insert to authenticated with check (true);
create policy prop_select_auth on public.propietario_real as permissive for select to authenticated using (true);
create policy prop_update_auth on public.propietario_real as permissive for update to authenticated using (true) with check (true);
create policy transacc_insert_auth on public.transaccionalidad as permissive for insert to authenticated with check (true);
create policy transacc_select_auth on public.transaccionalidad as permissive for select to authenticated using (true);
create policy transacc_update_auth on public.transaccionalidad as permissive for update to authenticated using (true) with check (true);
revoke all on public.beneficiarios from public, anon, authenticated, service_role;
grant DELETE on public.beneficiarios to anon;
grant DELETE on public.beneficiarios to authenticated;
grant DELETE on public.beneficiarios to service_role;
grant INSERT on public.beneficiarios to anon;
grant INSERT on public.beneficiarios to authenticated;
grant INSERT on public.beneficiarios to service_role;
grant MAINTAIN on public.beneficiarios to anon;
grant MAINTAIN on public.beneficiarios to authenticated;
grant MAINTAIN on public.beneficiarios to service_role;
grant REFERENCES on public.beneficiarios to anon;
grant REFERENCES on public.beneficiarios to authenticated;
grant REFERENCES on public.beneficiarios to service_role;
grant SELECT on public.beneficiarios to anon;
grant SELECT on public.beneficiarios to authenticated;
grant SELECT on public.beneficiarios to service_role;
grant TRIGGER on public.beneficiarios to anon;
grant TRIGGER on public.beneficiarios to authenticated;
grant TRIGGER on public.beneficiarios to service_role;
grant TRUNCATE on public.beneficiarios to anon;
grant TRUNCATE on public.beneficiarios to authenticated;
grant TRUNCATE on public.beneficiarios to service_role;
grant UPDATE on public.beneficiarios to anon;
grant UPDATE on public.beneficiarios to authenticated;
grant UPDATE on public.beneficiarios to service_role;
revoke all on public.bitacora from public, anon, authenticated, service_role;
grant DELETE on public.bitacora to anon;
grant DELETE on public.bitacora to authenticated;
grant DELETE on public.bitacora to service_role;
grant INSERT on public.bitacora to anon;
grant INSERT on public.bitacora to authenticated;
grant INSERT on public.bitacora to service_role;
grant MAINTAIN on public.bitacora to anon;
grant MAINTAIN on public.bitacora to authenticated;
grant MAINTAIN on public.bitacora to service_role;
grant REFERENCES on public.bitacora to anon;
grant REFERENCES on public.bitacora to authenticated;
grant REFERENCES on public.bitacora to service_role;
grant SELECT on public.bitacora to anon;
grant SELECT on public.bitacora to authenticated;
grant SELECT on public.bitacora to service_role;
grant TRIGGER on public.bitacora to anon;
grant TRIGGER on public.bitacora to authenticated;
grant TRIGGER on public.bitacora to service_role;
grant TRUNCATE on public.bitacora to anon;
grant TRUNCATE on public.bitacora to authenticated;
grant TRUNCATE on public.bitacora to service_role;
grant UPDATE on public.bitacora to anon;
grant UPDATE on public.bitacora to authenticated;
grant UPDATE on public.bitacora to service_role;
revoke all on public.cliente_bloqueos from public, anon, authenticated, service_role;
grant DELETE on public.cliente_bloqueos to service_role;
grant INSERT on public.cliente_bloqueos to service_role;
grant MAINTAIN on public.cliente_bloqueos to anon;
grant MAINTAIN on public.cliente_bloqueos to authenticated;
grant MAINTAIN on public.cliente_bloqueos to service_role;
grant REFERENCES on public.cliente_bloqueos to anon;
grant REFERENCES on public.cliente_bloqueos to authenticated;
grant REFERENCES on public.cliente_bloqueos to service_role;
grant SELECT on public.cliente_bloqueos to anon;
grant SELECT on public.cliente_bloqueos to authenticated;
grant SELECT on public.cliente_bloqueos to service_role;
grant TRIGGER on public.cliente_bloqueos to anon;
grant TRIGGER on public.cliente_bloqueos to authenticated;
grant TRIGGER on public.cliente_bloqueos to service_role;
grant TRUNCATE on public.cliente_bloqueos to anon;
grant TRUNCATE on public.cliente_bloqueos to authenticated;
grant TRUNCATE on public.cliente_bloqueos to service_role;
grant UPDATE on public.cliente_bloqueos to service_role;
revoke all on public.cliente_bloqueos_historico from public, anon, authenticated, service_role;
grant DELETE on public.cliente_bloqueos_historico to service_role;
grant INSERT on public.cliente_bloqueos_historico to service_role;
grant MAINTAIN on public.cliente_bloqueos_historico to anon;
grant MAINTAIN on public.cliente_bloqueos_historico to authenticated;
grant MAINTAIN on public.cliente_bloqueos_historico to service_role;
grant REFERENCES on public.cliente_bloqueos_historico to anon;
grant REFERENCES on public.cliente_bloqueos_historico to authenticated;
grant REFERENCES on public.cliente_bloqueos_historico to service_role;
grant SELECT on public.cliente_bloqueos_historico to anon;
grant SELECT on public.cliente_bloqueos_historico to authenticated;
grant SELECT on public.cliente_bloqueos_historico to service_role;
grant TRIGGER on public.cliente_bloqueos_historico to anon;
grant TRIGGER on public.cliente_bloqueos_historico to authenticated;
grant TRIGGER on public.cliente_bloqueos_historico to service_role;
grant TRUNCATE on public.cliente_bloqueos_historico to anon;
grant TRUNCATE on public.cliente_bloqueos_historico to authenticated;
grant TRUNCATE on public.cliente_bloqueos_historico to service_role;
grant UPDATE on public.cliente_bloqueos_historico to service_role;
revoke all on public.clientes from public, anon, authenticated, service_role;
grant DELETE on public.clientes to anon;
grant DELETE on public.clientes to authenticated;
grant DELETE on public.clientes to service_role;
grant INSERT on public.clientes to anon;
grant INSERT on public.clientes to authenticated;
grant INSERT on public.clientes to service_role;
grant MAINTAIN on public.clientes to anon;
grant MAINTAIN on public.clientes to authenticated;
grant MAINTAIN on public.clientes to service_role;
grant REFERENCES on public.clientes to anon;
grant REFERENCES on public.clientes to authenticated;
grant REFERENCES on public.clientes to service_role;
grant SELECT on public.clientes to anon;
grant SELECT on public.clientes to authenticated;
grant SELECT on public.clientes to service_role;
grant TRIGGER on public.clientes to anon;
grant TRIGGER on public.clientes to authenticated;
grant TRIGGER on public.clientes to service_role;
grant TRUNCATE on public.clientes to anon;
grant TRUNCATE on public.clientes to authenticated;
grant TRUNCATE on public.clientes to service_role;
grant UPDATE on public.clientes to anon;
grant UPDATE on public.clientes to authenticated;
grant UPDATE on public.clientes to service_role;
revoke all on public.codigos_alias from public, anon, authenticated, service_role;
grant DELETE on public.codigos_alias to anon;
grant DELETE on public.codigos_alias to authenticated;
grant DELETE on public.codigos_alias to service_role;
grant INSERT on public.codigos_alias to anon;
grant INSERT on public.codigos_alias to authenticated;
grant INSERT on public.codigos_alias to service_role;
grant MAINTAIN on public.codigos_alias to anon;
grant MAINTAIN on public.codigos_alias to authenticated;
grant MAINTAIN on public.codigos_alias to service_role;
grant REFERENCES on public.codigos_alias to anon;
grant REFERENCES on public.codigos_alias to authenticated;
grant REFERENCES on public.codigos_alias to service_role;
grant SELECT on public.codigos_alias to anon;
grant SELECT on public.codigos_alias to authenticated;
grant SELECT on public.codigos_alias to service_role;
grant TRIGGER on public.codigos_alias to anon;
grant TRIGGER on public.codigos_alias to authenticated;
grant TRIGGER on public.codigos_alias to service_role;
grant TRUNCATE on public.codigos_alias to anon;
grant TRUNCATE on public.codigos_alias to authenticated;
grant TRUNCATE on public.codigos_alias to service_role;
grant UPDATE on public.codigos_alias to anon;
grant UPDATE on public.codigos_alias to authenticated;
grant UPDATE on public.codigos_alias to service_role;
revoke all on public.cuenta_titulares from public, anon, authenticated, service_role;
grant DELETE on public.cuenta_titulares to service_role;
grant INSERT on public.cuenta_titulares to service_role;
grant MAINTAIN on public.cuenta_titulares to authenticated;
grant MAINTAIN on public.cuenta_titulares to service_role;
grant REFERENCES on public.cuenta_titulares to service_role;
grant SELECT on public.cuenta_titulares to authenticated;
grant SELECT on public.cuenta_titulares to service_role;
grant TRIGGER on public.cuenta_titulares to service_role;
grant TRUNCATE on public.cuenta_titulares to service_role;
grant UPDATE on public.cuenta_titulares to service_role;
revoke all on public.cuenta_titulares_historico from public, anon, authenticated, service_role;
grant DELETE on public.cuenta_titulares_historico to service_role;
grant INSERT on public.cuenta_titulares_historico to service_role;
grant MAINTAIN on public.cuenta_titulares_historico to authenticated;
grant MAINTAIN on public.cuenta_titulares_historico to service_role;
grant REFERENCES on public.cuenta_titulares_historico to service_role;
grant SELECT on public.cuenta_titulares_historico to authenticated;
grant SELECT on public.cuenta_titulares_historico to service_role;
grant TRIGGER on public.cuenta_titulares_historico to service_role;
grant TRUNCATE on public.cuenta_titulares_historico to service_role;
grant UPDATE on public.cuenta_titulares_historico to service_role;
revoke all on public.cuentas_ibkr from public, anon, authenticated, service_role;
grant DELETE on public.cuentas_ibkr to service_role;
grant INSERT on public.cuentas_ibkr to service_role;
grant MAINTAIN on public.cuentas_ibkr to authenticated;
grant MAINTAIN on public.cuentas_ibkr to service_role;
grant REFERENCES on public.cuentas_ibkr to service_role;
grant SELECT on public.cuentas_ibkr to authenticated;
grant SELECT on public.cuentas_ibkr to service_role;
grant TRIGGER on public.cuentas_ibkr to service_role;
grant TRUNCATE on public.cuentas_ibkr to service_role;
grant UPDATE on public.cuentas_ibkr to service_role;
revoke all on public.cuentas_ibkr_historico from public, anon, authenticated, service_role;
grant DELETE on public.cuentas_ibkr_historico to service_role;
grant INSERT on public.cuentas_ibkr_historico to service_role;
grant MAINTAIN on public.cuentas_ibkr_historico to authenticated;
grant MAINTAIN on public.cuentas_ibkr_historico to service_role;
grant REFERENCES on public.cuentas_ibkr_historico to service_role;
grant SELECT on public.cuentas_ibkr_historico to authenticated;
grant SELECT on public.cuentas_ibkr_historico to service_role;
grant TRIGGER on public.cuentas_ibkr_historico to service_role;
grant TRUNCATE on public.cuentas_ibkr_historico to service_role;
grant UPDATE on public.cuentas_ibkr_historico to service_role;
revoke all on public.documentos_expediente from public, anon, authenticated, service_role;
grant DELETE on public.documentos_expediente to service_role;
grant INSERT on public.documentos_expediente to service_role;
grant MAINTAIN on public.documentos_expediente to authenticated;
grant MAINTAIN on public.documentos_expediente to service_role;
grant REFERENCES on public.documentos_expediente to service_role;
grant SELECT on public.documentos_expediente to authenticated;
grant SELECT on public.documentos_expediente to service_role;
grant TRIGGER on public.documentos_expediente to service_role;
grant TRUNCATE on public.documentos_expediente to service_role;
grant UPDATE on public.documentos_expediente to service_role;
revoke all on public.documentos_expediente_historico from public, anon, authenticated, service_role;
grant DELETE on public.documentos_expediente_historico to service_role;
grant INSERT on public.documentos_expediente_historico to service_role;
grant MAINTAIN on public.documentos_expediente_historico to authenticated;
grant MAINTAIN on public.documentos_expediente_historico to service_role;
grant REFERENCES on public.documentos_expediente_historico to service_role;
grant SELECT on public.documentos_expediente_historico to authenticated;
grant SELECT on public.documentos_expediente_historico to service_role;
grant TRIGGER on public.documentos_expediente_historico to service_role;
grant TRUNCATE on public.documentos_expediente_historico to service_role;
grant UPDATE on public.documentos_expediente_historico to service_role;
revoke all on public.ebr_evaluaciones from public, anon, authenticated, service_role;
grant DELETE on public.ebr_evaluaciones to anon;
grant DELETE on public.ebr_evaluaciones to authenticated;
grant DELETE on public.ebr_evaluaciones to service_role;
grant INSERT on public.ebr_evaluaciones to anon;
grant INSERT on public.ebr_evaluaciones to authenticated;
grant INSERT on public.ebr_evaluaciones to service_role;
grant MAINTAIN on public.ebr_evaluaciones to anon;
grant MAINTAIN on public.ebr_evaluaciones to authenticated;
grant MAINTAIN on public.ebr_evaluaciones to service_role;
grant REFERENCES on public.ebr_evaluaciones to anon;
grant REFERENCES on public.ebr_evaluaciones to authenticated;
grant REFERENCES on public.ebr_evaluaciones to service_role;
grant SELECT on public.ebr_evaluaciones to anon;
grant SELECT on public.ebr_evaluaciones to authenticated;
grant SELECT on public.ebr_evaluaciones to service_role;
grant TRIGGER on public.ebr_evaluaciones to anon;
grant TRIGGER on public.ebr_evaluaciones to authenticated;
grant TRIGGER on public.ebr_evaluaciones to service_role;
grant TRUNCATE on public.ebr_evaluaciones to anon;
grant TRUNCATE on public.ebr_evaluaciones to authenticated;
grant TRUNCATE on public.ebr_evaluaciones to service_role;
grant UPDATE on public.ebr_evaluaciones to anon;
grant UPDATE on public.ebr_evaluaciones to authenticated;
grant UPDATE on public.ebr_evaluaciones to service_role;
revoke all on public.firmas_cumplimiento from public, anon, authenticated, service_role;
grant DELETE on public.firmas_cumplimiento to service_role;
grant INSERT on public.firmas_cumplimiento to service_role;
grant MAINTAIN on public.firmas_cumplimiento to anon;
grant MAINTAIN on public.firmas_cumplimiento to authenticated;
grant MAINTAIN on public.firmas_cumplimiento to service_role;
grant REFERENCES on public.firmas_cumplimiento to anon;
grant REFERENCES on public.firmas_cumplimiento to authenticated;
grant REFERENCES on public.firmas_cumplimiento to service_role;
grant SELECT on public.firmas_cumplimiento to anon;
grant SELECT on public.firmas_cumplimiento to authenticated;
grant SELECT on public.firmas_cumplimiento to service_role;
grant TRIGGER on public.firmas_cumplimiento to anon;
grant TRIGGER on public.firmas_cumplimiento to authenticated;
grant TRIGGER on public.firmas_cumplimiento to service_role;
grant TRUNCATE on public.firmas_cumplimiento to anon;
grant TRUNCATE on public.firmas_cumplimiento to authenticated;
grant TRUNCATE on public.firmas_cumplimiento to service_role;
grant UPDATE on public.firmas_cumplimiento to service_role;
revoke all on public.firmas_cumplimiento_historico from public, anon, authenticated, service_role;
grant DELETE on public.firmas_cumplimiento_historico to service_role;
grant INSERT on public.firmas_cumplimiento_historico to service_role;
grant MAINTAIN on public.firmas_cumplimiento_historico to anon;
grant MAINTAIN on public.firmas_cumplimiento_historico to authenticated;
grant MAINTAIN on public.firmas_cumplimiento_historico to service_role;
grant REFERENCES on public.firmas_cumplimiento_historico to anon;
grant REFERENCES on public.firmas_cumplimiento_historico to authenticated;
grant REFERENCES on public.firmas_cumplimiento_historico to service_role;
grant SELECT on public.firmas_cumplimiento_historico to anon;
grant SELECT on public.firmas_cumplimiento_historico to authenticated;
grant SELECT on public.firmas_cumplimiento_historico to service_role;
grant TRIGGER on public.firmas_cumplimiento_historico to anon;
grant TRIGGER on public.firmas_cumplimiento_historico to authenticated;
grant TRIGGER on public.firmas_cumplimiento_historico to service_role;
grant TRUNCATE on public.firmas_cumplimiento_historico to anon;
grant TRUNCATE on public.firmas_cumplimiento_historico to authenticated;
grant TRUNCATE on public.firmas_cumplimiento_historico to service_role;
grant UPDATE on public.firmas_cumplimiento_historico to service_role;
revoke all on public.kyc_detalle from public, anon, authenticated, service_role;
grant DELETE on public.kyc_detalle to anon;
grant DELETE on public.kyc_detalle to authenticated;
grant DELETE on public.kyc_detalle to service_role;
grant INSERT on public.kyc_detalle to anon;
grant INSERT on public.kyc_detalle to authenticated;
grant INSERT on public.kyc_detalle to service_role;
grant MAINTAIN on public.kyc_detalle to anon;
grant MAINTAIN on public.kyc_detalle to authenticated;
grant MAINTAIN on public.kyc_detalle to service_role;
grant REFERENCES on public.kyc_detalle to anon;
grant REFERENCES on public.kyc_detalle to authenticated;
grant REFERENCES on public.kyc_detalle to service_role;
grant SELECT on public.kyc_detalle to anon;
grant SELECT on public.kyc_detalle to authenticated;
grant SELECT on public.kyc_detalle to service_role;
grant TRIGGER on public.kyc_detalle to anon;
grant TRIGGER on public.kyc_detalle to authenticated;
grant TRIGGER on public.kyc_detalle to service_role;
grant TRUNCATE on public.kyc_detalle to anon;
grant TRUNCATE on public.kyc_detalle to authenticated;
grant TRUNCATE on public.kyc_detalle to service_role;
grant UPDATE on public.kyc_detalle to anon;
grant UPDATE on public.kyc_detalle to authenticated;
grant UPDATE on public.kyc_detalle to service_role;
revoke all on public.listas_coincidencias from public, anon, authenticated, service_role;
grant DELETE on public.listas_coincidencias to anon;
grant DELETE on public.listas_coincidencias to authenticated;
grant DELETE on public.listas_coincidencias to service_role;
grant INSERT on public.listas_coincidencias to anon;
grant INSERT on public.listas_coincidencias to authenticated;
grant INSERT on public.listas_coincidencias to service_role;
grant MAINTAIN on public.listas_coincidencias to anon;
grant MAINTAIN on public.listas_coincidencias to authenticated;
grant MAINTAIN on public.listas_coincidencias to service_role;
grant REFERENCES on public.listas_coincidencias to anon;
grant REFERENCES on public.listas_coincidencias to authenticated;
grant REFERENCES on public.listas_coincidencias to service_role;
grant SELECT on public.listas_coincidencias to anon;
grant SELECT on public.listas_coincidencias to authenticated;
grant SELECT on public.listas_coincidencias to service_role;
grant TRIGGER on public.listas_coincidencias to anon;
grant TRIGGER on public.listas_coincidencias to authenticated;
grant TRIGGER on public.listas_coincidencias to service_role;
grant TRUNCATE on public.listas_coincidencias to anon;
grant TRUNCATE on public.listas_coincidencias to authenticated;
grant TRUNCATE on public.listas_coincidencias to service_role;
grant UPDATE on public.listas_coincidencias to anon;
grant UPDATE on public.listas_coincidencias to authenticated;
grant UPDATE on public.listas_coincidencias to service_role;
revoke all on public.listas_control from public, anon, authenticated, service_role;
grant DELETE on public.listas_control to anon;
grant DELETE on public.listas_control to authenticated;
grant DELETE on public.listas_control to service_role;
grant INSERT on public.listas_control to anon;
grant INSERT on public.listas_control to authenticated;
grant INSERT on public.listas_control to service_role;
grant MAINTAIN on public.listas_control to anon;
grant MAINTAIN on public.listas_control to authenticated;
grant MAINTAIN on public.listas_control to service_role;
grant REFERENCES on public.listas_control to anon;
grant REFERENCES on public.listas_control to authenticated;
grant REFERENCES on public.listas_control to service_role;
grant SELECT on public.listas_control to anon;
grant SELECT on public.listas_control to authenticated;
grant SELECT on public.listas_control to service_role;
grant TRIGGER on public.listas_control to anon;
grant TRIGGER on public.listas_control to authenticated;
grant TRIGGER on public.listas_control to service_role;
grant TRUNCATE on public.listas_control to anon;
grant TRUNCATE on public.listas_control to authenticated;
grant TRUNCATE on public.listas_control to service_role;
grant UPDATE on public.listas_control to anon;
grant UPDATE on public.listas_control to authenticated;
grant UPDATE on public.listas_control to service_role;
revoke all on public.listas_registros from public, anon, authenticated, service_role;
grant DELETE on public.listas_registros to anon;
grant DELETE on public.listas_registros to authenticated;
grant DELETE on public.listas_registros to service_role;
grant INSERT on public.listas_registros to anon;
grant INSERT on public.listas_registros to authenticated;
grant INSERT on public.listas_registros to service_role;
grant MAINTAIN on public.listas_registros to anon;
grant MAINTAIN on public.listas_registros to authenticated;
grant MAINTAIN on public.listas_registros to service_role;
grant REFERENCES on public.listas_registros to anon;
grant REFERENCES on public.listas_registros to authenticated;
grant REFERENCES on public.listas_registros to service_role;
grant SELECT on public.listas_registros to anon;
grant SELECT on public.listas_registros to authenticated;
grant SELECT on public.listas_registros to service_role;
grant TRIGGER on public.listas_registros to anon;
grant TRIGGER on public.listas_registros to authenticated;
grant TRIGGER on public.listas_registros to service_role;
grant TRUNCATE on public.listas_registros to anon;
grant TRUNCATE on public.listas_registros to authenticated;
grant TRUNCATE on public.listas_registros to service_role;
grant UPDATE on public.listas_registros to anon;
grant UPDATE on public.listas_registros to authenticated;
grant UPDATE on public.listas_registros to service_role;
revoke all on public.pep_listas from public, anon, authenticated, service_role;
grant DELETE on public.pep_listas to anon;
grant DELETE on public.pep_listas to authenticated;
grant DELETE on public.pep_listas to service_role;
grant INSERT on public.pep_listas to anon;
grant INSERT on public.pep_listas to authenticated;
grant INSERT on public.pep_listas to service_role;
grant MAINTAIN on public.pep_listas to anon;
grant MAINTAIN on public.pep_listas to authenticated;
grant MAINTAIN on public.pep_listas to service_role;
grant REFERENCES on public.pep_listas to anon;
grant REFERENCES on public.pep_listas to authenticated;
grant REFERENCES on public.pep_listas to service_role;
grant SELECT on public.pep_listas to anon;
grant SELECT on public.pep_listas to authenticated;
grant SELECT on public.pep_listas to service_role;
grant TRIGGER on public.pep_listas to anon;
grant TRIGGER on public.pep_listas to authenticated;
grant TRIGGER on public.pep_listas to service_role;
grant TRUNCATE on public.pep_listas to anon;
grant TRUNCATE on public.pep_listas to authenticated;
grant TRUNCATE on public.pep_listas to service_role;
grant UPDATE on public.pep_listas to anon;
grant UPDATE on public.pep_listas to authenticated;
grant UPDATE on public.pep_listas to service_role;
revoke all on public.perfil_riesgo from public, anon, authenticated, service_role;
grant DELETE on public.perfil_riesgo to anon;
grant DELETE on public.perfil_riesgo to authenticated;
grant DELETE on public.perfil_riesgo to service_role;
grant INSERT on public.perfil_riesgo to anon;
grant INSERT on public.perfil_riesgo to authenticated;
grant INSERT on public.perfil_riesgo to service_role;
grant MAINTAIN on public.perfil_riesgo to anon;
grant MAINTAIN on public.perfil_riesgo to authenticated;
grant MAINTAIN on public.perfil_riesgo to service_role;
grant REFERENCES on public.perfil_riesgo to anon;
grant REFERENCES on public.perfil_riesgo to authenticated;
grant REFERENCES on public.perfil_riesgo to service_role;
grant SELECT on public.perfil_riesgo to anon;
grant SELECT on public.perfil_riesgo to authenticated;
grant SELECT on public.perfil_riesgo to service_role;
grant TRIGGER on public.perfil_riesgo to anon;
grant TRIGGER on public.perfil_riesgo to authenticated;
grant TRIGGER on public.perfil_riesgo to service_role;
grant TRUNCATE on public.perfil_riesgo to anon;
grant TRUNCATE on public.perfil_riesgo to authenticated;
grant TRUNCATE on public.perfil_riesgo to service_role;
grant UPDATE on public.perfil_riesgo to anon;
grant UPDATE on public.perfil_riesgo to authenticated;
grant UPDATE on public.perfil_riesgo to service_role;
revoke all on public.perfil_riesgo_historico from public, anon, authenticated, service_role;
grant DELETE on public.perfil_riesgo_historico to service_role;
grant INSERT on public.perfil_riesgo_historico to service_role;
grant MAINTAIN on public.perfil_riesgo_historico to anon;
grant MAINTAIN on public.perfil_riesgo_historico to authenticated;
grant MAINTAIN on public.perfil_riesgo_historico to service_role;
grant REFERENCES on public.perfil_riesgo_historico to anon;
grant REFERENCES on public.perfil_riesgo_historico to authenticated;
grant REFERENCES on public.perfil_riesgo_historico to service_role;
grant SELECT on public.perfil_riesgo_historico to anon;
grant SELECT on public.perfil_riesgo_historico to authenticated;
grant SELECT on public.perfil_riesgo_historico to service_role;
grant TRIGGER on public.perfil_riesgo_historico to anon;
grant TRIGGER on public.perfil_riesgo_historico to authenticated;
grant TRIGGER on public.perfil_riesgo_historico to service_role;
grant TRUNCATE on public.perfil_riesgo_historico to anon;
grant TRUNCATE on public.perfil_riesgo_historico to authenticated;
grant TRUNCATE on public.perfil_riesgo_historico to service_role;
grant UPDATE on public.perfil_riesgo_historico to service_role;
revoke all on public.personas from public, anon, authenticated, service_role;
grant DELETE on public.personas to service_role;
grant INSERT on public.personas to service_role;
grant MAINTAIN on public.personas to authenticated;
grant MAINTAIN on public.personas to service_role;
grant REFERENCES on public.personas to service_role;
grant SELECT on public.personas to authenticated;
grant SELECT on public.personas to service_role;
grant TRIGGER on public.personas to service_role;
grant TRUNCATE on public.personas to service_role;
grant UPDATE on public.personas to service_role;
revoke all on public.personas_historico from public, anon, authenticated, service_role;
grant DELETE on public.personas_historico to service_role;
grant INSERT on public.personas_historico to service_role;
grant MAINTAIN on public.personas_historico to authenticated;
grant MAINTAIN on public.personas_historico to service_role;
grant REFERENCES on public.personas_historico to service_role;
grant SELECT on public.personas_historico to authenticated;
grant SELECT on public.personas_historico to service_role;
grant TRIGGER on public.personas_historico to service_role;
grant TRUNCATE on public.personas_historico to service_role;
grant UPDATE on public.personas_historico to service_role;
revoke all on public.portafolios from public, anon, authenticated, service_role;
grant DELETE on public.portafolios to anon;
grant DELETE on public.portafolios to authenticated;
grant DELETE on public.portafolios to service_role;
grant INSERT on public.portafolios to anon;
grant INSERT on public.portafolios to authenticated;
grant INSERT on public.portafolios to service_role;
grant MAINTAIN on public.portafolios to anon;
grant MAINTAIN on public.portafolios to authenticated;
grant MAINTAIN on public.portafolios to service_role;
grant REFERENCES on public.portafolios to anon;
grant REFERENCES on public.portafolios to authenticated;
grant REFERENCES on public.portafolios to service_role;
grant SELECT on public.portafolios to anon;
grant SELECT on public.portafolios to authenticated;
grant SELECT on public.portafolios to service_role;
grant TRIGGER on public.portafolios to anon;
grant TRIGGER on public.portafolios to authenticated;
grant TRIGGER on public.portafolios to service_role;
grant TRUNCATE on public.portafolios to anon;
grant TRUNCATE on public.portafolios to authenticated;
grant TRUNCATE on public.portafolios to service_role;
grant UPDATE on public.portafolios to anon;
grant UPDATE on public.portafolios to authenticated;
grant UPDATE on public.portafolios to service_role;
revoke all on public.propietario_real from public, anon, authenticated, service_role;
grant DELETE on public.propietario_real to anon;
grant DELETE on public.propietario_real to authenticated;
grant DELETE on public.propietario_real to service_role;
grant INSERT on public.propietario_real to anon;
grant INSERT on public.propietario_real to authenticated;
grant INSERT on public.propietario_real to service_role;
grant MAINTAIN on public.propietario_real to anon;
grant MAINTAIN on public.propietario_real to authenticated;
grant MAINTAIN on public.propietario_real to service_role;
grant REFERENCES on public.propietario_real to anon;
grant REFERENCES on public.propietario_real to authenticated;
grant REFERENCES on public.propietario_real to service_role;
grant SELECT on public.propietario_real to anon;
grant SELECT on public.propietario_real to authenticated;
grant SELECT on public.propietario_real to service_role;
grant TRIGGER on public.propietario_real to anon;
grant TRIGGER on public.propietario_real to authenticated;
grant TRIGGER on public.propietario_real to service_role;
grant TRUNCATE on public.propietario_real to anon;
grant TRUNCATE on public.propietario_real to authenticated;
grant TRUNCATE on public.propietario_real to service_role;
grant UPDATE on public.propietario_real to anon;
grant UPDATE on public.propietario_real to authenticated;
grant UPDATE on public.propietario_real to service_role;
revoke all on public.transaccionalidad from public, anon, authenticated, service_role;
grant DELETE on public.transaccionalidad to anon;
grant DELETE on public.transaccionalidad to authenticated;
grant DELETE on public.transaccionalidad to service_role;
grant INSERT on public.transaccionalidad to anon;
grant INSERT on public.transaccionalidad to authenticated;
grant INSERT on public.transaccionalidad to service_role;
grant MAINTAIN on public.transaccionalidad to anon;
grant MAINTAIN on public.transaccionalidad to authenticated;
grant MAINTAIN on public.transaccionalidad to service_role;
grant REFERENCES on public.transaccionalidad to anon;
grant REFERENCES on public.transaccionalidad to authenticated;
grant REFERENCES on public.transaccionalidad to service_role;
grant SELECT on public.transaccionalidad to anon;
grant SELECT on public.transaccionalidad to authenticated;
grant SELECT on public.transaccionalidad to service_role;
grant TRIGGER on public.transaccionalidad to anon;
grant TRIGGER on public.transaccionalidad to authenticated;
grant TRIGGER on public.transaccionalidad to service_role;
grant TRUNCATE on public.transaccionalidad to anon;
grant TRUNCATE on public.transaccionalidad to authenticated;
grant TRUNCATE on public.transaccionalidad to service_role;
grant UPDATE on public.transaccionalidad to anon;
grant UPDATE on public.transaccionalidad to authenticated;
grant UPDATE on public.transaccionalidad to service_role;
revoke all on function fn_archivar_bloqueos() from public, anon, authenticated, service_role;
grant execute on function fn_archivar_bloqueos() to service_role;
revoke all on function fn_archivar_cuenta_titulares() from public, anon, authenticated, service_role;
grant execute on function fn_archivar_cuenta_titulares() to service_role;
revoke all on function fn_archivar_cuentas_ibkr() from public, anon, authenticated, service_role;
grant execute on function fn_archivar_cuentas_ibkr() to service_role;
revoke all on function fn_archivar_documentos() from public, anon, authenticated, service_role;
grant execute on function fn_archivar_documentos() to service_role;
revoke all on function fn_archivar_firmas() from public, anon, authenticated, service_role;
grant execute on function fn_archivar_firmas() to service_role;
revoke all on function fn_archivar_perfil_riesgo() from public, anon, authenticated, service_role;
grant execute on function fn_archivar_perfil_riesgo() to service_role;
revoke all on function fn_archivar_personas() from public, anon, authenticated, service_role;
grant execute on function fn_archivar_personas() to service_role;
revoke all on function fn_bitacora() from public, anon, authenticated, service_role;
grant execute on function fn_bitacora() to service_role;
revoke all on function fn_firmante_sesion() from public, anon, authenticated, service_role;
grant execute on function fn_firmante_sesion() to authenticated;
grant execute on function fn_firmante_sesion() to service_role;
revoke all on function fn_levantar_bloqueo(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function fn_levantar_bloqueo(uuid,text,text,text,text) to authenticated;
grant execute on function fn_levantar_bloqueo(uuid,text,text,text,text) to service_role;
revoke all on function fn_registrar_consulta_documento(uuid) from public, anon, authenticated, service_role;
grant execute on function fn_registrar_consulta_documento(uuid) to authenticated;
grant execute on function fn_registrar_consulta_documento(uuid) to service_role;
revoke all on function fn_registrar_documento(text,text,text,text,integer,date,uuid) from public, anon, authenticated, service_role;
grant execute on function fn_registrar_documento(text,text,text,text,integer,date,uuid) to authenticated;
grant execute on function fn_registrar_documento(text,text,text,text,integer,date,uuid) to service_role;
revoke all on function fn_resolver_coincidencia(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function fn_resolver_coincidencia(uuid,text,text,text,text) to authenticated;
grant execute on function fn_resolver_coincidencia(uuid,text,text,text,text) to service_role;
revoke all on function fn_tipos_sanciones() from public, anon, authenticated, service_role;
grant execute on function fn_tipos_sanciones() to authenticated;
grant execute on function fn_tipos_sanciones() to service_role;
