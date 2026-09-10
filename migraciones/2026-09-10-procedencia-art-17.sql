-- ===========================================================================
-- Origen de la declaración del Art. 17 LFPIORPI
--
-- EJECUTADO el 10 de septiembre de 2026 por Claudio Bustamante, a mano, en el
-- SQL Editor de Supabase. Este archivo es el registro de lo que se corrió.
--
-- QUÉ HIZO
--
-- `clientes.realiza_actividad_vulnerable` estaba en null en las 36 filas de la
-- cartera, y eso mantenía a los 28 expedientes vigentes en evaluación
-- PRELIMINAR: el motor EBR no puede evaluar el Supuesto 1 sin respuesta, y null
-- significa «la pregunta no se formuló», que no es lo mismo que «el Cliente
-- contestó que no».
--
-- La salida NO fue fingir una declaración que el Cliente nunca dio. Se agregó
-- una tercera posibilidad explícita —la determinación del Asesor en
-- Inversiones— y se etiquetó como tal:
--
--   `clientes.actividad_vulnerable_fuente` deja de guardar prosa y pasa a
--   guardar procedencia: 'cliente' (lo declaró) o 'asesor' (lo determinó el
--   Asesor a partir de la ocupación declarada). El párrafo que la justifica
--   vive en `actividad_vulnerable_detalle`, que es su lugar.
--
-- El motor lee esa procedencia desde el commit c4d2d05 y escribe «Determinación
-- del Asesor en Inversiones» donde antes habría escrito «el Cliente declara».
-- Una determinación presentada como declaración es una declaración inventada.
--
-- QUÉ NO HIZO, A PROPÓSITO
--
-- Los 7 clientes con status 'inactivo' y LEAD-35554 se quedaron en null. Para
-- ellos null —«no consta»— es el dato correcto: un expediente inactivo no tiene
-- revisión anual programada, así que el texto les prometería una ratificación
-- que nadie va a cumplir, y LEAD-35554 no tiene contrato celebrado. Ninguno de
-- los 8 tiene `ocupacion_pb`, de modo que el EBR no puede correrles igual.
--
-- No se tocó `clientes.ocupacion_pb_fuente`, que arrastra el mismo defecto que
-- tenía esta columna: guarda un párrafo donde debería guardar quién lo dijo.
-- Debe partirse igual cuando se toque esa pieza. Va en migración aparte para
-- que un error en una no revierta la otra.
--
-- No se subió a la base la regla de «declaró que sí pero no seleccionó ninguna
-- actividad». Esa se queda en el motor como `ErrorEBR` con su 400 y su mensaje:
-- en la base sería un error de Postgres en vez de un error explicable.
--
-- EL TEXTO HEREDADO SE DESCARTÓ
--
-- Las 28 filas traían 'Pregunta no formulada. Se recaba en la revision anual
-- 2026.' en la columna de procedencia. Se descartó a propósito —hoy la
-- determinación sí se formula— y `fn_bitacora` dejó asentado el `valor_anterior`
-- de cada fila, así que el texto sigue siendo recuperable desde la bitácora.
--
-- VERIFICADO DESPUÉS DE EJECUTAR
--
--   status       clientes  sin_respuesta  por_asesor  por_cliente  con_fecha
--   inactivo            7              7           0            0          0
--   lead_nuevo          1              1           0            0          0
--   vigente            28              0          28            0         28
--
--   constraint `clientes_actividad_vulnerable_procedencia` presente y activo.
--
-- La corrida masiva de EBR posterior NO debe mover ningún grado ni puntaje:
-- esto cierra un motivo de preliminaridad y no toca la matriz ni la regla del
-- §4.6. Hay un test que lo fija (lib/ebr-engine.test.ts, «cerrar el motivo no
-- mueve el grado ni el puntaje»).
-- ===========================================================================

begin;

-- --- 1 · Limpieza del texto heredado ---------------------------------------
-- Agnóstico al status a propósito: limpia la prosa esté donde esté, y por eso
-- los inactivos y el lead terminan en (null, null), que es el único estado que
-- el constraint del paso 4 acepta para «no consta».

update clientes
   set actividad_vulnerable_fuente = null
 where actividad_vulnerable_fuente is not null
   and actividad_vulnerable_fuente not in ('cliente', 'asesor');
-- ejecutado: UPDATE 28

-- --- 2 · Valuación inmobiliaria · CSPFU8488 y CSPMU1062 --------------------
-- La emisión de avalúos no es actividad vulnerable del Art. 17: el valuador no
-- prepara ni ejecuta la transmisión de propiedad ni administra recursos. Por eso
-- estos dos llevan un fundamento propio y no el genérico del paso 3.

update clientes
   set realiza_actividad_vulnerable = false,
       actividad_vulnerable_fuente  = 'asesor',
       actividad_vulnerable_fecha   = date '2026-09-10',
       actividad_vulnerable_detalle =
         'El Cliente presta servicios de valuación inmobiliaria. La emisión de '
         'avalúos no constituye actividad vulnerable del Art. 17 LFPIORPI: el '
         'valuador no prepara ni ejecuta la operación de transmisión de propiedad '
         'ni administra recursos del Cliente. Determinación del Asesor en '
         'Inversiones, pendiente de ratificación por el Oficial de Cumplimiento.'
 where codigo_cliente in ('CSPFU8488', 'CSPMU1062');
-- ejecutado: UPDATE 2

-- --- 3 · El resto de la cartera vigente ------------------------------------
-- Los dos del paso 2 ya quedaron con valor, así que el `is null` los excluye
-- solo. LEAD-35554 queda fuera por status: no hay contrato celebrado.

update clientes
   set realiza_actividad_vulnerable = false,
       actividad_vulnerable_fuente  = 'asesor',
       actividad_vulnerable_fecha   = date '2026-09-10',
       actividad_vulnerable_detalle =
         'El Asesor en Inversiones no tiene conocimiento de que el Cliente realice '
         'alguna de las actividades del Art. 17 LFPIORPI. Determinación basada en '
         'la ocupación declarada, no en respuesta del Cliente. Debe ratificarse por '
         'el Cliente en la próxima revisión anual.'
 where realiza_actividad_vulnerable is null
   and status = 'vigente';
-- ejecutado: UPDATE 26

-- --- 4 · El invariante, al final -------------------------------------------
-- Las dos columnas nulas («no consta») o las dos llenas («consta, y consta
-- quién lo dijo»). Nunca un valor sin saber quién lo dijo, nunca una
-- procedencia sin valor.
--
-- EL CONSTRAINT VA AL FINAL: puesto antes, el texto heredado de las 28 filas y
-- los estados intermedios lo violan y el script muere a la mitad.
--
-- ESCRITO CON `is null` A LOS DOS LADOS, y no como un `and` de condiciones
-- sueltas, porque un CHECK en Postgres PASA cuando la expresión da NULL. La
-- forma intuitiva —`realiza is not null and fuente in ('cliente','asesor')`—
-- evalúa a NULL para el estado (false, null) y lo dejaría entrar: justo el
-- estado que este constraint existe para impedir. `x is null` nunca devuelve
-- NULL, así que la expresión siempre es true o false.

alter table clientes
  add constraint clientes_actividad_vulnerable_procedencia
  check (
    (realiza_actividad_vulnerable is null) = (actividad_vulnerable_fuente is null)
    and (actividad_vulnerable_fuente is null
         or actividad_vulnerable_fuente in ('cliente', 'asesor'))
  );

commit;

-- --- Verificación · se corre aparte, después del commit --------------------
--
-- select status,
--        count(*)                                                        as clientes,
--        count(*) filter (where realiza_actividad_vulnerable is null)    as sin_respuesta,
--        count(*) filter (where actividad_vulnerable_fuente = 'asesor')  as por_asesor,
--        count(*) filter (where actividad_vulnerable_fuente = 'cliente') as por_cliente
--   from clientes
--  group by status
--  order by status;
