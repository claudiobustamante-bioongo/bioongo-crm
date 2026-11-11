# SPEC de build · Bioongo CRM v1 · 10-nov-2026

Solo códigos. Sin nombres, RFC, CURP ni correos. Puede ir al repo en `docs/`.

**Propósito:** llevar Bioongo CRM (Next.js 16 + Supabase, repo `~/bioongo-crm`) a la versión 1: un cliente nuevo entra de punta a punta desde la app, el comité revisa su cartera cada día, Yoko alarma por cliente contra los manuales, el R03 sale de aquí, y todo con una interfaz al nivel de un producto que se vende. Lovable queda cerrado: sirvió para diseñar los huecos; aquí se construye lo real.

**Base de esta revisión:** producción leída por MCP (solo lectura) el 10-nov-2026 y el historial de migraciones del repo. Las estadísticas de filas del MCP marcan 0 en todas las tablas; son estimaciones, no conteos. Los conteos reales están abajo.

---

## 0 · Principios no negociables

1. Nada regulatorio como constante en código: límites, umbrales, plazos, mapeos y fechas de control viven en tablas.
2. Secretos solo en servidor: `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID` (1649340), `BANXICO_TOKEN`. Nunca en el navegador, el repo ni el chat. `.env.local` se edita con nano.
3. Evidencia de solo agregar: bitácoras, documentos, cargas, reportes, acreditaciones, incidencias y journal no se borran ni reescriben; una corrección es un renglón nuevo (`fn_solo_agregar`, tablas `_historico`).
4. Nunca un default silencioso en algo regulatorio: lo desconocido es error o «sin clasificar» visible.
5. El semáforo y Yoko diagnostican, no operan. Ningún botón opera en IBKR.
6. Toda carga regulatoria muestra descuadres y no escribe hasta que Claudio confirma. La foto diaria se carga sola y avisa.
7. Pruebas primero: si una falla se arregla el código, no la prueba. Los tests se validan con mutaciones (un test que nunca falló no demuestra nada).
8. Escrituras a producción solo por psql con la skill `migracion-segura` (réplica → guardas MCP → ensayo → md5 → real → verificación independiente). MCP siempre en solo lectura.
9. Diseño y build van juntos: cada módulo entrega su pantalla terminada en la misma sesión, construida sobre el sistema de diseño (§4).

---

## 1 · Inventario real de Bioongo (10-nov-2026)

| Módulo | Qué existe | Estado |
|---|---|---|
| Expediente / KYC | `clientes` (36), `kyc_detalle`, `pep_listas`, `propietario_real`, `beneficiarios`, `transaccionalidad`, `codigos_alias` | En producción con datos |
| Persona ↔ cuenta | `personas` (32), `cuentas_ibkr` (35), `cuenta_titulares` (40) + históricos. Bloque 1 del contract corrido (persona_id en las tablas hijas, identidad copiada) | Faltan bloques 2–5 (lectores y NOT NULL) |
| Perfil e IPS | `perfil_riesgo` (+ histórico), `portafolios`, motor `ips-engine.ts`, IPS masivo cerrado | En producción |
| PLD | `ebr_evaluaciones` (EBR masivo con PEP), `listas_control`, `listas_registros`, `listas_coincidencias`, `firmas_cumplimiento`, `cliente_bloqueos` + históricos; `fn_resolver_coincidencia`, `fn_levantar_bloqueo` | En producción |
| Documentos | `documentos_expediente` (28 cartas), bucket privado `expediente`, `fn_registrar_documento`, `fn_registrar_consulta_documento` | Funciona; faltan tipos (D3) |
| Clasificación CNBV | Columnas en `clientes` con CHECKs de procedencia; 203 solo por carta | Ver D2 |
| Bajas | `status`, `fecha_baja`, `motivo_baja`; regla: fecha_baja = fecha de registro, fecha real en el motivo | Falta pantalla con fecha real obligatoria (bloque 4) |
| Catálogo | `catalogo_instrumentos`, `catalogo_prorrateo` (vacíos) | D1 bloquea la carga |
| IBKR | `sync_ibkr`, `posiciones_detalle` (con `conid`), `rendimientos_horizonte`, `fn_cargar_ibkr`; `lib/ibkr-flex.ts` con 21 tests | Falta quien lo llame (ruta + cron) |
| Bitácora | `bitacora` (1 648 asientos), `trg_bitacora` en 17 tablas | Completo |
| Migraciones | 8 archivadas en `migraciones/` con md5, cabecera de verificación y regla `AAAA-MM-DD-NN-asunto.sql`; réplica PGlite en `scripts/replica/` | Completo; no se cambia a `supabase/migrations` |

**No existe todavía:** límites y parámetros del IPS en tablas, motor del semáforo, incidencias, motor R03 con evidencia, tipo de cambio, cuentas excluidas, acreditaciones con historial, journal del comité, Yoko, liga de Drive, onboarding desde la app, login, despliegue, sistema de diseño.

---

## 2 · Defectos del esquema (corregir en la migración 02, antes de cargar datos)

| # | Defecto | Corrección |
|---|---|---|
| D1 | `catalogo_clase_valida` no admite `COMMODITY` ni `APALANCADO` (5 tickers del catálogo real) | Agregar ambas clases al CHECK del catálogo y del prorrateo. CHECK nuevo: clase en (COMMODITY, APALANCADO, CRIPTO, DERIVADO) ⇒ `elegible = false` |
| D2 | `clientes_clasificacion_carta` exige 203 si la fuente es carta; un calificado (202) por carta no cabe | Primero el dato: CSPFU2963 está hoy como 203 por carta del 2026-10-14. Claudio decide con la carta en mano si es 202. Si lo es, se relaja el CHECK a (202, 203) y después se reemplaza el modelo por `acreditaciones_cliente` (M8) |
| D3 | `documentos_tipo_valido` solo admite carta_clasificacion, identificacion, comprobante_domicilio, constancia_fiscal, contrato | Agregar `ips_firmado`, `constancia_pl03`, `expediente_apertura`, `aviso_cliente`, `evidencia_remediacion`, `otro`, en el CHECK y en `fn_registrar_documento` |
| D4 | `sync_uso_valido` solo admite foto_diaria y rendimiento | Agregar `corte_regulatorio` (fd = td = 30-jun o 31-dic) y su regla en `sync_ventana_por_uso` |
| D5 | `clientes.cuenta_ibkr`, `es_conjunta`, `codigo_cotitular` conviven con `cuentas_ibkr` / `cuenta_titulares` | Es el contract, bloques 2–5, ya planeado. No se retira nada hasta que los lectores migren con 0 cambios de perfil y 0 diferencias de EBR |
| D6 | Documentos solo PDF ≤ 4 MB | Se mantiene; la UI lo dice y convierte. Subir a 20 MB si aparece un expediente grande |

---

## 3 · Módulos que faltan

### M1 · Catálogo y parámetros (sustituye a «migrar desde Lovable»)
Los clientes ya viven aquí; de Lovable solo se traen datos de referencia, por CSV, sin nombres.
- `docs/catalogo_instrumentos.csv` (80 tickers) y `docs/catalogo_prorrateo.csv` (10 filas, 4 tickers, cada uno suma 1.00000) → migración 02, misma transacción (el trigger de suma valida al cerrar). Requiere D1. `verificado_en` vacío en 54 tickers: se cargan NULL y se fechan al verificarlos.
- Pendientes de alta: XDWH, MVOL, TIP5 y cualquier UCITS comprado en oct-2026 fuera de los 80. Regla PI-02 §6: alta en catálogo antes de comprar.
- `IVVPESOISHRS`: confirmar en la primera descarga que es el símbolo que manda IBKR.

### M2 · Conexión IBKR y tipo de cambio
- Ruta server-only que usa `lib/ibkr-flex.ts` y entrega a `fn_cargar_ibkr`. Cron de Vercel cada día hábil: `fd = td = último día hábil`, uso `foto_diaria`, carga automática, descuadres al panel.
- Botones: «Actualizar desempeño» (ventanas MTD, QTD, YTD, 12M, 12M-1, 12M-2, años cerrados una vez, desde apertura) y «Cargar corte semestral» (D4), ambos con vista previa de descuadres y confirmación.
- `cuentas_excluidas(cuenta_ibkr, motivo, desde)`: se ignoran en todo. Cuenta en IBKR sin contrato vigente → «ignorada» con aviso. Cuentas con baja en el CRM quedan fuera aunque IBKR las tenga abiertas (CSPFU1889).
- `tipo_cambio(fecha, serie, valor, fuente, capturado_en)`: FIX Banxico SF43718 por API SIE con `BANXICO_TOKEN`; día sin FIX → hábil anterior.
- Nunca resincronizar un corte ya reportado a la CNBV.

### M3 · Reglas de clasificación (motor)
Ya decididas (ESPEC_IBKR_Flex §3): mirada a través, prorrateo de mixtos, ETF fuera de catálogo → ACC_SIC + aviso, STK fuera de catálogo → ACC_SIC elegible + aviso, desconocido → NO_CATALOGADO crítico, OPT → DERIVADO, equivalentes de efectivo (duración ≤ 1 año, liquidez diaria, soberano A− o mejor) cuentan para liquidez y para su clase. No elegibles: COMMODITY, APALANCADO, CRIPTO, DERIVADO.

### M4 · Parámetros y límites del IPS (tablas sembradas)
- `limites_fase(fase, rv_max, rf_min, liquidez_min)`: Desarrollo 70/20/5 · Aceleración 85/10/5 · Acumulación 75/20/5 · Consolidación 60/30/10 · Retiro 40/50/10.
- `limites_perfil(perfil, clase_activo, max_pct)` para Libre de riesgo / Bajo / Moderado / Alto: GOB_MX y GOB_EXT 100/100/70/40 · CORP_IG 0/60/50/30 · GOB_EMERGENTE 0/60/50/30 · HIGH_YIELD 0/0/10/20 · ACC_BMV 0/10/30/50 · ACC_SIC 0/20/60/85 · DERIVADO, CRIPTO, COMMODITY, APALANCADO 0.
- `reglas_perfil(perfil, duracion_max_gob, liquidez_min, efectivo_cuenta_rf, retorno_min, retorno_max)`: Libre de riesgo <3 / 5 / sí / 4.0–5.5 · Bajo — / 5 / no / 5.5–7.5 · Moderado — / 5 / no / 7.5–9.5 · Alto — / 3 / no / ≥ 9.5.
- `parametros_cumplimiento(clave, valor, nota)`: nav_residual_mxn 1000 · vigencia_ips_anios 2 · saldo_deudor_tolerancia_pct 1 · rebalanceo_tolerancia_pts 5 · conciliacion_nav_tolerancia_pct 0.5 · plazo_remediacion_dias_habiles 30 · aviso_vencimiento_dias 7 · fecha_inicio_control (decidir: 2026-09-30 o arranque en Bioongo) · aplicar_limite_vehiculos (bool, para la lectura literal de PI-02 §3 que aplica Yoko mientras el manual no cambie).

### M5 · Semáforo de cumplimiento
`evaluar_cuenta(cuenta, fecha)` sobre la foto más reciente ≤ fecha. Orden: cuenta propia → EXENTO · sin perfil o IPS > 2 años → SIN_PERFIL · sin datos → SIN_DATOS · NAV ≤ 1 000 MXN → INACTIVA · 100 % efectivo → ÁMBAR «sin invertir». Pruebas P1 elegibilidad (crítico), P2 techo por clase, P3 duración, P4 fase (RV, RF, liquidez), P5 más restrictivo con `origenes[]`, saldo deudor (≤ 1 % aviso, > 1 % incumple). ROJO con crítico/incumple, ÁMBAR solo informativos, VERDE limpio. Conjunta: perfil más conservador; si falta uno → SIN_PERFIL. Universo: vigentes con cuenta, sin excluidas, master ni bajas. Vista `v_comite_cartera` solo con códigos. 22 pruebas (bloque D de Lovable, sin nombres).

### M6 · Incidencias y remediación
`incidencias_cumplimiento` + `incidencias_acciones` (solo agregar; cambio de estado por función que escribe la acción en la misma transacción). Solo crítico/incumple generan incidencia; clave estable por límite; detección = máx(primera evidencia, fecha_inicio_control); plazo = +30 días hábiles; cierre solo automático cuando el semáforo deja de verlo; reincidencia ligada; baja → cierre BAJA_CLIENTE. Acciones: AVISO_CLIENTE, INSTRUCCION_REBALANCEO, REBALANCEO_EJECUTADO, PRORROGA (justificación y plazo), CAMBIO_IPS, CAMBIO_MANUAL, NOTA; evidencia como documento `evidencia_remediacion`. Prueba explícita de que no existe vía de reescritura.
Histórico a cargar de Lovable (detección 2026-09-30, plazo 2026-11-11), por código: GLD en dos cuentas de una persona + RF y liquidez de su conjunta; liquidez en una cuenta; ACC_SIC en una; ARKF/CRIPTO en una; HIGH_YIELD en una (resuelta, previa al control).

### M7 · Cartera y desempeño
Cartera al último día hábil: NAV_IBKR, pesos al FIX, % por clase con prorrateo, real vs objetivo del IPS (ámbar si |dif| > 5 pts). Desempeño desde `rendimientos_horizonte`: TWR de IBKR en moneda base, sin recalcular; ≤ 1 año sin anualizar; 3 años compuesto y anualizado; «desde apertura» no se compara contra el rango del perfil antes de 12 meses. Nota fija de rendimientos pasados. Pendiente de manual: moneda del retorno objetivo.

### M8 · Clasificación CNBV con documento (reemplaza D2)
`acreditaciones_cliente(persona_id, documento_id, categoria 202|203, vigente_desde = fecha_documento, …)` y `historial_tipo_cliente(...)`, ambas solo agregar. La acreditación es de la persona. `tipo_cliente(cuenta, fecha)`: individual → acreditación vigente del titular, si no 204; conjunta → todos los titulares acreditados, si falta uno 204, si no el código más protector. El R03 usa `tipo_cliente(cuenta, corte)`, nunca un campo editable. Una carta solo cuenta con casillas de interés y requisito marcadas. Verificar CSPMU7486 y su conjunta CSPMU3071 (con CSPFU1988), y CSPMU1062 (con CSPFU8973). Confirmar la fecha de firma de la acreditación de CSPFU2963.

### M9 · Motor R03 J-0315, evidencia y R27
Reglas: universo = contrato vigente al corte; sin fecha de contrato y con posiciones → error que bloquea; 301/302 con umbral 1 000 MXN en pesos; baja con transición (el semestre de la baja va en 302 con saldo real); FIX solo a cuentas USD; tipo de persona mapeado explícito; tipo de cliente = `tipo_cliente(cuenta, corte)`; conjunta = un código; servicio 402; entidad 120; código en mayúsculas; clave CASFIM como parámetro (verificar en SITI). NULL → 204 con aviso.
Evidencia: `reportes_regulatorios` (sha256, ruta en Storage, tipo de cambio, errores, avisos, estatus generado | enviado_siti | acusado, acuse como documento) y `reportes_regulatorios_renglones`, solo agregar. Un solo «enviado_siti» por periodo, y exige acuse. Registrar el R03 202606 enviado con su hash. Revisar que CSPFU1889 y CSPMU1089 fueron 302 en 202606; CSPFU6964 y CSPFU7371 van 302 en 202612.
R27 B-2711: `reclamaciones` + generador (vacío si no hubo). J-0314 no aplica.

### M10 · Bajas
Pantalla con fecha real de cierre obligatoria (campo de fecha), casilla «cuenta abierta en IBKR solo para consulta», motivo con formato fijo. Efectos: fuera del semáforo, totales y desempeño; cierre de incidencias; transición en R03. Modo «archivo histórico» para cartas de bajas (CSPFU8385).

### M11 · Comité de inversión: journal y Yoko
`journal_comite`, `journal_ejecuciones`, `yoko_verificaciones` (15 puntos, PASA | NO_PASA | NO_VERIFICADO, fuente y detalle), `journal_postmortem`; todo solo agregar. Yoko verifica: bloqueo PLD, contrato, perfil vigente, IPS y PL-03 firmados (requiere D3), universo, alta en catálogo, P2/P4 post-operación con cartera simulada (reusa M5), límite de vehículos literal, emisora/sector (NO_PASA para acciones individuales hasta que exista el límite en manuales), emergentes, sin apalancamiento, congruencia con IPS, precedencia (cuentas propias después de clientes, nunca en bloque), journal completo. Salida binaria por cuenta; reporta los 15 puntos aunque falle el primero. El agente redacta; Claudio firma; la firma queda en bitácora.
Asientos post-hoc: 2026-10-16 XDWH y MVOL (una cuenta, sin alta en catálogo); 2026-10-20 traducción a UCITS de CSPFU2963 (IB01, TIP5, IBTA, SDIA, MVOL).

### M12 · Onboarding desde la app
Modelo y función → KYC + PEP → IPS + beneficiarios → documentos + cuentas conjuntas. Sin Google Forms. Es lo que convierte a un prospecto en cliente sin tocar la base a mano.

### M13 · Login, Fase G, Vercel Pro
Auth de Supabase, anon key → publishable, RLS por rol, despliegue en Vercel Pro con el cron de M2.

### M14 · Liga de Drive por cliente
`drive_folder_id`, `drive_folder_nombre`, editables solo con URL de drive.google.com o docs.google.com, con bitácora y filtro «sin carpeta».

---

## 4 · Diseño y usabilidad (en paralelo, nunca después)

- **Sistema de diseño una sola vez, antes de la primera pantalla nueva:** tokens (color, tipografía, espaciado, estados), componentes base (tabla densa, ficha, semáforo, formulario por pasos, panel de descuadres, memo del comité) sobre Tailwind + shadcn/ui. Se documenta en el repo (`docs/diseno/`) y, si conviene, como librería en Figma para revisarlo visualmente.
- **Cada módulo entrega su pantalla en la misma sesión**, con los estados vacío, cargando, error y éxito, y con los textos finales (sin «lorem», sin códigos crudos donde deba ir una etiqueta).
- **Criterio de «UX al 100» por pantalla:** una tarea principal visible, cero pasos que se puedan hacer solos, errores explicados en lenguaje de negocio, acciones destructivas con confirmación y bitácora, teclado y responsive, menos de 3 clics para lo diario (semáforo, ficha, carga).
- **Auditoría de usabilidad cada 3 módulos:** se recorre el flujo completo como lo haría Claudio un lunes a las 8 am, y se corrige antes de seguir.

---

## 5 · Orden de build y criterio de terminado

| Paso | Contenido | Terminado cuando |
|---|---|---|
| 1 | Migración 02: D1, D3, D4, catálogo + prorrateo (M1) | 80 tickers cargados sin error, verificado por MCP |
| 2 | M4 parámetros + M3 reglas + sistema de diseño (§4) | Tablas sembradas; tokens y componentes base en el repo |
| 3 | M2 ruta de carga + cron + tipo de cambio | Primera descarga real; NAV concilia contra IBKR ≤ 0.5 % |
| 4 | M5 semáforo + M7 cartera (pantallas) | 22 pruebas; vista del comité por cuenta |
| 5 | M6 incidencias + M11 journal y Yoko | Una operación de prueba recorre Syd → Kurt → Yoko → firma |
| 6 | D2 / M8 acreditaciones | Diferencias revisadas por Claudio y aplicadas con historial |
| 7 | M9 R03 + evidencia + R27, M10 bajas | 12 pruebas + integración 44 703 289.08 MXN + R03 202606 registrado con hash |
| 8 | Contract bloques 2–5 (D5) | 0 cambios de perfil, 0 diferencias de EBR, NOT NULL |
| 9 | M12 onboarding | Un cliente de prueba entra completo desde la app |
| 10 | M13 login + Vercel Pro, M14 Drive | Desplegado, cron corriendo, auditoría de usabilidad final |

**Fecha dura:** corte del R03 al 31-dic-2026, envío el 25-ene-2027. Los pasos 1–7 deben estar en producción y probados con el corte real en la primera semana de enero. A 4 sesiones por semana, v1 completa a finales de enero o mediados de febrero de 2027.

---

## 6 · Pendientes de negocio (no los resuelve el código)

1. **Vencen el 11-nov-2026** las incidencias de Lovable (GLD, liquidez, ACC_SIC, ARKF). Verificar en IBKR cuáles ya se corrigieron.
2. CSPFU2963: ¿202 o 203? Con la carta en mano.
3. Clave CASFIM en SITI.
4. Revisión de manuales con Erick: mirada a través (PI-02 §3), equivalentes de efectivo, precedencia en el Manual de Conducta, límites por emisora/sector y PI-04 para acciones, oro como alternativo, deuda extranjera en §7.5.2, moneda del retorno objetivo, dependientes (#13), «Empleado Gubernamental» (p. 99).
5. Alta en catálogo de XDWH, MVOL, TIP5 y demás UCITS de octubre.
6. Estado de los expedientes de prospectos rechazados (se conservan por PLD).
7. Carta de CSPFU1988; clasificación de CSPFU1889; dependientes #13.
8. AMIB: recordatorio el 20-dic. R03 202612 el 25-ene-2027.
