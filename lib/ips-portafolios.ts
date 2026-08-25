/**
 * MOTOR DE PORTAFOLIOS · CABZ
 * ---------------------------------------------------------------------------
 * Construye los 20 portafolios (5 fases × 4 perfiles) sobre DOS universos de
 * instrumentos, seleccionables por cliente:
 *
 *   UNIVERSO_UCITS · ETFs irlandeses de acumulación, clase USD.
 *   UNIVERSO_EEUU  · ETFs domiciliados en Estados Unidos.
 *
 * Los universos comparten TODA la lógica: las 20 filas de PORTAFOLIOS, los
 * límites por fase (7.5.1), los topes por perfil (7.5.2), el reescalado por
 * liquidez y el piso de posición mínima. Lo único que cambia es qué instrumento
 * ocupa cada clase de activo. Cambiar de universo NO recalcula la rejilla.
 *
 * La diferencia entre los dos no es de rendimiento esperado sino de régimen
 * sucesorio: el domicilio irlandés elimina la exposición al impuesto sucesorio
 * de EE.UU. para no residentes; el domicilio estadounidense la mantiene, con
 * exención de 60,000 USD y tasa marginal de hasta 40%. Ver advertenciasFiscales
 * de cada universo.
 *
 * Este módulo cubre los pasos 5 a 7 de la metodología IPS. Los pasos 1 a 4
 * (fase, tolerancia, capacidad, perfil) no cambian: viven en ips-engine.ts.
 *
 * ---------------------------------------------------------------------------
 * PROCEDENCIA DE LOS PESOS · leer antes de modificar cualquier peso
 * ---------------------------------------------------------------------------
 * FUENTE DE VERDAD: Metodologia_IPS_CABZ.xlsx, hoja "Universo".
 * Cotejado por Claudio el 2026-08-25.
 *
 * Existe fuera de este repositorio un generador en Python que produjo una
 * versión anterior de estos pesos y que quedó DESACTUALIZADO (proponía la clase
 * de acciones del universo EE.UU. sumando 0.86, sin VWO). Si este archivo y el
 * generador discrepan, gana el manual. Ante cualquier duda futura, cotejar
 * contra la hoja "Universo" y actualizar aquí, no reconstruir de memoria.
 */

// ============================================================================
// Tipos
// ============================================================================

export type Fase = "Desarrollo" | "Aceleracion" | "Acumulacion" | "Consolidacion" | "Retiro";
export type PerfilRiesgo = "Libre de Riesgo" | "Bajo" | "Moderado" | "Alto";

/** Universo de instrumentos. Se elige por cliente. */
export type Universo = "UCITS" | "EEUU";

/** Plaza natural del universo: dónde cotiza el instrumento en su mercado de origen. */
export type PlazaOrigen = "LSE" | "US";

/**
 * Ruta de ejecución.
 *   "Origen" → mercado propio del universo (LSE para UCITS, EE.UU. para EEUU),
 *              cuenta en el extranjero.
 *   "SIC"    → Sistema Internacional de Cotizaciones, en pesos, casa de bolsa MX.
 */
export type Ruta = "Origen" | "SIC";

/** Plaza concreta por la que termina ejecutándose una posición. */
export type PlazaEjecucion = PlazaOrigen | "SIC";

export type ClaseActivo =
  | "Efectivo"
  | "Deuda Gubernamental"
  | "Deuda Corporativa IG"
  | "High Yield"
  | "Acciones Globales"
  | "Satelite Tecnologia";

/** Sustituto ejecutable: mismo rol en la cartera, NO necesariamente mismo índice. */
export interface Sustituto {
  isin: string | null;
  ticker: string;
  tickerSIC: string | null;
  sicVerificado: boolean;
  nombre: string;
  ter: number | null;
  /** Se emite como advertencia cuando el sustituto entra en juego. */
  motivo: string;
}

export interface Instrumento {
  /** Llave canónica. NUNCA cambia entre bolsas. null = no capturado aún. */
  isin: string | null;
  /** Clave en la plaza de origen del universo (LSE para UCITS, NYSE Arca/Nasdaq para EEUU). */
  ticker: string;
  /**
   * Clave de pizarra en el SIC. null = NO VERIFICADA.
   * Debe confirmarse con la casa de bolsa contra el ISIN, no contra el ticker
   * de origen: la clave del SIC puede diferir de la de la plaza de origen.
   */
  tickerSIC: string | null;
  /**
   * true solo cuando la clave fue cotejada CONTRA EL ISIN en el sistema de la
   * casa de bolsa (cotización viva o listado oficial). Un tercero que la
   * escriba en un correo NO es verificación: una clave errónea no falla, manda
   * la orden a otro instrumento.
   *
   * ALCANCE: esta bandera gobierna ÚNICAMENTE la ruta "SIC". Por ruta "Origen"
   * no se consulta, porque el ticker de la plaza de origen es la clave canónica
   * del mercado donde se opera.
   */
  sicVerificado: boolean;
  nombre: string;
  ter: number | null;
  /** Peso dentro de su clase de activo. Los de una clase suman 1. */
  peso: number;
  /** Se usa cuando el titular no es ejecutable por la ruta elegida. */
  sustitutoSIC?: Sustituto;
}

export interface DefinicionUniverso {
  clave: Universo;
  plazaOrigen: PlazaOrigen;
  /** Nombre de la clase según el manual, para el IPS impreso. La llave interna no cambia. */
  etiquetas: Partial<Record<ClaseActivo, string>>;
  /** Parcial a propósito: las clases no son idénticas entre universos. */
  instrumentos: Partial<Record<ClaseActivo, readonly Instrumento[]>>;
  advertenciasFiscales: (ruta: Ruta) => string[];
}

export interface Posicion {
  isin: string | null;
  ticker: string;
  nombre: string;
  clase: ClaseActivo;
  peso: number;
  /** Plaza por la que se ejecuta esta posición en concreto. */
  rutaEjecucion: PlazaEjecucion;
}

/** Una línea por ticker: lo que se manda a la mesa. Consolida clases. */
export interface LineaOrden {
  isin: string | null;
  ticker: string;
  nombre: string;
  peso: number;
  plaza: PlazaEjecucion;
  /** Clases que aporta este ticker. Más de una = el mismo valor sirve a dos roles. */
  clases: ClaseActivo[];
}

export interface Validacion {
  regla: string;
  valor: number;
  limite: number;
  cumple: boolean;
}

export interface ResultadoPortafolio {
  clave: string;
  universo: Universo;
  plazaOrigen: PlazaOrigen;
  fase: Fase;
  perfil: PerfilRiesgo;
  ruta: Ruta;
  liquidez: number;
  asignacionClases: Record<ClaseActivo, number>;
  etiquetasClases: Partial<Record<ClaseActivo, string>>;
  rentaVariable: number;
  rentaFija: number;
  /** Desglose por instrumento Y clase. Es lo que va al IPS. */
  posiciones: Posicion[];
  /** Consolidado por ticker. Es lo que va a la orden. */
  ordenConsolidada: LineaOrden[];
  validaciones: Validacion[];
  limitesOk: boolean;
  advertencias: string[];
  bitacora: string[];
}

// ============================================================================
// UNIVERSO A · UCITS irlandeses de acumulación, clase USD
// ============================================================================

const INSTRUMENTOS_UCITS: Partial<Record<ClaseActivo, readonly Instrumento[]>> = {
  "Efectivo": [
    { isin: "IE00BGSF1X88", ticker: "IB01", tickerSIC: "IB01N", sicVerificado: true, nombre: "iShares $ Treasury Bond 0-1yr UCITS ETF USD (Acc)", ter: 0.0007, peso: 1.0 },
  ],
  "Deuda Gubernamental": [
    { isin: "IE00BYXPSP02", ticker: "IBTA", tickerSIC: "IBTAN", sicVerificado: true, nombre: "iShares $ Treasury Bond 1-3yr UCITS ETF USD (Acc)", ter: 0.0007, peso: 0.45 },
    { isin: "IE00B1FZSC47", ticker: "IDTP", tickerSIC: "IDTPN", sicVerificado: true, nombre: "iShares $ TIPS UCITS ETF USD (Acc)", ter: 0.0010, peso: 0.35 },
    { isin: "IE00BFM6TC58", ticker: "DTLA", tickerSIC: "DTLAN", sicVerificado: true, nombre: "iShares $ Treasury Bond 20+yr UCITS ETF USD (Acc)", ter: null, peso: 0.20 },
  ],
  "Deuda Corporativa IG": [
    { isin: "IE00BYXYYP94", ticker: "SDIA", tickerSIC: "SDIAN", sicVerificado: true, nombre: "iShares $ Short Duration Corp Bond UCITS ETF USD (Acc)", ter: null, peso: 0.55 },
    { isin: "IE00BYXYYJ35", ticker: "LQDA", tickerSIC: "LQDAN", sicVerificado: true, nombre: "iShares $ Corp Bond UCITS ETF USD (Acc)", ter: null, peso: 0.45 },
  ],
  "High Yield": [
    { isin: "IE00BYXYYL56", ticker: "IHYA", tickerSIC: "IHYAN", sicVerificado: true, nombre: "iShares $ High Yield Corp Bond UCITS ETF USD (Acc)", ter: 0.0050, peso: 1.0 },
  ],
  "Acciones Globales": [
    { isin: "IE00B4L5Y983", ticker: "IWDA", tickerSIC: "IWDAN", sicVerificado: true, /* MEXI confirmado 2026-08-15 (el "IWSAN" inicial fue dedazo) */ nombre: "iShares Core MSCI World UCITS ETF USD (Acc)", ter: 0.0020, peso: 0.55 },
    { isin: "IE00BD1F4M44", ticker: "IUVL", tickerSIC: "IUVLN", sicVerificado: true, nombre: "iShares Edge MSCI USA Value Factor UCITS ETF USD (Acc)", ter: 0.0020, peso: 0.20 },
    { isin: "IE00BKM4GZ66", ticker: "EIMI", tickerSIC: "EIMIN", sicVerificado: true, nombre: "iShares Core MSCI EM IMI UCITS ETF USD (Acc)", ter: 0.0018, peso: 0.25 },
  ],
  "Satelite Tecnologia": [
    {
      isin: "IE0032077012", ticker: "CNDX", tickerSIC: null, sicVerificado: false,
      nombre: "iShares NASDAQ 100 UCITS ETF USD (Acc)", ter: 0.0030, peso: 1.0,
      // CNDX es el titular por manual, pero NO está listado en MEXI. Sin este
      // sustituto, los 10 portafolios Moderado y Alto serían inconstruibles por
      // ruta SIC. El sustituto NO replica el mismo índice: se advierte al usarlo.
      sustitutoSIC: {
        isin: "IE00B3WJKG14", ticker: "IUIT", tickerSIC: "IUITN", sicVerificado: true,
        nombre: "iShares S&P 500 Information Technology Sector UCITS ETF USD (Acc)", ter: 0.0015,
        motivo: "CNDX (NASDAQ-100, ~100 emisores multisectoriales, TER 0.30%) no está listado en MEXI. Se sustituye por IUIT (S&P 500 Information Technology, solo sector tecnología, TER 0.15%). NO es el mismo índice: cambia la exposición sectorial del satélite.",
      },
    },
  ],
};

/** Alternativa de núcleo estadounidense puro, si se prefiere sobre IWDA. No se asigna sola. */
export const ALTERNATIVA_CSPX: Omit<Instrumento, "peso"> = {
  isin: "IE00B5BMR087", ticker: "CSPX", tickerSIC: "CSPXN", sicVerificado: true, /* MEXI confirmado 2026-08-15 */
  nombre: "iShares Core S&P 500 UCITS ETF USD (Acc)", ter: 0.0007,
};

/**
 * ESTADO DEL COTEJO EN MEXI VÍA TWS (2026-08-15, Claudio) · SOLO UNIVERSO UCITS
 * Confirmados con clave +N: IB01, IBTA, IDTP, DTLA, SDIA, LQDA, IHYA, EIMI, IUVL.
 * IWDA: confirmado IWDAN (el "IWSAN" del primer reporte fue dedazo).
 * CSPX: confirmado CSPXN.  IUIT: confirmado IUITN.
 * CNDX: NO listado en MEXI → sustituido por IUIT por ruta SIC (ver sustitutoSIC).
 */

export const UNIVERSO_UCITS: DefinicionUniverso = {
  clave: "UCITS",
  plazaOrigen: "LSE",
  etiquetas: {
    "Acciones Globales": "Acciones Globales",
    "Satelite Tecnologia": "Satélite Tecnología",
  },
  instrumentos: INSTRUMENTOS_UCITS,
  advertenciasFiscales: (ruta) => {
    const a: string[] = [];
    if (ruta === "SIC") {
      a.push("Ruta SIC: la operación se liquida en pesos aunque la exposición económica sea en dólares. Verificar reconocimiento de ganancia cambiaria con el fiscalista.");
      a.push("Ruta SIC: la tasa del 10% del art. 129 LISR está pendiente de confirmación, en particular para ETFs de deuda (el artículo habla de acciones y títulos que las representen).");
    } else {
      a.push("Ruta LSE: la ganancia de capital es acumulable a tasa marginal (hasta 35%), no aplica la retención definitiva del 10%.");
    }
    a.push("Domicilio irlandés: NO hay exposición al impuesto sucesorio de EE.UU. para no residentes, por ninguna de las dos rutas. Esta es la razón de ser de este universo.");
    a.push("Régimen REFIPRE (Título VI LISR) pendiente de opinión: si aplica, la clase de acumulación obliga a reconocimiento anual de ingreso y declaración informativa.");
    return a;
  },
};

// ============================================================================
// UNIVERSO B · ETFs domiciliados en Estados Unidos
// ============================================================================
//
// VERIFICACIÓN DE CLAVES · leer antes de operar este universo
// ---------------------------------------------------------------------------
// Este universo NO pasa por la validación de ticker que sí aplica al universo
// UCITS. La razón es que se opera DIRECTO en mercado estadounidense (NYSE Arca /
// Nasdaq), donde el ticker ES la clave canónica del instrumento: no hay
// traducción de pizarra que pueda mandar la orden a otro valor, que es el riesgo
// concreto que la bandera sicVerificado existe para atajar en el SIC.
//
// En consecuencia, la responsabilidad de verificar las claves recae en LA
// REVISIÓN DEL ASESOR AL GENERAR LA ORDEN. El motor no la sustituye ni la
// simula: emite la advertencia correspondiente en cada construcción y asienta
// el ticker por posición para que el cotejo sea posible contra la boleta.
//
// tickerSIC queda en null y sicVerificado en false para todo el universo: por
// ruta "SIC" estos instrumentos no son ejecutables hasta que la casa de bolsa
// confirme las claves contra el ISIN. Ese candado sigue activo y es intencional.
//
// ISIN y TER quedan en null: no se han cotejado contra factsheet ni contra el
// sistema de la casa de bolsa. No se inventan — un dato de costo sin verificar
// no entra a un documento que ve el cliente.
// ---------------------------------------------------------------------------

const INSTRUMENTOS_EEUU: Partial<Record<ClaseActivo, readonly Instrumento[]>> = {
  "Efectivo": [
    { isin: null, ticker: "SGOV", tickerSIC: null, sicVerificado: false, nombre: "iShares 0-3 Month Treasury Bond ETF", ter: null, peso: 1.0 },
  ],
  "Deuda Gubernamental": [
    { isin: null, ticker: "SGOV", tickerSIC: null, sicVerificado: false, nombre: "iShares 0-3 Month Treasury Bond ETF", ter: null, peso: 0.22 },
    { isin: null, ticker: "VGSH", tickerSIC: null, sicVerificado: false, nombre: "Vanguard Short-Term Treasury ETF", ter: null, peso: 0.26 },
    { isin: null, ticker: "VTIP", tickerSIC: null, sicVerificado: false, nombre: "Vanguard Short-Term Inflation-Protected Securities ETF", ter: null, peso: 0.28 },
    { isin: null, ticker: "VGIT", tickerSIC: null, sicVerificado: false, nombre: "Vanguard Intermediate-Term Treasury ETF", ter: null, peso: 0.24 },
  ],
  "Deuda Corporativa IG": [
    { isin: null, ticker: "VCSH", tickerSIC: null, sicVerificado: false, nombre: "Vanguard Short-Term Corporate Bond ETF", ter: null, peso: 0.55 },
    { isin: null, ticker: "VCIT", tickerSIC: null, sicVerificado: false, nombre: "Vanguard Intermediate-Term Corporate Bond ETF", ter: null, peso: 0.45 },
  ],
  "High Yield": [
    { isin: null, ticker: "HYG", tickerSIC: null, sicVerificado: false, nombre: "iShares iBoxx $ High Yield Corporate Bond ETF", ter: null, peso: 1.0 },
  ],
  // Manual, hoja "Universo": "Acciones Internacionales". Los cuatro pesos suman 1.00.
  // NO se igualan con los de UCITS: difieren por diseño, no por error.
  "Acciones Globales": [
    { isin: null, ticker: "VOO", tickerSIC: null, sicVerificado: false, nombre: "Vanguard S&P 500 ETF", ter: null, peso: 0.40 },
    { isin: null, ticker: "VTV", tickerSIC: null, sicVerificado: false, nombre: "Vanguard Value ETF", ter: null, peso: 0.22 },
    { isin: null, ticker: "VEA", tickerSIC: null, sicVerificado: false, nombre: "Vanguard FTSE Developed Markets ETF", ter: null, peso: 0.24 },
    { isin: null, ticker: "VWO", tickerSIC: null, sicVerificado: false, nombre: "Vanguard FTSE Emerging Markets ETF", ter: null, peso: 0.14 },
  ],
  "Satelite Tecnologia": [
    { isin: null, ticker: "QQQM", tickerSIC: null, sicVerificado: false, nombre: "Invesco NASDAQ 100 ETF", ter: null, peso: 1.0 },
  ],
};

/**
 * Alternativa de satélite EE.UU. Mismo índice (NASDAQ-100) y misma emisora que
 * QQQM, 5 pb más caro. Se prefiere QQQM por estructura de fondo abierto; QQQ es
 * un unit investment trust, que no puede prestar valores ni reinvertir dividendos
 * antes de la fecha de reparto. QQQ tiene más probabilidad de listarse en el SIC.
 */
export const ALTERNATIVA_QQQ: Omit<Instrumento, "peso"> = {
  isin: null, ticker: "QQQ", tickerSIC: null, sicVerificado: false,
  nombre: "Invesco QQQ Trust Series 1", ter: null,
};

/**
 * NO forma parte del universo automático. México ya está contenido en VWO vía el
 * índice FTSE Emerging Markets; agregar EWW aparte es SOBREPONDERACIÓN
 * DELIBERADA, no equivalencia. Es decisión del asesor y debe quedar trazada como
 * ajuste manual, con nombre y motivo.
 */
export const AJUSTE_MANUAL_EWW: Omit<Instrumento, "peso"> = {
  isin: null, ticker: "EWW", tickerSIC: null, sicVerificado: false,
  nombre: "iShares MSCI Mexico ETF", ter: null,
};

export const UNIVERSO_EEUU: DefinicionUniverso = {
  clave: "EEUU",
  plazaOrigen: "US",
  etiquetas: {
    // El manual usa "Acciones Internacionales": desde México, todo lo demás lo es.
    "Acciones Globales": "Acciones Internacionales",
    "Satelite Tecnologia": "Satélite Tecnología",
  },
  instrumentos: INSTRUMENTOS_EEUU,
  advertenciasFiscales: (ruta) => {
    const a: string[] = [];
    a.push(
      "IMPUESTO SUCESORIO DE EE.UU.: los ETFs de este universo están domiciliados en Estados Unidos y constituyen situs estadounidense. Para no residentes la exención es de 60,000 USD y la tasa marginal llega al 40%. Es la diferencia central frente al universo UCITS y debe quedar explícita en el IPS del cliente.",
    );
    a.push(
      "Dividendos: son fondos de DISTRIBUCIÓN. Hay retención en fuente de EE.UU. sobre cada reparto, reducible al 10% por el tratado México-EE.UU. mediante forma W-8BEN vigente. Sin W-8BEN vigente la retención es del 30%.",
    );
    a.push(
      "Al ser de distribución y no de acumulación, el análisis REFIPRE difiere del universo UCITS: no hay diferimiento por acumulación, pero sí ingreso por dividendo acumulable año con año.",
    );
    if (ruta === "SIC") {
      a.push("Ruta SIC: la operación se liquida en pesos aunque la exposición económica sea en dólares. Verificar reconocimiento de ganancia cambiaria con el fiscalista.");
      a.push("Ruta SIC: la tasa del 10% del art. 129 LISR está pendiente de confirmación, en particular para ETFs de deuda (el artículo habla de acciones y títulos que las representen).");
    } else {
      a.push("Ruta US: la ganancia de capital es acumulable a tasa marginal (hasta 35%); no aplica la retención definitiva del 10% del art. 129 LISR, que exige enajenación en bolsa concesionada en México.");
    }
    a.push(
      "VERIFICACIÓN DE CLAVES: este universo no pasa por validación de ticker en el motor, porque se opera directo en mercado estadounidense, donde el ticker es la clave canónica. La responsabilidad de cotejar cada clave recae en la REVISIÓN DEL ASESOR AL GENERAR LA ORDEN, contra la boleta y antes de mandar a la mesa.",
    );
    return a;
  },
};

export const UNIVERSOS: Readonly<Record<Universo, DefinicionUniverso>> = {
  UCITS: UNIVERSO_UCITS,
  EEUU: UNIVERSO_EEUU,
};

/** @deprecated Usar UNIVERSOS.UCITS.instrumentos. Se conserva por compatibilidad. */
export const UNIVERSO = INSTRUMENTOS_UCITS;

// ============================================================================
// LÍMITES · 7.5.1 por fase · 7.5.2 por perfil (ampliado con satélite)
// Compartidos por ambos universos. NO dependen del instrumento.
// ============================================================================

export const LIMITES_FASE: Readonly<Record<Fase, { rvMax: number; rfMin: number; liquidezMin: number }>> = {
  Desarrollo:    { rvMax: 0.70, rfMin: 0.20, liquidezMin: 0.05 },
  Aceleracion:   { rvMax: 0.85, rfMin: 0.10, liquidezMin: 0.05 },
  Acumulacion:   { rvMax: 0.75, rfMin: 0.20, liquidezMin: 0.05 },
  Consolidacion: { rvMax: 0.60, rfMin: 0.30, liquidezMin: 0.10 },
  Retiro:        { rvMax: 0.40, rfMin: 0.50, liquidezMin: 0.10 },
};

export const LIQUIDEZ_PERFIL: Readonly<Record<PerfilRiesgo, number>> = {
  "Libre de Riesgo": 0.05, "Bajo": 0.05, "Moderado": 0.05, "Alto": 0.03,
};

export const TOPES: Readonly<Record<PerfilRiesgo, Readonly<Record<string, number>>>> = {
  "Libre de Riesgo": { gob: 1.00, corp: 0.00, hy: 0.00, rv: 0.00, tech: 0.00 },
  "Bajo":     { gob: 1.00, corp: 0.60, hy: 0.00, rv: 0.30, tech: 0.00 },
  "Moderado": { gob: 0.70, corp: 0.50, hy: 0.10, rv: 0.60, tech: 0.08 },
  "Alto":     { gob: 0.40, corp: 0.30, hy: 0.20, rv: 0.85, tech: 0.15 },
};

// ============================================================================
// LOS 20 PORTAFOLIOS · pesos base, suman 100% SIN efectivo.
// La liquidez se aplica después por reescalado.
//
// El satélite de tecnología es SUBCLASE de renta variable, no clase aparte:
// entra a rv para rvMax por fase y para el tope rv por perfil, y además tiene
// su propio tope. Por eso vive en un campo separado sin salirse del 100.
// ============================================================================

type Base = { gob: number; corp: number; hy: number; global: number; tech: number };

const P = (gob: number, corp: number, hy: number, global: number, tech: number): Base =>
  ({ gob, corp, hy, global, tech });

export const PORTAFOLIOS: Readonly<Record<string, Base>> = {
  "Desarrollo|Libre de Riesgo":    P(100.0,  0.0, 0, 0.0,  0),
  "Desarrollo|Bajo":        P( 52.5, 22.5, 0, 25.0, 0),
  "Desarrollo|Moderado":    P( 32.9, 14.1, 8, 38.0, 7),
  "Desarrollo|Alto":        P( 13.3,  5.7, 8, 61.0, 12),
  "Aceleracion|Libre de Riesgo":   P(100.0,  0.0, 0, 0.0,  0),
  "Aceleracion|Bajo":       P( 50.4, 21.6, 0, 28.0, 0),
  "Aceleracion|Moderado":   P( 29.4, 12.6, 8, 43.0, 7),
  "Aceleracion|Alto":       P(  9.8,  4.2, 0, 74.0, 12),
  "Acumulacion|Libre de Riesgo":   P(100.0,  0.0, 0, 0.0,  0),
  "Acumulacion|Bajo":       P( 52.5, 22.5, 0, 25.0, 0),
  "Acumulacion|Moderado":   P( 32.9, 14.1, 8, 38.0, 7),
  "Acumulacion|Alto":       P( 11.2,  4.8, 8, 64.0, 12),
  "Consolidacion|Libre de Riesgo": P(100.0,  0.0, 0, 0.0,  0),
  "Consolidacion|Bajo":     P( 56.0, 24.0, 0, 20.0, 0),
  "Consolidacion|Moderado": P( 37.8, 16.2, 8, 31.0, 7),
  "Consolidacion|Alto":     P( 19.6,  8.4, 8, 52.0, 12),
  "Retiro|Libre de Riesgo":        P(100.0,  0.0, 0, 0.0,  0),
  "Retiro|Bajo":            P( 59.5, 25.5, 0, 15.0, 0),
  "Retiro|Moderado":        P( 44.8, 19.2, 8, 21.0, 7),
  "Retiro|Alto":            P( 35.0, 15.0, 8, 30.0, 12),
};

export const POSICION_MINIMA = 0.015;
/** Bajo este monto el portafolio completo no es operable (posiciones < mínimo). */
export const TICKET_MINIMO_USD = 30000;

// ============================================================================
// Motor
// ============================================================================

export function construirPortafolio(args: {
  universo: Universo;
  fase: Fase;
  perfil: PerfilRiesgo;
  ruta: Ruta;
  montoUSD?: number;
  /**
   * Solo aplica con ruta "SIC": los instrumentos sin clave verificada y sin
   * sustituto se enrutan por la plaza de origen en lugar de abortar. Ese sleeve
   * tributa a tasa marginal, no al 10% — el motor lo deja asentado por posición.
   */
  permitirRutaMixta?: boolean;
}): ResultadoPortafolio {
  const { universo, fase, perfil, ruta, montoUSD, permitirRutaMixta } = args;
  const def = UNIVERSOS[universo];
  if (!def) throw new Error(`Universo desconocido: "${universo}".`);

  const bitacora: string[] = [];
  const advertencias: string[] = [];

  const clave = `${fase}|${perfil}`;
  const base = PORTAFOLIOS[clave];
  if (!base) throw new Error(`No existe portafolio para "${clave}".`);

  bitacora.push(`Universo ${universo}; plaza de origen ${def.plazaOrigen}; ruta solicitada "${ruta}".`);

  // ── Liquidez y reescalado ──
  const liquidez = Math.max(LIMITES_FASE[fase].liquidezMin, LIQUIDEZ_PERFIL[perfil]);
  const k = 1 - liquidez;
  bitacora.push(
    `Liquidez = MAX(fase ${LIMITES_FASE[fase].liquidezMin}, perfil ${LIQUIDEZ_PERFIL[perfil]}) = ${liquidez}. Resto reescalado ×${k.toFixed(2)}.`,
  );

  const asignacionClases: Record<ClaseActivo, number> = {
    "Efectivo": liquidez,
    "Deuda Gubernamental": (base.gob / 100) * k,
    "Deuda Corporativa IG": (base.corp / 100) * k,
    "High Yield": (base.hy / 100) * k,
    "Acciones Globales": (base.global / 100) * k,
    "Satelite Tecnologia": (base.tech / 100) * k,
  };

  const eps = 1e-9;

  // ── Guard: ninguna clase con peso puede quedarse sin instrumentos ──
  // Sin esto, una clase ausente del universo evapora su peso EN SILENCIO y el
  // portafolio suma menos de 100% sin que nada falle.
  const huerfanas = (Object.keys(asignacionClases) as ClaseActivo[]).filter(
    (c) => asignacionClases[c] > eps && (def.instrumentos[c] ?? []).length === 0,
  );
  if (huerfanas.length > 0) {
    throw new Error(
      `Universo ${universo} no tiene instrumentos para ${huerfanas.length} clase(s) con peso asignado: ` +
        `${huerfanas.join(", ")}. El portafolio "${clave}" no se puede construir sin evaporar ese peso. ` +
        `Captura los instrumentos faltantes en el universo antes de operar.`,
    );
  }

  const rv = asignacionClases["Acciones Globales"] + asignacionClases["Satelite Tecnologia"];
  const rf =
    asignacionClases["Deuda Gubernamental"] +
    asignacionClases["Deuda Corporativa IG"] +
    asignacionClases["High Yield"];

  // ── Validación de límites (señala, no ajusta) ──
  const t = TOPES[perfil];
  const validaciones: Validacion[] = [
    { regla: `RV máx. por fase (${fase})`, valor: rv, limite: LIMITES_FASE[fase].rvMax, cumple: rv <= LIMITES_FASE[fase].rvMax + eps },
    { regla: `RF mín. por fase (${fase})`, valor: rf, limite: LIMITES_FASE[fase].rfMin, cumple: rf >= LIMITES_FASE[fase].rfMin - eps },
    { regla: `Liquidez mín. por fase`, valor: liquidez, limite: LIMITES_FASE[fase].liquidezMin, cumple: liquidez >= LIMITES_FASE[fase].liquidezMin - eps },
    { regla: `Liquidez mín. por perfil`, valor: liquidez, limite: LIQUIDEZ_PERFIL[perfil], cumple: liquidez >= LIQUIDEZ_PERFIL[perfil] - eps },
    { regla: "Tope Deuda Gubernamental (7.5.2)", valor: asignacionClases["Deuda Gubernamental"], limite: t["gob"]!, cumple: asignacionClases["Deuda Gubernamental"] <= t["gob"]! + eps },
    { regla: "Tope Deuda Corporativa IG (7.5.2)", valor: asignacionClases["Deuda Corporativa IG"], limite: t["corp"]!, cumple: asignacionClases["Deuda Corporativa IG"] <= t["corp"]! + eps },
    { regla: "Tope High Yield (7.5.2)", valor: asignacionClases["High Yield"], limite: t["hy"]!, cumple: asignacionClases["High Yield"] <= t["hy"]! + eps },
    { regla: "Tope Renta Variable (7.5.2)", valor: rv, limite: t["rv"]!, cumple: rv <= t["rv"]! + eps },
    { regla: "Tope Satélite Tecnología (subclase de RV)", valor: asignacionClases["Satelite Tecnologia"], limite: t["tech"]!, cumple: asignacionClases["Satelite Tecnologia"] <= t["tech"]! + eps },
    { regla: "Derivados en cero", valor: 0, limite: 0, cumple: true },
    { regla: "Criptoactivos en cero", valor: 0, limite: 0, cumple: true },
  ];
  const limitesOk = validaciones.every((v) => v.cumple);
  if (!limitesOk) {
    advertencias.push(
      `LÍMITES INCUMPLIDOS: ${validaciones.filter((v) => !v.cumple).map((v) => v.regla).join("; ")}. Se señala al Asesor; no se ajusta en silencio.`,
    );
  }

  // ── Selección de clave de pizarra según ruta ──
  // Llave del mapa: ticker|clase. Un mismo valor puede servir a dos clases
  // (p.ej. SGOV es Efectivo Y parte de Deuda Gubernamental) y debe reportarse
  // por separado en el IPS. La consolidación a una línea ocurre al final, para
  // la orden.
  const faltantesSIC: string[] = [];
  const mixtos = new Set<string>();
  const sustituidos = new Set<string>();
  type Bruta = { isin: string | null; ticker: string; nombre: string; clase: ClaseActivo; peso: number; rutaEjecucion: PlazaEjecucion };
  const brutas = new Map<string, Bruta>();

  (Object.keys(asignacionClases) as ClaseActivo[]).forEach((clase) => {
    const pesoClase = asignacionClases[clase];
    if (pesoClase <= eps) return;

    for (const inst of def.instrumentos[clase] ?? []) {
      let plaza: PlazaEjecucion = def.plazaOrigen;
      let ticker = inst.ticker;
      let isin = inst.isin;
      let nombre = inst.nombre;

      if (ruta === "SIC") {
        // sicVerificado gobierna ÚNICAMENTE esta rama. Por ruta "Origen" no se
        // consulta: allí el ticker de la plaza de origen es la clave canónica.
        if (inst.tickerSIC !== null && inst.sicVerificado) {
          plaza = "SIC";
          ticker = inst.tickerSIC;
        } else if (inst.sustitutoSIC && inst.sustitutoSIC.tickerSIC !== null && inst.sustitutoSIC.sicVerificado) {
          const s = inst.sustitutoSIC;
          plaza = "SIC";
          ticker = s.tickerSIC!;
          isin = s.isin;
          nombre = s.nombre;
          if (!sustituidos.has(inst.ticker)) {
            sustituidos.add(inst.ticker);
            bitacora.push(`${inst.ticker} → ${s.ticker} (${s.tickerSIC}) por ruta SIC en ${clase}.`);
            advertencias.push(`SUSTITUCIÓN POR RUTA · ${s.motivo}`);
          }
        } else if (permitirRutaMixta) {
          plaza = def.plazaOrigen;
          mixtos.add(inst.ticker);
        } else {
          faltantesSIC.push(
            `${inst.ticker} (${inst.isin ?? "ISIN por confirmar"})${inst.tickerSIC ? " · clave sin verificar" : " · sin listado SIC"}`,
          );
          continue;
        }
      }

      const llave = `${ticker}|${clase}`;
      const w = pesoClase * inst.peso;
      const prev = brutas.get(llave);
      if (prev) prev.peso += w;
      else brutas.set(llave, { isin, ticker, nombre, clase, peso: w, rutaEjecucion: plaza });
    }
  });

  if (ruta === "SIC" && faltantesSIC.length > 0) {
    throw new Error(
      `No se puede construir por ruta SIC en universo ${universo}: faltan claves de pizarra sin verificar para ` +
        `${faltantesSIC.length} instrumento(s): ${faltantesSIC.join(", ")}. Confírmalas con la casa de bolsa ` +
        `CONTRA EL ISIN (la clave del SIC puede diferir de la de la plaza de origen) y captúralas en ` +
        `UNIVERSOS.${universo}.instrumentos[...].tickerSIC antes de operar.`,
    );
  }

  // ── Posición mínima 1.5%: se reasigna al mayor de su clase ──
  const porClase = new Map<ClaseActivo, string[]>();
  for (const [llave, p] of brutas) {
    const arr = porClase.get(p.clase) ?? [];
    arr.push(llave);
    porClase.set(p.clase, arr);
  }
  for (const [clase, llaves] of porClase) {
    const menores = llaves.filter((l) => brutas.get(l)!.peso > 0 && brutas.get(l)!.peso < POSICION_MINIMA);
    if (menores.length === 0) continue;
    const mayores = llaves.filter((l) => !menores.includes(l));
    if (mayores.length === 0) {
      advertencias.push(
        `${clase}: TODAS sus posiciones quedan bajo el piso de ${(POSICION_MINIMA * 100).toFixed(1)}% y no hay a dónde reasignarlas. La clase se mantiene tal cual; revisar operabilidad con el Asesor.`,
      );
      continue;
    }
    const destino = mayores.reduce((a, b) => (brutas.get(a)!.peso >= brutas.get(b)!.peso ? a : b));
    for (const l of menores) {
      const w = brutas.get(l)!.peso;
      const tkOrigen = brutas.get(l)!.ticker;
      brutas.get(destino)!.peso += w;
      brutas.get(l)!.peso = 0;
      bitacora.push(`${tkOrigen} (${(w * 100).toFixed(2)}%) < 1.5%: reasignado a ${brutas.get(destino)!.ticker} dentro de ${clase}.`);
      advertencias.push(
        `${tkOrigen} quedaba en ${(w * 100).toFixed(2)}% dentro de ${clase}, bajo el piso operable: SE ELIMINÓ del portafolio y su peso pasó a ${brutas.get(destino)!.ticker}. La exposición que ese instrumento aportaba ya no está.`,
      );
    }
  }

  const posiciones: Posicion[] = [...brutas.values()]
    .filter((p) => p.peso > eps)
    .map((p) => ({ isin: p.isin, ticker: p.ticker, nombre: p.nombre, clase: p.clase, peso: p.peso, rutaEjecucion: p.rutaEjecucion }))
    .sort((a, b) => b.peso - a.peso);

  // ── Cierre: el reparto tiene que sumar 100% ──
  const suma = posiciones.reduce((s, p) => s + p.peso, 0);
  if (Math.abs(suma - 1) > 1e-4) {
    throw new Error(
      `Peso muerto en "${clave}" (universo ${universo}): las posiciones suman ${(suma * 100).toFixed(4)}%, no 100%. ` +
        `Indica pesos de clase que no cierran en 1.00 en el universo, o pérdida de peso en el piso de posición mínima.`,
    );
  }
  bitacora.push(`${posiciones.length} posiciones (por instrumento y clase); suma = ${(suma * 100).toFixed(2)}%.`);

  // ── Consolidación por ticker: lo que se manda a la mesa ──
  const porTicker = new Map<string, LineaOrden>();
  for (const p of posiciones) {
    const prev = porTicker.get(p.ticker);
    if (prev) {
      prev.peso += p.peso;
      if (!prev.clases.includes(p.clase)) prev.clases.push(p.clase);
    } else {
      porTicker.set(p.ticker, { isin: p.isin, ticker: p.ticker, nombre: p.nombre, peso: p.peso, plaza: p.rutaEjecucion, clases: [p.clase] });
    }
  }
  const ordenConsolidada = [...porTicker.values()].sort((a, b) => b.peso - a.peso);

  for (const l of ordenConsolidada) {
    if (l.clases.length > 1) {
      bitacora.push(
        `${l.ticker} sirve a ${l.clases.length} clases (${l.clases.join(" + ")}): ${(l.peso * 100).toFixed(2)}% en una sola línea de orden.`,
      );
      advertencias.push(
        `${l.ticker} cubre ${l.clases.join(" y ")} con el mismo valor (${(l.peso * 100).toFixed(2)}% del portafolio). Esas clases NO se pueden rebalancear por separado: una desviación en una es indistinguible de la otra.`,
      );
    }
  }

  if (posiciones.length !== ordenConsolidada.length) {
    bitacora.push(`Orden consolidada: ${ordenConsolidada.length} líneas a partir de ${posiciones.length} posiciones.`);
  }

  // ── Advertencias operativas ──
  if (montoUSD !== undefined && montoUSD < TICKET_MINIMO_USD) {
    advertencias.push(
      `Monto ${montoUSD.toLocaleString("es-MX")} USD por debajo del ticket mínimo de ${TICKET_MINIMO_USD.toLocaleString("es-MX")}: con ${ordenConsolidada.length} líneas y piso de 1.5%, la cartera no es operable de forma eficiente.`,
    );
  }
  if (ruta === "SIC" && mixtos.size > 0) {
    advertencias.unshift(
      `RUTA MIXTA · ${[...mixtos].join(", ")} sin listado/clave verificada en el SIC: ese sleeve se ejecuta por ` +
        `${def.plazaOrigen} y su ganancia tributa a tasa marginal (hasta 35%), no al 10% del art. 129. ` +
        "Queda asentado por posición en rutaEjecucion.",
    );
  }

  advertencias.push(...def.advertenciasFiscales(ruta));

  return {
    clave, universo, plazaOrigen: def.plazaOrigen, fase, perfil, ruta, liquidez,
    asignacionClases, etiquetasClases: def.etiquetas,
    rentaVariable: rv, rentaFija: rf,
    posiciones, ordenConsolidada,
    validaciones, limitesOk,
    advertencias, bitacora,
  };
}

/**
 * Captura verificada de claves del SIC para un universo. Llamar al arrancar la app.
 * Cargar SOLO tras cotejo contra el ISIN en el sistema de la casa de bolsa.
 */
export function registrarTickersSIC(universo: Universo, mapa: Record<string, string>): void {
  const def = UNIVERSOS[universo];
  if (!def) throw new Error(`Universo desconocido: "${universo}".`);
  for (const insts of Object.values(def.instrumentos)) {
    for (const inst of insts ?? []) {
      const clv = inst.isin && mapa[inst.isin] ? mapa[inst.isin] : mapa[inst.ticker];
      if (clv) {
        const w = inst as { tickerSIC: string | null; sicVerificado: boolean };
        w.tickerSIC = clv;
        w.sicVerificado = true;
      }
    }
  }
}

/**
 * Diagnóstico: qué falta para poder operar el universo por SIC.
 * Devuelve vacío para un universo ya cotejado. Por ruta "Origen" este
 * diagnóstico es irrelevante: sicVerificado no gobierna esa ruta.
 */
export function pendientesSIC(
  universo: Universo,
): Array<{ ticker: string; isin: string | null; tickerSIC: string | null; motivo: string }> {
  const def = UNIVERSOS[universo];
  if (!def) throw new Error(`Universo desconocido: "${universo}".`);
  const out: Array<{ ticker: string; isin: string | null; tickerSIC: string | null; motivo: string }> = [];
  const vistos = new Set<string>();
  for (const insts of Object.values(def.instrumentos)) {
    for (const inst of insts ?? []) {
      if (vistos.has(inst.ticker)) continue;
      vistos.add(inst.ticker);
      if (!inst.tickerSIC) {
        out.push({ ticker: inst.ticker, isin: inst.isin, tickerSIC: null, motivo: inst.sustitutoSIC ? "sin clave · tiene sustituto para ruta SIC" : "sin clave" });
      } else if (!inst.sicVerificado) {
        out.push({ ticker: inst.ticker, isin: inst.isin, tickerSIC: inst.tickerSIC, motivo: "clave sin cotejar contra ISIN" });
      }
    }
  }
  return out;
}
