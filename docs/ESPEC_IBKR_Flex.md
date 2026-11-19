# Conexión a Interactive Brokers y clasificación de activos para reportes regulatorios CNBV

Especificación aportada por Claudio el 21-oct-2026, construida y probada en su desarrollo personal (no desplegado; solo datos propios). **Sirve como especificación del conector IBKR Flex que se portará a Bioongo CRM (bloque de diciembre, antes del R03 202612 que vence el 25-ene-2027).**

## Notas de integración con Bioongo CRM (21-oct-2026)

- Estado: Flex Web Service y Flex Query (ID 1649340) ya creados y funcionando en el desarrollo personal.
- Decisión recomendada: **un solo sistema genera el R03, y es Bioongo CRM** (persona↔cuenta, clasificación con procedencia, documentos y bitácora). Este documento se porta, no se duplica.
- Diferencias con lo decidido en Bioongo CRM, a resolver por Claudio (con el Oficial en lo regulatorio):
  - Universo del R03: aquí «contrato vigente al corte»; en Bioongo (25-sep) «cuenta abierta en IBKR al corte».
  - Conjuntas: aquí un código por contrato, reportado una vez; titulares no entran por sí mismos. Coincide con el histórico reportado (CSPFU1488, CSPFU8588) y resuelve el «R03 por persona» que quedó abierto para noviembre.
  - Sin carta: aquí 204 en el reporte. En Bioongo la clasificación NULL es alerta roja en el CRM; compatible si el generador del R03 traduce NULL → 204 con aviso.
  - Conjunta 203 solo si todos los titulares tienen carta: regla nueva para Bioongo.
- Según Claudio (21-oct), todos los clientes son 203 con carta firmada. En el CRM todavía constaban sin carta registrada CSPFU1988 (en firma) y CSPFU1889; conciliar.

---

Resumen técnico para replicar en otro desarrollo. Estado al 21-oct-2026. Todo lo que aquí se afirma se verificó contra el XML real de IBKR (sep–oct 2026) y contra el instructivo y la planilla oficial de la CNBV. La especificación completa del motor del R03 está en `claude/ESPEC_Motor_Reportes_CNBV_autocontenida.md`; este documento la complementa con la conexión y con todas las decisiones de clasificación tomadas después.

---

## 1 · Conexión a IBKR: Flex Web Service

### 1.1 Por qué Flex y no otra vía
- El conector conversacional/MCP de IBKR **no sirve**: devuelve una sola cuenta.
- El **Flex Web Service** entrega todas las cuentas cliente del advisor en un solo XML.

### 1.2 La Flex Query (configurada en el portal de IBKR, cuenta master)
`Performance & Reports → Flex Queries → Activity Flex Query`

| Parámetro | Valor |
|---|---|
| Nombre / ID | `BIOONGO_CNBV_SEMESTRAL` · Query ID **1649340** |
| Multi-Account Format | **Account by Account Bundle, Clients Only** (All-in-One pierde el `accountId`; Clients Only excluye la master de comisiones) |
| Formato | XML · fecha `yyyyMMdd` · hora `HHmmss` |
| Period | `Last Quarter` como respaldo. **Siempre se manda `fd`/`td` en la llamada** (ver 1.3) |
| Cuentas | **todas** las cuentas cliente (si la query tiene lista fija, las cuentas nuevas no aparecen) |
| Trades | **NO** marcar: infla el XML a decenas de MB y nada del reporte la usa |

Secciones y campos:

| Sección | Campos |
|---|---|
| Account Information | `accountId`, `acctAlias`, `name`, `accountType`, `currency` (= **moneda base**), **Date Opened**, **Date Funded** |
| Net Asset Value (NAV) in Base | `cash`, `stock`, `funds`, `total` |
| Change in NAV | `startingValue`, `endingValue`, `depositsWithdrawals`, `mtm`, `interest`, `dividends`, `twr` |
| Open Positions | `accountId`, `assetCategory`, `subCategory`, `symbol`, `description`, `position`, `markPrice`, `positionValue`, `currency`, `fxRateToBase` |
| Cash Report | `accountId`, `currency`, `endingCash`, `endingSettledCash` |

### 1.3 Llamadas
```
1) GET https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest
       ?t={TOKEN}&q=1649340&v=3&fd=AAAAMMDD&td=AAAAMMDD
   → <Status>Success</Status> + <ReferenceCode>
2) GET https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement
       ?t={TOKEN}&q={REFERENCE_CODE}&v=3
   → el XML
```
- **`fd` / `td` sobreescriben el Period de la query** (verificado en producción). Así una sola query sirve para el corte regulatorio, la foto diaria y cada ventana de rendimiento.
- **Validar** que el `toDate` de cada `<FlexStatement>` coincida con el `td` pedido; si no, se descarta esa respuesta y se reporta.
- Esperar entre las dos llamadas; ante `1019` (generándose) reintentar cada 5 s. En la práctica un reporte puede tardar hasta ~2 min.
- **Límite: 1 petición/s y 10/min por token, contando también las de "¿ya está listo?".**
- **Máximo 365 días** por petición.

| Código | Significado |
|---|---|
| 1012 | Token expirado (vence al año sin avisar; se regenera en el portal) |
| 1013 | Restricción de IP (apagarla si el backend sale por IPs rotativas) |
| 1016 | Cuenta inválida |
| 1019 | Generándose: reintentar |
| 1021 | Sin datos en el rango |

### 1.4 Seguridad
- Token y Query ID **solo como secretos del servidor** (`IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID`). Nunca en el navegador, el repositorio ni en conversaciones. El token da lectura de todas las cuentas de clientes.
- Todas las llamadas a IBKR desde servidor (Edge Function o equivalente).

### 1.5 Lectura del XML (trampas verificadas)
- **Moneda base por cuenta:** `AccountInformation/@currency`. En esta cartera **28 de 32 cuentas son MXN** y sus montos ya son pesos; solo 4 son USD.
- **Valor de una posición en moneda base:** `positionValue × fxRateToBase`.
- **Efectivo:** solo el `<CashReportCurrency currency="BASE_SUMMARY">`. Sumar los renglones por divisa lo duplica. Dos cifras (13-nov-2026): `endingSettledCash` (liquidado) es el renglón `EFECTIVO` de la foto; `endingCash` (total, con lo pendiente de liquidar) solo sirve para conciliar y **no se guarda**.
- **NAV de IBKR:** total de `EquitySummaryByReportDateInBase`, **la última fecha** (la sección trae varias). Se guarda como renglón de control `NAV_IBKR` (no suma) y se concilia contra posiciones + `endingCash`; diferencia > 0.5% → aviso. Como esa conciliación cuadra, el efectivo total se **deriva** de la foto como `NAV_IBKR − Σ posiciones` (semáforo 1.2.0, §3.2.14).
- **TWR** está en `ChangeInNAV`, no en la sección NAV. Cantidad = atributo `position`.
- **`&` sin escapar** (p. ej. `S&P 500`) rompe el parser si el XML se copió del navegador: re-escapar los `&` que no formen parte de una entidad válida.
- **Date Funded** = inicio real de la cuenta para rendimientos ("desde apertura").

### 1.6 Tres usos de la misma query, escribiendo en tablas distintas
| Uso | Rango | Escribe en | Nunca escribe en |
|---|---|---|---|
| Corte regulatorio semestral | `fd`=`td`= 30-jun o 31-dic | `posiciones_custodia` (por clasificación CNBV), `rendimientos_periodo`, bitácora de sincronización | — |
| Foto diaria (semáforo de cumplimiento) | último día hábil | `posiciones_detalle` (por ticker, + renglones `EFECTIVO` y `NAV_IBKR`) | `posiciones_custodia`, `rendimientos_periodo` |
| Desempeño | una petición por ventana (MTD, QTD, YTD, 12M, 12M-1, 12M-2, años cerrados) | `rendimientos_horizonte` | `posiciones_custodia`, `rendimientos_periodo` |

- **Un periodo ya enviado a la CNBV no se vuelve a sincronizar**: reescribiría la evidencia.
- Toda carga muestra un resumen de descuadres (cuentas sin cliente, clientes sin posiciones, clasificaciones desconocidas) y **no escribe hasta que el usuario confirma**.

### 1.7 Cuentas que se excluyen
- **Master del advisor** (cuenta de comisiones): fuera; *Clients Only* ya la excluye.
- **`cuentas_excluidas`**: cuentas que IBKR devuelve pero no son clientes (prospecto rechazado, cuentas por cerrar). Se ignoran en todo. El registro del prospecto se conserva por PLD.
- **Cuenta presente en IBKR sin cliente con contrato vigente** → lista "cuentas ignoradas" con motivo; **aviso, no error**.

---

## 2 · Clasificación para el R03 (catálogo CNBV "Clasificación del valor")

| IBKR `assetCategory` / `subCategory` | Clave CNBV |
|---|---|
| `STK` / `ETF` | **113** ETF |
| `STK` / `COMMON` | **101** Acciones |
| `STK` / `ADR`, `NY REG SHRS`, `GDR` | **101** Acciones (agregado oct-2026: una NY REG SHRS bloqueaba la sincronización) |
| `STK` / `CLOSED-END FUND` | **101** Acciones |
| `OPT` / `C` | **106** Opciones de compra |
| `OPT` / `P` | **105** Opciones de venta |
| `FUND` | 112 Fondos |
| `BOND` ≤ 1 año / > 1 año | 102 / 103 Deuda corto / largo plazo |
| `FUT` | 109 Futuros |
| Cash Report `BASE_SUMMARY` → `endingSettledCash` | **104** Efectivo |
| **Cualquier otra combinación** | **sin clasificar**: se devuelve al usuario. **Nunca se asigna por defecto** (una clasificación inventada es información falsa en un reporte regulatorio) |

Notas:
- La clasificación CNBV es por **vehículo** (un ETF de Treasuries es 113 ETF), a diferencia de la clasificación interna de cumplimiento (sección 3), que mira el subyacente.
- Para fines de reporte y del PL-03, **deuda del Tesoro de EUA = deuda gubernamental AAA, no deuda gubernamental mexicana**.
- Una posición en 0.00 **sí se emite** si el cliente tiene otras posiciones (así viene la planilla oficial).

---

## 3 · Clasificación interna de activos (cumplimiento del IPS)

No va al R03, pero es la clasificación que usa el sistema para los límites de la Guía de Servicios §7.5.

### 3.1 Catálogo de instrumentos
Tabla `catalogo_instrumentos` (~80 tickers): ticker, descripción, `asset_category`, `sub_category`, `clasificacion_cnbv` (101/113…), `clase_activo`, `es_equivalente_efectivo`, `elegible`, `duracion_efectiva`, nota, fecha de verificación. **Ningún mapeo de ticker vive en el código.**

Clases: `GOB_MX`, `GOB_EXT`, `GOB_EMERGENTE`, `CORP_IG`, `HIGH_YIELD`, `ACC_BMV`, `ACC_SIC`, `CRIPTO`, `MIXTO`, `DERIVADO`, `EFECTIVO`.

### 3.2 Decisiones de clasificación (tomadas por el Asesor, sep–oct 2026)
1. **Mirada a través: manda el subyacente.** Un ETF consume solo el límite de su subyacente; se eliminó el límite de "ETFs y fondos diversificados" como vehículo. Un ETF de Treasuries es deuda gubernamental (`GOB_EXT`).
2. **ETF mixtos se prorratean** (`catalogo_prorrateo`, factores que suman 1.00000): BND 72.0% gob / 28.0% corp · AGGU 68.63% / 31.37% · BNDX 76.22% / 22.79% / 0.99% efectivo · BNDW 74.05% / 25.47% / 0.48% efectivo. Cada fracción hereda la duración del ETF; la fracción de efectivo suma a liquidez.
3. **ETF fuera del catálogo** → `ACC_SIC` por defecto, con aviso "verificar subyacente y dar de alta".
4. **Acción fuera del catálogo** (`STK` con `COMMON`, `ADR`, `NY REG SHRS` o `GDR`) → `ACC_SIC` elegible, con aviso.
5. **Cualquier otro instrumento desconocido** → `NO_CATALOGADO`, crítico; no se asigna clase.
6. **Opciones** (`OPT`) → `DERIVADO`, nunca en el catálogo; derivados no permitidos (0%).
7. **IB01** (T-bills UCITS) = deuda gubernamental **y además equivalente de efectivo**.
8. **Equivalente de efectivo**: duración ≤ 1 año, liquidez diaria, soberano A- o superior, sin apalancamiento. Cuenta para liquidez y además consume el límite de su clase.
9. **Soberano emergente (EMB)**: renglón propio con techo igual a corporativo IG: 0 / 60 / 50 / 30 (Libre de riesgo / Bajo / Moderado / Alto); sujeto a BB+ y mínimo tres países; cuenta como renta fija.
10. **Libre de Riesgo**: solo deuda gubernamental con duración efectiva **menor a 3 años** (excluye TLT, IDTL, DTLA, AGGU 6.0, BND 5.8). Duración nula = incumple. En este perfil el efectivo cuenta para el piso de renta fija.
11. **Oro (GLD y similares) no elegible** mientras los manuales no lo incluyan (Política de Producto §3.1). Decisión de fondo pendiente: solo oro físico como alternativo.
12. **ARKF = `CRIPTO`, no elegible**.
13. **ZPDU** = `ACC_SIC`; **CBU7** = `GOB_EXT` duración 4.5.
14. **Saldo deudor de efectivo**: porcentajes sobre la suma de saldos positivos; hasta 1% del NAV es aviso, arriba es incumplimiento (apalancamiento prohibido por el Marco General).
    **Denominador y efectivo (semáforo 1.2.0, decisión de Claudio del 19-nov-2026):** el efectivo de la composición y del saldo deudor es el **total**, `NAV_IBKR − Σ posiciones` (= `endingCash`): si es positivo entra a la clase EFECTIVO y a la suma de positivos; si es negativo, es saldo deudor. La **liquidez** sigue con el efectivo **liquidado** (`endingSettledCash`; negativo no aporta) más los equivalentes. Motivo: con el liquidado, una compra por liquidar inflaba el denominador (CSPFU1390, 18-nov: GOB_EXT 39.4 % que sobre el NAV era 45.75 %) y una venta por liquidar lo achicaba (17-nov, 13 cuentas desfasadas); un liquidado negativo por una compra sin liquidar tampoco es préstamo de margen. Si liquidado y total difieren en más de 0.5 % del NAV, hallazgo **«liquidez desfasada», informativo: no cambia el color**. Sin cambio de esquema ni de carga: el motor lo deriva de la foto, también para fotos anteriores.
15. **Cuentas propias del Asesor**: exentas de los límites, se evalúan pero no cuentan en totales.
16. **Cuenta 100% en efectivo** = "sin invertir". **NAV ≤ 1,000 MXN** = inactiva, no se evalúa.

---

## 4 · Reglas del R03 J-0315 (además del layout de la especificación)

1. **Universo = contrato vigente a la fecha de corte**, no la cuenta del broker.
2. **Fecha de contrato obligatoria**: sin fecha y sin posiciones → fuera del universo con aviso; sin fecha **y con posiciones → ERROR que bloquea**.
3. **Estatus 301/302 con umbral de 1,000 MXN evaluado en pesos**, nunca en moneda base.
4. **Baja con transición**: el semestre en que termina el contrato se reporta en 302 con su saldo real; a partir del siguiente ya no aparece.
5. **Moneda**: `valor_mxn = (moneda_base = 'USD') ? valor_base × FIX : valor_base`. FIX del DOF del **último día hábil del periodo** (Banxico SF43718), guardado con el reporte.
6. **Tipo de persona** mapeado explícitamente (física 1, moral 2, fideicomiso 3); valor no reconocido = ERROR. Personas morales en la planilla de PM.
7. **Tipo de cliente es constitutivo**: sin Carta Anexo 1 firmada el cliente es **204**. 203 / 202 solo con la carta cargada y su fecha de firma.
8. **Cuenta conjunta = un código de cliente propio**; se reporta una sola vez. Cada titular tiene expediente individual sin cuenta de custodia, ligado a la conjunta; no entra por sí mismo al R03, a los totales ni al semáforo. La conjunta es 203 solo si **todos** los titulares tienen carta.
9. **Servicio** siempre 402 Gestión de Inversiones.
10. **Código de cliente** en MAYÚSCULAS.
11. **Clave del asesor (campo 2)** = clave CASFIM de 6 posiciones, configurable; verificar en SITI antes del primer envío.
12. **Bitácora del reporte generado** con SHA-256 del TXT, tipo de cambio, errores y avisos.

Otros reportes: R03 J-0314 solo si hay custodia en México; R27 B-2711 trimestral (vacío si no hubo reclamaciones). R14/R15 no aplican.

---

## 5 · Cifras de control
- Integración 25-sep-2026: 28 cuentas MXN = 31,980,642.67 + 4 USD = 695,226.58 × 18.30 → **44,703,289.08 MXN**. ~597.9 M = FIX aplicado a todo; 32.68 M = FIX no aplicado a USD.
- Conciliación NAV calculado vs NAV de IBKR en cuenta USD: 0.04%.

## 6 · Pendientes conocidos
- Verificar la clave CASFIM en SITI.
- Probar la sincronización semestral con el corte 31-dic en la primera semana de enero (plazo 25-ene).
- Revisión de manuales: oro como alternativo, redacción de equivalentes de efectivo, mirada a través, deuda extranjera en §7.5.2, moneda del retorno objetivo.

---

## 7 · Fase 2: foto diaria automática (operación)

Diseño aprobado por Claudio (Día 62; ajustes del 18-nov-2026). Código: `lib/foto-diaria-sistema.ts` (lógica), `supabase/functions/ibkr-foto-diaria` (Edge Function). Las funciones SQL y el cron se crean por `migraciones/` con el flujo migracion-segura; mientras no corran, nada de esto opera.

### 7.1 Qué hace
- pg_cron invoca la Edge Function `ibkr-foto-diaria` cada 20 min de 06:00 a 07:40 CDMX, lunes a viernes (`*/20 12-13 * * 1-5` en UTC; CDMX es UTC−6 todo el año), con la llave `FOTO_CRON_LLAVE` (secretos de Supabase + Vault).
- Cada ejecución da un paso sobre el td (último lunes-viernes antes de hoy): pedir la Flex → recogerla (si IBKR aún genera, espera a la siguiente; si llega sin NAV, la siguiente vuelve a pedir) → cargar con `fn_cargar_ibkr_sistema` (mismas reglas que `cargar-foto.mjs`) → FIX del td (reglas de `fix.mjs`) → semáforo con usuario `sistema:ibkr-cron`, solo con foto y FIX del td.
- td feriado de NYSE (`lib/calendario-nyse.ts`) → «omitido», sin pedir nada a IBKR. El calendario cubre hasta `CUBIERTO_HASTA` (2027-12-31): actualizarlo cada año antes de diciembre.
- Cada paso deja un evento en `ibkr_cron_eventos` (solo agregar, sin secretos ni números de cuenta). A las 08:00 un control registra «error» si el td no quedó «cargado», «ya_cargado» u «omitido»; eso es lo que muestra la pantalla Hoy.
- El corte semestral del R03 NO pasa por aquí: sigue exigiendo confirmación humana.

### 7.2 Recuperar a mano un día que falló
Si el control de las 08:00 marcó «error» (o la pantalla Hoy no muestra la foto del td):

1. **Ver qué pasó** (MCP, solo lectura): los eventos del td en `ibkr_cron_eventos` (paso, resultado y `detalle.mensaje`). Causas típicas: IBKR sin NAV las tres veces, token de IBKR vencido (código 1012), Banxico caído, FIX distinto del registrado.
2. **Foto** (si no quedó cargada), con la carga de la fase 1; la corre Claudio con «!»:
   - `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ibkr/cargar-foto.mjs --usuario <correo> --td AAAAMMDD` → vista previa, ensayo y clave;
   - la misma línea con `--confirmar <clave>` → real.
   `--td` va SIN guiones (formato de IBKR). Sirve para cualquier día pasado (fd = td).
3. **FIX** (si no quedó): `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/banxico/fix.mjs --usuario <correo> --fecha AAAA-MM-DD`, y luego con `--confirmar <clave>`. Aquí la fecha va CON guiones.
4. **Semáforo** (si no quedó): `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/semaforo/evaluar.mjs --sync <uuid de la foto>` en seco; luego `--registrar sí --usuario <correo>` y `--confirmar <clave>`.

Notas:
- Si la foto se recupera a mano ANTES de las 07:40, la siguiente ejecución automática la ve («ya_cargado») y completa sola el FIX y el semáforo; no hace falta el paso 3 ni el 4.
- Nada se duplica: la base rechaza una segunda foto del mismo td (IB409), un FIX repetido (IB409) y un semáforo repetido de la misma foto y versión del motor (UNIQUE). Un rechazo así significa «ya estaba», no un fallo.
- Lo recuperado a mano queda firmado con el correo de quien lo corre; lo automático, con `sistema:ibkr-cron`.

### 7.3 Apagar el cron
Tres maneras, de la más suave a la más definitiva. Cualquiera de ellas es una escritura en producción: se hace con aprobación de Claudio y queda anotada (bitácora o commit).

1. **Pausar** (reversible, conserva la programación):
   `select cron.alter_job(jobid, active := false) from cron.job where jobname in ('ibkr-foto-diaria', 'ibkr-foto-diaria-control');`
   Para reanudar, lo mismo con `active := true`.
2. **Cortar la llave**: borrar `FOTO_CRON_LLAVE` de los secretos de la función (o cambiarla solo ahí). El cron sigue disparando, pero la función responde 401 y no hace nada. Útil si se sospecha de la llave.
3. **Quitar la programación** (definitivo; para volver hay que correr de nuevo la migración del cron):
   `select cron.unschedule('ibkr-foto-diaria'); select cron.unschedule('ibkr-foto-diaria-control');`

Con el cron apagado, la foto diaria vuelve a la fase 1 (§7.2, pasos 2 a 4). La función, las tablas y los eventos se quedan, inertes.
