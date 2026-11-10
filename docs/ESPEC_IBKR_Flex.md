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
- **Efectivo:** solo el `<CashReportCurrency currency="BASE_SUMMARY">`, campo `endingSettledCash`. Sumar los renglones por divisa lo duplica.
- **NAV de IBKR:** total de `EquitySummaryByReportDateInBase`, **la última fecha** (la sección trae varias). Se guarda como renglón de control `NAV_IBKR` (no suma) y se concilia contra posiciones + efectivo; diferencia > 0.5% → aviso.
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
