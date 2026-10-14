-- ===========================================================================
-- CSPFU2963 · carta de clasificación firmada · status y clasificación 203
--
-- EJECUTADO el 14 de octubre de 2026 por Claudio Bustamante, a mano, en el SQL
-- Editor de Supabase, desde el archivo actualizacion-CSPFU2963-carta-2026-10-14.sql
-- (md5 del archivo ejecutado: 5a1974926d6ef5cd27047c612d46b198).
--
-- DIFERENCIA CON LO EJECUTADO: además de esta cabecera, UNA sola. En el asiento
-- manual de bitácora (sección 2), el literal del campo `usuario` era el correo
-- del asesor; aquí está sustituido por '<usuario>', porque los scripts
-- archivados no llevan correos (README). El correo real consta en ese asiento
-- de la tabla bitacora en la base (accion 'clasificacion_inversionista',
-- entidad_id 'CSPFU2963', origen 'migracion', 14-oct-2026). Todo lo demás,
-- desde el BEGIN, es byte a byte lo ejecutado.
--
-- Regla desde aquí: el usuario no va escrito en un script; se toma de la sesión
-- o va como parámetro.
--
-- POR QUÉ
--
-- La clienta firmó su carta de clasificación (Anexo 1 Apartado A) el
-- 13-oct-2026 y la app no permitía registrar un 203 por carta: la ruta de
-- clasificación solo escribe determinaciones del asesor (201/202/204) y no hay
-- dónde guardar el PDF (pendiente #14; base construida el mismo día en
-- 2026-10-14-documentos-expediente.sql). Por decisión de Claudio, con la carta
-- pasa de lead_nuevo a vigente.
--
-- QUÉ HIZO
--
-- 1. Siete precondiciones (un cliente, lead_nuevo, cuenta U29139663, sin
--    clasificación, sin carta ni liga, sin baja, sin bloqueo abierto).
-- 2. clientes: status -> vigente; 203 / carta_firmada; carta_sofisticado_firmada
--    = true (lo exige el CHECK clientes_clasificacion_carta); liga al PDF en
--    NULL; clasificacion_fecha = fecha de REGISTRO en CDMX (como dice el COMMENT
--    de la columna); la fecha de FIRMA (13-oct-2026) va en la nota y en la
--    metadata del asiento.
-- 3. Un asiento manual en bitácora; trg_bitacora escribió uno por campo.
-- 4. Verificación con RAISE dentro de la transacción y resumen.
--
-- VERIFICADO DESPUÉS DE EJECUTAR
--
-- Antes: las 7 precondiciones por MCP contra producción (todas true) y la fila
-- resultante simulada contra los 8 CHECK de clientes (todos true). El script
-- completo no corrió en réplica: la primera ejecución fue la de producción.
--
-- En producción, el resumen (sección 4) tal como lo devolvió el editor:
--
--   status   clasificacion                      carta_firmada  sin_liga_pdf  asientos_bitacora
--   vigente  203 / carta_firmada / 2026-10-14   true           true          7
--
-- Y después, por MCP (solo lectura), el mismo día: 6 asientos del trigger
-- (status lead_nuevo -> vigente, carta_sofisticado_firmada false -> true y las
-- cuatro clasificacion_*) más el manual; la condición de la alerta roja
-- (vigente o inactivo sin clasificación) en false para CSPFU2963, que es la que
-- usan la ficha y /tabla (requiereAlertaClasificacion). Quedan con alerta
-- CSPFU1889 y CSPFU1988.
-- ===========================================================================

BEGIN;

-- 1. Precondiciones
DO $$
BEGIN
  IF NOT coalesce(((SELECT count(*) FROM clientes WHERE codigo_cliente = 'CSPFU2963') = 1), false) THEN RAISE EXCEPTION 'precondición falla: un_cliente'; END IF;
  IF NOT coalesce(((SELECT status FROM clientes WHERE codigo_cliente = 'CSPFU2963') = 'lead_nuevo'), false) THEN RAISE EXCEPTION 'precondición falla: cliente_lead'; END IF;
  IF NOT coalesce(((SELECT cuenta_ibkr FROM clientes WHERE codigo_cliente = 'CSPFU2963') = 'U29139663'), false) THEN RAISE EXCEPTION 'precondición falla: cuenta'; END IF;
  IF NOT coalesce(((SELECT clasificacion_inversionista IS NULL AND clasificacion_fuente IS NULL AND clasificacion_fecha IS NULL AND clasificacion_nota IS NULL FROM clientes WHERE codigo_cliente = 'CSPFU2963')), false) THEN RAISE EXCEPTION 'precondición falla: clasificacion_vacia'; END IF;
  IF NOT coalesce(((SELECT carta_sofisticado_firmada = false AND carta_sofisticado_url IS NULL FROM clientes WHERE codigo_cliente = 'CSPFU2963')), false) THEN RAISE EXCEPTION 'precondición falla: sin_carta'; END IF;
  IF NOT coalesce(((SELECT fecha_baja IS NULL AND motivo_baja IS NULL FROM clientes WHERE codigo_cliente = 'CSPFU2963')), false) THEN RAISE EXCEPTION 'precondición falla: sin_baja'; END IF;
  IF NOT coalesce((NOT EXISTS (SELECT 1 FROM cliente_bloqueos WHERE codigo_cliente = 'CSPFU2963' AND levantado_en IS NULL)), false) THEN RAISE EXCEPTION 'precondición falla: sin_bloqueo_abierto'; END IF;
END $$;

-- 2. Carga
UPDATE clientes SET
  status                      = 'vigente',
  carta_sofisticado_firmada   = true,
  clasificacion_inversionista = '203',
  clasificacion_fuente        = 'carta_firmada',
  clasificacion_fecha         = (now() AT TIME ZONE 'America/Mexico_City')::date,
  clasificacion_nota          = 'Carta de clasificación firmada por la clienta. Fecha de firma: 13-oct-2026; clasificacion_fecha es la de registro. Sin liga al PDF: la app aún no guarda documentos (pendiente #14).'
WHERE codigo_cliente = 'CSPFU2963';

INSERT INTO bitacora (entidad, entidad_id, accion, campo, valor_anterior, valor_nuevo, motivo, usuario, origen, metadata)
VALUES
  ('clientes', 'CSPFU2963', 'clasificacion_inversionista', 'clasificacion_inversionista', NULL, '203',
   'Clasificación 203 (Sofisticado) por carta del Anexo 1 Apartado A firmada por la clienta el 13-oct-2026. Con la carta, el status pasa de lead_nuevo a vigente. Registrada por SQL porque la app no permite fijar un 203 por carta.',
   '<usuario>', 'migracion',
   '{"fuente": "carta_firmada", "fecha_firma": "2026-10-13", "campo_r03": "R03 J-0315, campo 6", "status_anterior": "lead_nuevo", "status_nuevo": "vigente", "carta_url": null, "script": "actualizacion-CSPFU2963-carta-2026-10-14.sql", "ejecutado": "sql_directo"}'::jsonb);

-- 3. Verificación
DO $$
BEGIN
  IF NOT (SELECT status = 'vigente' AND carta_sofisticado_firmada = true AND carta_sofisticado_url IS NULL
                 AND clasificacion_inversionista = '203' AND clasificacion_fuente = 'carta_firmada'
                 AND clasificacion_fecha = (now() AT TIME ZONE 'America/Mexico_City')::date
                 AND clasificacion_nota LIKE 'Carta de clasificación firmada por la clienta.%13-oct-2026%'
            FROM clientes WHERE codigo_cliente = 'CSPFU2963') THEN
    RAISE EXCEPTION 'verificación: clientes';
  END IF;
  -- La alerta roja (lib/clasificacion.ts, requiereAlertaClasificacion): status
  -- vigente o inactivo y clasificación NULL. Ya no debe cumplirse.
  IF (SELECT status IN ('vigente', 'inactivo') AND clasificacion_inversionista IS NULL
        FROM clientes WHERE codigo_cliente = 'CSPFU2963') THEN
    RAISE EXCEPTION 'verificación: la alerta de clasificación seguiría saliendo';
  END IF;
  -- Bitácora de esta transacción: 6 cambios por campo (trigger) y 1 manual.
  IF (SELECT count(*) FROM bitacora WHERE entidad_id = 'CSPFU2963' AND created_at = now() AND accion = 'update' AND entidad = 'clientes') <> 6
  OR (SELECT count(*) FROM bitacora WHERE entidad_id = 'CSPFU2963' AND created_at = now() AND accion = 'clasificacion_inversionista') <> 1 THEN
    RAISE EXCEPTION 'verificación: asientos de bitácora';
  END IF;
  -- clientes sin espejo: el valor anterior del status tiene que estar en bitácora.
  IF (SELECT count(*) FROM bitacora WHERE entidad_id = 'CSPFU2963' AND created_at = now() AND entidad = 'clientes'
        AND campo = 'status' AND valor_anterior = 'lead_nuevo' AND valor_nuevo = 'vigente') <> 1 THEN
    RAISE EXCEPTION 'verificación: valor anterior del status en bitácora';
  END IF;
END $$;

-- 4. Resumen (sin datos personales)
SELECT
  (SELECT status FROM clientes WHERE codigo_cliente = 'CSPFU2963')                                AS status,
  (SELECT clasificacion_inversionista || ' / ' || clasificacion_fuente || ' / ' || clasificacion_fecha
     FROM clientes WHERE codigo_cliente = 'CSPFU2963')                                            AS clasificacion,
  (SELECT carta_sofisticado_firmada FROM clientes WHERE codigo_cliente = 'CSPFU2963')             AS carta_firmada,
  (SELECT carta_sofisticado_url IS NULL FROM clientes WHERE codigo_cliente = 'CSPFU2963')         AS sin_liga_pdf,
  (SELECT count(*) FROM bitacora WHERE entidad_id = 'CSPFU2963' AND created_at = now())           AS asientos_bitacora,
  (SELECT string_agg(DISTINCT usuario, ', ') FROM bitacora WHERE entidad_id = 'CSPFU2963' AND created_at = now()) AS usuarios;

COMMIT;
