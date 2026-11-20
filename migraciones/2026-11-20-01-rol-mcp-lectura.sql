-- ===========================================================================
-- Rol mcp_lectura: lectura sin datos personales, para un MCP local (pendiente prioritario)
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales ni secretos: el rol nace SIN contraseña; la pone Claudio
-- después, en su terminal (\password mcp_lectura). Claude nunca la ve.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026).
--
-- La lista de permitidas, las huellas de columnas y las exclusiones las generó
-- un script desde scripts/replica/base.sql (todas las columnas menos las 179
-- excluidas que aprobó Claudio el 20-nov); van literales para poder revisarlas.
-- Réplica del repo (datos sintéticos): ensayo sin rastro; real (102 políticas,
-- 469 columnas permitidas, un asiento); re-ejecución detenida en la guarda. En
-- la réplica la autoprueba corre como mcp_lectura (SET ROLE): lee código y
-- status pero no clientes.nombre, ni clientes.*, ni bitacora.metadata; no
-- inserta, no ejecuta fn_cargar_ibkr_sistema, no escribe falsificando los claims
-- con fn_registrar_tipo_cambio, no crea tablas. Diez mutaciones, cada una
-- detenida por su razón: clientes.nombre permitido, SELECT de tabla en bitacora,
-- EXECUTE de fn_cargar_ibkr_sistema y de fn_registrar_tipo_cambio (con ese
-- EXECUTE la escritura con claims falsificados SÍ pasaba), rol con herencia,
-- CREATE en public, una política de menos, INSERT de tabla y por columna, y
-- membresía en authenticated.
-- Ensayo en producción, 20-nov-2026 (ROLLBACK, código de salida 0, md5 del archivo
-- ensayado 2ce70d8f19b16f2bde2efb9030878f1c, que solo difiere de este en esta
-- cabecera): guardas superadas (huellas de las 39 tablas, RLS, conteos); la
-- autoprueba con SET ROLE se omite (postgres no es superusuario) y la cubre la
-- verificación con has_*_privilege; 102 políticas, 469 columnas permitidas,
-- USAGE heredado en net = true (lo esperado, ver arriba); bitácora 1859 → 1860.
-- Verificado después por MCP: el rol no existe, 63 políticas, bitácora en 1859.
--
-- POR QUÉ
--
-- El 19-nov-2026 se comprobó que el read_only=true del MCP hospedado de Supabase
-- se salta con «set transaction read write;». La barrera tiene que ser de
-- privilegios. Diseño aprobado por Claudio el 20-nov-2026: solo SELECT en public,
-- por COLUMNA y con lista de PERMITIDAS (469 de 648; las 179 excluidas son
-- identificadores directos, datos patrimoniales declarados, respuestas en bruto,
-- texto libre y copias completas de filas), sin CREATE; TEMP se acepta (opción
-- a: no se puede quitar a un solo rol porque viene de PUBLIC).
--
-- LO QUE NO RESUELVE ESTA MIGRACIÓN (auditoría del 20-nov)
--
-- pg_net da a PUBLIC USAGE en el esquema net y todos los privilegios sobre
-- net.http_request_queue y net._http_response; el dueño es supabase_admin y
-- postgres no puede revocarlos. Un rol con LOGIN los hereda. Se contiene fuera de
-- la base: el MCP local corre cada consulta como UNA sentencia dentro de
-- BEGIN READ ONLY; SELECT 1; …; ROLLBACK (nada se confirma), y la llave del cron
-- pasa a ser un token de corta duración (no viaja la llave por la cola).
--
-- QUÉ HACE
--
-- 1. create role mcp_lectura LOGIN, sin contraseña, sin herencia ni atributos,
--    3 conexiones, statement_timeout 15 s, idle_in_transaction 30 s y
--    default_transaction_read_only (una capa más, no la barrera).
-- 2. GRANT SELECT por columna en las 39 tablas (lista literal abajo) y SELECT en
--    las dos vistas (security_invoker: leen con estos mismos permisos).
-- 3. Una política de SELECT para mcp_lectura en cada tabla (todas tienen RLS).
-- 4. Ningún EXECUTE: ninguna función de public queda a su alcance.
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
create temporary table _huellas (tabla text primary key, huella text not null) on commit drop;
insert into _huellas values
    ('beneficiarios', 'c99ec0424a414926ca1ca243d523fb47'),
    ('bitacora', 'eebef0180141429094b5c4d00a3cdaa5'),
    ('catalogo_instrumentos', 'c0efb23989d53d467f6538fe9d7d9c15'),
    ('catalogo_prorrateo', '6444c9efe5ac1dee2e7f1b87930a62a6'),
    ('cliente_bloqueos', '33213272cf36021d2a5b66088e4da1e4'),
    ('cliente_bloqueos_historico', '8dbfb3da3dc63e656074b6c2cd9729bd'),
    ('clientes', 'd14183e594f913f4e517bde22638c6fc'),
    ('codigos_alias', 'a3c3930a5692b0b533b0c9860039531f'),
    ('cuenta_titulares', '7d2b9e8e33b163a6a484afbd8a76eff5'),
    ('cuenta_titulares_historico', '8cef5984bc3efbd5ce2ba67f9f846310'),
    ('cuentas_ibkr', 'bdd9f3dfc5874f178e532e90bdb71d72'),
    ('cuentas_ibkr_historico', 'cb1ed5bf84de3cfcb128a1a2e1b09e71'),
    ('documentos_expediente', '8135d204a48ab371d296605aabf6c934'),
    ('documentos_expediente_historico', '435073dab9474d6e12ecf42ade9de885'),
    ('ebr_evaluaciones', '2cdb05a4d60f602bf2f2d382e88dcbbf'),
    ('firmas_cumplimiento', '2adea3db40568099c4511e2f97ac1b3c'),
    ('firmas_cumplimiento_historico', 'ad08677ebab1e28307175b44f4d6f4b0'),
    ('ibkr_cron_eventos', '6111550f540108cdbda7290a4b015efe'),
    ('kyc_detalle', 'b3e271715adf07aa7054d3474a39e55a'),
    ('limites_fase', 'caba37f33189e0dd07b8098a9a8c63ca'),
    ('limites_perfil', '013e5da42943b35487e69a1d80bf142f'),
    ('listas_coincidencias', '2ee1a54ab729dbea922bcf60a98c2eb6'),
    ('listas_control', 'de9dd7961e0d34309654d71d495e5855'),
    ('listas_registros', '7a2890d34721ffcb92aabc34d2b803dd'),
    ('parametros_cumplimiento', '1cd2695c9417cd6152eeeb4f7884f379'),
    ('pep_listas', '22539c4f3ebaf37c74524f752f351d72'),
    ('perfil_riesgo', '90a24d931257e5c9019c2ba579695b21'),
    ('perfil_riesgo_historico', '7487fbadf5c474ac53042b829611d58e'),
    ('personas', 'cd12ab6c0239bf5deec395b75207ab03'),
    ('personas_historico', '6e84a2e7ca01596b8d9336cf467780e9'),
    ('portafolios', '1477ecce8e41894342ed79479b1b8c31'),
    ('posiciones_detalle', '37cd51f52e3d7ac0d4d55b150b0ed84f'),
    ('propietario_real', 'f9b23d3ebf36a528137dc803c7a5e40d'),
    ('reglas_perfil', '076e332a4be041b09fd5206ecdae8b34'),
    ('rendimientos_horizonte', 'a2fe57d4659d64373dce3552c3554480'),
    ('semaforo_evaluaciones', '5089baabcb72d7c8b5fe53eb9bbfb846'),
    ('sync_ibkr', '885c7c625363d38c263cf29dca71d1de'),
    ('tipo_cambio', 'e532069b91b7e27afc8ee9f6aa3b971d'),
    ('transaccionalidad', 'd2eb3fb43c0d5474af3ac2c5feb13158');

do $$
declare
  v_malas text;
begin
  if exists (select 1 from pg_roles where rolname = 'mcp_lectura') then
    raise exception 'guarda: el rol mcp_lectura ya existe; el script no es re-ejecutable.';
  end if;
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 39
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) <> 31
     or (select count(*) from pg_policies where schemaname = 'public') <> 63
     or (select count(*) from pg_views where schemaname = 'public') <> 2 then
    raise exception 'guarda: el esquema no es el esperado (39 tablas, 31 funciones, 63 políticas, 2 vistas).';
  end if;
  -- Las columnas de cada tabla son exactamente las del inventario aprobado (huella del orden de columnas).
  select string_agg(h.tabla, ', ') into v_malas
    from _huellas h
   where h.huella is distinct from (select md5(string_agg(a.attname, ',' order by a.attnum)) from pg_attribute a
                                     where a.attrelid = ('public.' || h.tabla)::regclass and a.attnum > 0 and not a.attisdropped);
  if v_malas is not null or (select count(*) from _huellas) <> 39 then
    raise exception 'guarda: cambiaron las columnas de: % (rehacer el inventario antes de seguir).', coalesce(v_malas, '(conteo)');
  end if;
  if exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity) then
    raise exception 'guarda: hay una tabla sin RLS.';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select count(*) from public.bitacora) as bitacora;

-- --- 1 · El rol -------------------------------------------------------------------------
create role mcp_lectura login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 3;
alter role mcp_lectura set statement_timeout = '15s';
alter role mcp_lectura set idle_in_transaction_session_timeout = '30s';
alter role mcp_lectura set default_transaction_read_only = on;
comment on role mcp_lectura is
  'Lectura para el MCP local (20-nov-2026): SELECT por columna, sin datos personales. Sin EXECUTE ni CREATE. Contraseña: la pone Claudio.';

-- --- 2 · SELECT por columna (lista de PERMITIDAS) y vistas ---------------------------------
grant select (id, codigo_cliente, created_at, beneficiario_persona_id, persona_id, cuenta_ibkr) on public.beneficiarios to mcp_lectura;
grant select (id, entidad, entidad_id, accion, campo, usuario, origen, created_at) on public.bitacora to mcp_lectura;
grant select (id, ticker, descripcion, asset_category, sub_category, clasificacion_cnbv, clase_activo, es_equivalente_efectivo, elegible, duracion_efectiva, nota, verificado_en, creado_en, creado_por) on public.catalogo_instrumentos to mcp_lectura;
grant select (id, ticker, clase_activo, factor, creado_en, creado_por) on public.catalogo_prorrateo to mcp_lectura;
grant select (id, codigo_cliente, coincidencia_id, bloqueado_en, bloqueado_por, levantado_en, levantado_por, firma_id) on public.cliente_bloqueos to mcp_lectura;
grant select (historico_id, version, archivado_en, archivado_por, operacion, campos_cambiados, id, codigo_cliente, coincidencia_id, bloqueado_en, bloqueado_por, levantado_en, levantado_por, firma_id) on public.cliente_bloqueos_historico to mcp_lectura;
grant select (id, codigo_cliente, status, fecha_lead, created_at, updated_at, cuenta_ibkr, es_conjunta, codigo_cotitular, fecha_aniversario, fecha_ultima_revision, carta_sofisticado_firmada, ocupacion_pb_fecha, ocupacion_pb_fuente, documentos_completos, fecha_baja, clasificacion_inversionista, clasificacion_fuente, clasificacion_fecha) on public.clientes to mcp_lectura;
grant select (id, codigo_anterior, codigo_actual, fecha, motivo, referencia, registrado_en, registrado_por) on public.codigos_alias to mcp_lectura;
grant select (id, cuenta_ibkr, persona_id, rol, creado_en, creado_por) on public.cuenta_titulares to mcp_lectura;
grant select (historico_id, version, archivado_en, archivado_por, operacion, campos_cambiados, id, cuenta_ibkr, persona_id, rol, creado_en, creado_por) on public.cuenta_titulares_historico to mcp_lectura;
grant select (id, cuenta_ibkr, codigo_cliente, tipo, creado_en, creado_por, es_propia, fecha_cierre, motivo_cierre, codigo_ips_fijado, motivo_ips_fijado, fecha_ips_fijado) on public.cuentas_ibkr to mcp_lectura;
grant select (historico_id, version, archivado_en, archivado_por, operacion, campos_cambiados, id, cuenta_ibkr, codigo_cliente, tipo, creado_en, creado_por, es_propia, fecha_cierre, motivo_cierre, codigo_ips_fijado, motivo_ips_fijado, fecha_ips_fijado) on public.cuentas_ibkr_historico to mcp_lectura;
grant select (id, codigo_cliente, tipo, fecha_documento, sha256, tamano_bytes, mime, reemplaza_a, subido_por, created_at) on public.documentos_expediente to mcp_lectura;
grant select (historico_id, version, archivado_en, archivado_por, operacion, campos_cambiados, id, codigo_cliente, tipo, fecha_documento, sha256, tamano_bytes, mime, reemplaza_a, subido_por, created_at) on public.documentos_expediente_historico to mcp_lectura;
grant select (id, codigo_cliente, grado_riesgo, regimen, supuestos_evaluados, supuestos_activos, matriz_puntaje_total, matriz_banda, es_pep, pep_extranjero, aplica_medidas_pep, requiere_aprobacion_oficial, en_lista_bloqueadas, alerta_critica, evaluacion_preliminar, verificaciones_pendientes, fecha_evaluacion, override_source, elaboro, revisa_autoriza, created_at, persona_id) on public.ebr_evaluaciones to mcp_lectura;
grant select (id, entidad, entidad_id, codigo_cliente, acto, firmante, rol, firmado_en, autorizacion_oficial) on public.firmas_cumplimiento to mcp_lectura;
grant select (historico_id, version, archivado_en, archivado_por, operacion, campos_cambiados, id, entidad, entidad_id, codigo_cliente, acto, firmante, rol, firmado_en, autorizacion_oficial) on public.firmas_cumplimiento_historico to mcp_lectura;
grant select (id, td, paso, resultado, sync_id, detalle, creado_por, creado_en) on public.ibkr_cron_eventos to mcp_lectura;
grant select (id, codigo_cliente, domicilio_fiscal_igual, fecha_kyc, created_at, persona_id) on public.kyc_detalle to mcp_lectura;
grant select (id, fase, rv_max_pct, rf_min_pct, liquidez_min_pct, fuente, creado_en, creado_por) on public.limites_fase to mcp_lectura;
grant select (id, perfil, clase_activo, max_pct, fuente, creado_en, creado_por) on public.limites_perfil to mcp_lectura;
grant select (id, codigo_cliente, lista_id, registro_id, tipo_match, estado, revisada_por, fecha_revision, detectada_en) on public.listas_coincidencias to mcp_lectura;
grant select (id, tipo, obligatoria, fuente, fecha_lista, fecha_carga, cargada_por, registros, archivo_nombre, vigente) on public.listas_control to mcp_lectura;
grant select (id, lista_id, programa, pais, created_at) on public.listas_registros to mcp_lectura;
grant select (id, clave, tipo, valor_num, valor_fecha, valor_bool, nota, creado_en, creado_por) on public.parametros_cumplimiento to mcp_lectura;
grant select (id, codigo_cliente, es_pep, fecha_screening, created_at, pep_declaracion_fecha, pep_declaracion_fuente, persona_id) on public.pep_listas to mcp_lectura;
grant select (id, codigo_cliente, objetivo_inversion, ganancia_deseada, horizonte, tolerancia_perdida, resultado_perfil, perfil_ia, fecha_evaluacion, created_at, reaccion_caida_10, percepcion_riesgo_empleo, prefiere_ingreso_seguro, no_puede_perder, fase, tolerancia_puntos, tolerancia_nivel, capacidad_puntos, capacidad_nivel, puntuacion_ponderada, perfil_solicitado_cliente, fecha_calculo, perfil_ajustado_por, fecha_ajuste, perfil_ajustado, ajustado_por, persona_id) on public.perfil_riesgo to mcp_lectura;
grant select (historico_id, version, archivado_en, archivado_por, operacion, campos_cambiados, id, codigo_cliente, objetivo_inversion, ganancia_deseada, horizonte, tolerancia_perdida, resultado_perfil, perfil_ia, fecha_evaluacion, created_at, reaccion_caida_10, percepcion_riesgo_empleo, prefiere_ingreso_seguro, no_puede_perder, fase, tolerancia_puntos, tolerancia_nivel, capacidad_puntos, capacidad_nivel, puntuacion_ponderada, perfil_solicitado_cliente, fecha_calculo, perfil_ajustado_por, fecha_ajuste, perfil_ajustado, ajustado_por, persona_id) on public.perfil_riesgo_historico to mcp_lectura;
grant select (id, codigo_reporte, codigo_ficha, codigo_kyc, codigo_pep, codigo_ips, codigo_ebr, creado_en, creado_por, identidad_copiada_en) on public.personas to mcp_lectura;
grant select (historico_id, version, archivado_en, archivado_por, operacion, campos_cambiados, id, codigo_reporte, codigo_ficha, codigo_kyc, codigo_pep, codigo_ips, codigo_ebr, creado_en, creado_por, identidad_copiada_en) on public.personas_historico to mcp_lectura;
grant select (id, codigo_cliente, universo, fase, perfil, posiciones, liquidez_pct, renta_variable_pct, tech_pct, validaciones, posiciones_ajustadas, ajustado_por, fecha_ajuste, fecha_generacion, created_at, advertencias) on public.portafolios to mcp_lectura;
grant select (id, sync_id, cuenta_ibkr, fecha_foto, tipo_renglon, ticker, conid, asset_category, sub_category, descripcion, cantidad, mark_price, position_value, moneda, fx_rate_to_base, valor_base, moneda_base, creado_en) on public.posiciones_detalle to mcp_lectura;
grant select (id, codigo_cliente, aplica, created_at, persona_id, cuenta_ibkr) on public.propietario_real to mcp_lectura;
grant select (id, perfil, duracion_gob_menor_a, liquidez_min_pct, efectivo_cuenta_rf, retorno_min_pct, retorno_max_pct, rv_total_max_pct, vehiculos_max_pct, fuente, creado_en, creado_por) on public.reglas_perfil to mcp_lectura;
grant select (id, sync_id, cuenta_ibkr, ventana, fd, td, moneda_base, valor_inicial, valor_final, depositos_retiros, mtm, intereses, dividendos, twr, fecha_fondeo, creado_en) on public.rendimientos_horizonte to mcp_lectura;
grant select (id, sync_id, fecha_foto, cuenta_ibkr, estado, hallazgos, metricas, perfil_aplicado, limites_aplicados, ips_pendiente, tipo_cambio, version_motor, evaluado_por, evaluado_en) on public.semaforo_evaluaciones to mcp_lectura;
grant select (id, uso, ventana, fd, td, to_date_ibkr, xml_sha256, cuentas_xml, cuentas_cargadas, renglones, ignoradas, descuadres, confirmado_por, confirmado_en) on public.sync_ibkr to mcp_lectura;
grant select (id, serie, fecha, valor, fecha_solicitada, fuente, nota, capturado_por, capturado_en) on public.tipo_cambio to mcp_lectura;
grant select (id, codigo_cliente, fecha_declaracion, created_at, cuenta_ibkr) on public.transaccionalidad to mcp_lectura;
grant select on public.v_comite_cartera, public.v_foto_diaria_estado to mcp_lectura;

-- --- 3 · Una política de SELECT por tabla --------------------------------------------------
create policy beneficiarios_select_mcp_lectura on public.beneficiarios for select to mcp_lectura using (true);
create policy bitacora_select_mcp_lectura on public.bitacora for select to mcp_lectura using (true);
create policy catalogo_instrumentos_select_mcp_lectura on public.catalogo_instrumentos for select to mcp_lectura using (true);
create policy catalogo_prorrateo_select_mcp_lectura on public.catalogo_prorrateo for select to mcp_lectura using (true);
create policy cliente_bloqueos_select_mcp_lectura on public.cliente_bloqueos for select to mcp_lectura using (true);
create policy cliente_bloqueos_historico_select_mcp_lectura on public.cliente_bloqueos_historico for select to mcp_lectura using (true);
create policy clientes_select_mcp_lectura on public.clientes for select to mcp_lectura using (true);
create policy codigos_alias_select_mcp_lectura on public.codigos_alias for select to mcp_lectura using (true);
create policy cuenta_titulares_select_mcp_lectura on public.cuenta_titulares for select to mcp_lectura using (true);
create policy cuenta_titulares_historico_select_mcp_lectura on public.cuenta_titulares_historico for select to mcp_lectura using (true);
create policy cuentas_ibkr_select_mcp_lectura on public.cuentas_ibkr for select to mcp_lectura using (true);
create policy cuentas_ibkr_historico_select_mcp_lectura on public.cuentas_ibkr_historico for select to mcp_lectura using (true);
create policy documentos_expediente_select_mcp_lectura on public.documentos_expediente for select to mcp_lectura using (true);
create policy documentos_expediente_historico_select_mcp_lectura on public.documentos_expediente_historico for select to mcp_lectura using (true);
create policy ebr_evaluaciones_select_mcp_lectura on public.ebr_evaluaciones for select to mcp_lectura using (true);
create policy firmas_cumplimiento_select_mcp_lectura on public.firmas_cumplimiento for select to mcp_lectura using (true);
create policy firmas_cumplimiento_historico_select_mcp_lectura on public.firmas_cumplimiento_historico for select to mcp_lectura using (true);
create policy ibkr_cron_eventos_select_mcp_lectura on public.ibkr_cron_eventos for select to mcp_lectura using (true);
create policy kyc_detalle_select_mcp_lectura on public.kyc_detalle for select to mcp_lectura using (true);
create policy limites_fase_select_mcp_lectura on public.limites_fase for select to mcp_lectura using (true);
create policy limites_perfil_select_mcp_lectura on public.limites_perfil for select to mcp_lectura using (true);
create policy listas_coincidencias_select_mcp_lectura on public.listas_coincidencias for select to mcp_lectura using (true);
create policy listas_control_select_mcp_lectura on public.listas_control for select to mcp_lectura using (true);
create policy listas_registros_select_mcp_lectura on public.listas_registros for select to mcp_lectura using (true);
create policy parametros_cumplimiento_select_mcp_lectura on public.parametros_cumplimiento for select to mcp_lectura using (true);
create policy pep_listas_select_mcp_lectura on public.pep_listas for select to mcp_lectura using (true);
create policy perfil_riesgo_select_mcp_lectura on public.perfil_riesgo for select to mcp_lectura using (true);
create policy perfil_riesgo_historico_select_mcp_lectura on public.perfil_riesgo_historico for select to mcp_lectura using (true);
create policy personas_select_mcp_lectura on public.personas for select to mcp_lectura using (true);
create policy personas_historico_select_mcp_lectura on public.personas_historico for select to mcp_lectura using (true);
create policy portafolios_select_mcp_lectura on public.portafolios for select to mcp_lectura using (true);
create policy posiciones_detalle_select_mcp_lectura on public.posiciones_detalle for select to mcp_lectura using (true);
create policy propietario_real_select_mcp_lectura on public.propietario_real for select to mcp_lectura using (true);
create policy reglas_perfil_select_mcp_lectura on public.reglas_perfil for select to mcp_lectura using (true);
create policy rendimientos_horizonte_select_mcp_lectura on public.rendimientos_horizonte for select to mcp_lectura using (true);
create policy semaforo_evaluaciones_select_mcp_lectura on public.semaforo_evaluaciones for select to mcp_lectura using (true);
create policy sync_ibkr_select_mcp_lectura on public.sync_ibkr for select to mcp_lectura using (true);
create policy tipo_cambio_select_mcp_lectura on public.tipo_cambio for select to mcp_lectura using (true);
create policy transaccionalidad_select_mcp_lectura on public.transaccionalidad for select to mcp_lectura using (true);

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('esquema', 'mcp_lectura', 'migracion',
        'Rol mcp_lectura para el MCP local: SELECT por columna en 39 tablas (469 columnas permitidas, sin datos '
        'personales), 2 vistas, una política de SELECT por tabla; sin EXECUTE ni CREATE. Aprobado por Claudio el 20-nov-2026.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-20-01-rol-mcp-lectura.sql'));

-- --- 4 · Autoprueba con SET ROLE (solo donde se puede: la réplica, como superusuario) ------
do $$
declare
  v_n int;
begin
  if not (select rolsuper from pg_roles where rolname = current_user) then
    raise notice 'autoprueba con SET ROLE omitida (sin superusuario): la verificación usa has_*_privilege.';
    return;
  end if;
  begin
    execute 'set local role mcp_lectura';
    select count(*) into v_n from (select codigo_cliente, status from public.clientes) x;  -- columnas permitidas: sí
    begin
      perform nombre from public.clientes limit 1;
      raise exception 'autoprueba: mcp_lectura leyó clientes.nombre.' using errcode = 'IBFAL';
    exception when insufficient_privilege then null; end;
    begin
      perform * from public.clientes limit 1;
      raise exception 'autoprueba: mcp_lectura leyó clientes con *.' using errcode = 'IBFAL';
    exception when insufficient_privilege then null; end;
    begin
      perform metadata from public.bitacora limit 1;
      raise exception 'autoprueba: mcp_lectura leyó bitacora.metadata.' using errcode = 'IBFAL';
    exception when insufficient_privilege then null; end;
    begin
      insert into public.tipo_cambio (serie, fecha, valor, fecha_solicitada, fuente, capturado_por)
      values ('SF43718', date '2000-01-03', 1, date '2000-01-03', 'x', 'x');
      raise exception 'autoprueba: mcp_lectura insertó en tipo_cambio.' using errcode = 'IBFAL';
    exception when insufficient_privilege or read_only_sql_transaction then null; end;
    begin
      perform public.fn_cargar_ibkr_sistema('{}'::jsonb);
      raise exception 'autoprueba: mcp_lectura ejecutó fn_cargar_ibkr_sistema.' using errcode = 'IBFAL';
    exception
      when insufficient_privilege then null;
      when sqlstate 'IBFAL' then raise;
      -- Cualquier otro error significa que la función SÍ corrió (y la detuvo su propia validación).
      when others then raise exception 'autoprueba: mcp_lectura pudo ejecutar fn_cargar_ibkr_sistema (%).', sqlerrm using errcode = 'IBFAL';
    end;
    begin
      perform set_config('request.jwt.claims', '{"email":"impostor@x.test"}', true);
      perform public.fn_registrar_tipo_cambio('SF43718', date '2000-01-03', 1, date '2000-01-03', 'x', null);
      raise exception 'autoprueba: mcp_lectura escribió con claims falsificados.' using errcode = 'IBFAL';
    exception
      when insufficient_privilege then null;
      when sqlstate 'IBFAL' then raise;
      when others then raise exception 'autoprueba: mcp_lectura pudo ejecutar fn_registrar_tipo_cambio (%).', sqlerrm using errcode = 'IBFAL';
    end;
    begin
      execute 'create table public.mcp_intruso (x int)';
      raise exception 'autoprueba: mcp_lectura creó una tabla en public.' using errcode = 'IBFAL';
    exception when insufficient_privilege then null; end;
    raise exception 'autoprueba completa' using errcode = 'IBOK0';
  exception when sqlstate 'IBOK0' then null;
  end;
end $$;

-- --- 5 · Verificación dentro de la transacción (con has_*_privilege: vale también sin SET ROLE) ----
do $$
declare
  v_ex  jsonb := '{"clientes":["nombre","apellido_paterno","apellido_materno","genero","fecha_nacimiento","rfc","curp","estado_civil","correo","celular","grado_estudios","ocupacion","ingreso_neto_mensual","ahorros_aprox","carta_sofisticado_url","ocupacion_pb","clasificacion_nota","motivo_baja","realiza_actividad_vulnerable","actividades_vulnerables","actividad_vulnerable_fecha","actividad_vulnerable_fuente","actividad_vulnerable_detalle"],"personas":["nombre","apellido_paterno","apellido_materno","genero","fecha_nacimiento","rfc","curp","estado_civil","correo","celular","grado_estudios","ocupacion","ingreso_neto_mensual","ahorros_aprox","nota"],"personas_historico":["nombre","apellido_paterno","apellido_materno","genero","fecha_nacimiento","rfc","curp","estado_civil","correo","celular","grado_estudios","ocupacion","ingreso_neto_mensual","ahorros_aprox","nota","snapshot"],"kyc_detalle":["nacionalidad","pais_nacimiento","estado_nacimiento","calle","numero_exterior","numero_interior","colonia","municipio","ciudad","estado","codigo_postal","domicilio_fiscal","regimen_fiscal","empresa","puesto","nivel_jerarquico","giro_empresa","sector_empresa","tipo_ingresos","tiene_vinculos_patrimoniales","respuestas_completas","entidad_federativa_pb","no_vigente_motivo"],"pep_listas":["cargo_publico","institucion","pais_cargo","tiene_relacionado_pep","cargo_relacionado","pais_relacionado","institucion_relacionado","resultado_screening","respuestas_completas","es_pep_nacional","es_pep_extranjero","familiar_pep_nacional","familiar_pep_extranjero","no_vigente_motivo"],"beneficiarios":["nombre_completo","relacion","proporcion","genero","fecha_nacimiento","rfc","domicilio_completo","ocupacion","lugar_nacimiento","respuestas_completas"],"propietario_real":["nombre","apellido_paterno","apellido_materno","genero","fecha_nacimiento","curp","rfc","nacionalidad","pais_residencia","regimen_fiscal","celular","domicilio_completo","respuestas_completas"],"perfil_riesgo":["respuestas_completas","bitacora_calculo","comentario_asesor","ahorros","hipoteca","otras_deudas","dependientes","situacion_habitacional","negocio_propio","tiene_ahorros","colchon_liquidez"],"perfil_riesgo_historico":["respuestas_completas","bitacora_calculo","comentario_asesor","ahorros","hipoteca","otras_deudas","dependientes","situacion_habitacional","negocio_propio","tiene_ahorros","colchon_liquidez","snapshot"],"transaccionalidad":["ahorro_declarado","monto_inicial_deposito","depositos_mensuales","retiros_mensuales","rango_deposito_mensual","rango_retiro_mensual"],"ebr_evaluaciones":["entrada","observaciones","razon_clasificacion","fundamento_clasificacion","motivos_preliminar","matriz_factores"],"bitacora":["valor_anterior","valor_nuevo","motivo","metadata"],"listas_registros":["nombre","nombre_norm","rfc","curp","alias","observaciones"],"listas_coincidencias":["valor_cliente","valor_lista","motivo_resolucion"],"listas_control":["observaciones"],"documentos_expediente":["ruta_storage"],"documentos_expediente_historico":["ruta_storage","snapshot"],"firmas_cumplimiento":["declaracion"],"firmas_cumplimiento_historico":["declaracion","snapshot"],"cliente_bloqueos":["motivo","motivo_levantamiento"],"cliente_bloqueos_historico":["motivo","motivo_levantamiento","snapshot"],"cuentas_ibkr_historico":["snapshot"],"cuenta_titulares_historico":["snapshot"],"portafolios":["comentario_asesor","bitacora"],"ibkr_cron_eventos":["referencia_flex"]}'::jsonb;
  v_mal text;
begin
  if not exists (select 1 from pg_roles where rolname = 'mcp_lectura' and rolcanlogin and not rolsuper and not rolinherit
                   and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls and rolconnlimit = 3)
     or exists (select 1 from pg_auth_members where member = 'mcp_lectura'::regrole) then
    raise exception 'verificación: atributos o membresías de mcp_lectura no son los esperados.';
  end if;
  -- Cada columna: SELECT si y solo si NO está en la lista de excluidas.
  select string_agg(c.relname || '.' || a.attname, ', ') into v_mal
    from pg_class c join pg_attribute a on a.attrelid = c.oid
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('mcp_lectura', c.oid, a.attname, 'SELECT')
         = coalesce((v_ex -> c.relname) ? a.attname, false);
  if v_mal is not null then
    raise exception 'verificación: columnas con el permiso equivocado: %', v_mal;
  end if;
  if exists (select 1 from pg_class c, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
              where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege('mcp_lectura', c.oid, p.priv))
     or exists (select 1 from pg_class c, unnest(array['INSERT','UPDATE']) p(priv), pg_attribute a
                 where a.attrelid = c.oid and c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0
                   and not a.attisdropped and has_column_privilege('mcp_lectura', c.oid, a.attname, p.priv)) then
    raise exception 'verificación: mcp_lectura tiene privilegios de tabla o de escritura.';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('mcp_lectura', oid, 'EXECUTE')) then
    raise exception 'verificación: mcp_lectura puede ejecutar una función de public.';
  end if;
  if has_schema_privilege('mcp_lectura', 'public', 'CREATE') or has_database_privilege('mcp_lectura', current_database(), 'CREATE')
     or exists (select 1 from pg_namespace n where n.nspname in ('auth','storage','vault','cron','realtime','extensions','graphql')
                  and has_schema_privilege('mcp_lectura', n.oid, 'USAGE')) then
    raise exception 'verificación: mcp_lectura tiene CREATE o USAGE en un esquema que no debe.';
  end if;
  if not has_table_privilege('mcp_lectura', 'public.v_comite_cartera', 'SELECT')
     or not has_table_privilege('mcp_lectura', 'public.v_foto_diaria_estado', 'SELECT')
     or (select count(*) from pg_policies where schemaname = 'public' and 'mcp_lectura' = any(roles) and cmd = 'SELECT') <> 39
     or (select count(*) from pg_policies where schemaname = 'public') <> 102 then
    raise exception 'verificación: vistas o políticas de mcp_lectura no quedaron (39 políticas; 102 en total).';
  end if;
  if (select count(*) from public.bitacora) <> (select bitacora from _antes) + 1 then
    raise exception 'verificación: la bitácora no tiene solo el asiento manual.';
  end if;
end $$;

select (select count(*) from pg_policies where schemaname = 'public')::text as politicas,
       (select count(*) from pg_class c join pg_attribute a on a.attrelid = c.oid
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('mcp_lectura', c.oid, a.attname, 'SELECT'))::text as columnas_permitidas,
       (select has_schema_privilege('mcp_lectura', n.oid, 'USAGE') from pg_namespace n where n.nspname = 'net')::text as net_usage_heredado,
       ((select bitacora from _antes) || ' → ' || (select count(*) from public.bitacora)) as bitacora;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
