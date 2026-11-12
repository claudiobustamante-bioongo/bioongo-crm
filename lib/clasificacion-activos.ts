/**
 * [cartera] Clasificación interna de activos (M3) · cumplimiento del IPS.
 * ---------------------------------------------------------------------------
 * Dado un renglón de posiciones_detalle y el catálogo (catalogo_instrumentos +
 * catalogo_prorrateo), devuelve en qué clases cae su valor. NO es la
 * clasificación CNBV del R03 (esa es por vehículo) ni la del inversionista
 * (lib/clasificacion.ts, 201–204).
 *
 * Pura: sin Supabase ni red. Ningún mapeo de ticker vive aquí: todo sale del
 * catálogo; las reglas de abajo solo aplican a lo que NO está en él.
 *
 * Reglas (docs/ESPEC_IBKR_Flex.md §3.2 y decisiones del Asesor):
 * - MIRADA A TRAVÉS: manda el subyacente. La clase del catálogo ya es la del
 *   subyacente (un ETF de Treasuries es GOB_EXT), nunca la del vehículo.
 * - RENTA VARIABLE POR EMISOR, no por bolsa ni moneda (11-nov-2026):
 *   ACC_BMV = emisoras mexicanas en cualquier bolsa o moneda; ACC_SIC =
 *   emisoras no mexicanas en cualquier bolsa o moneda. RV total = ACC_BMV +
 *   ACC_SIC, para fase y perfil. Un ADR de emisora mexicana en NYSE es ACC_BMV.
 * - MIXTO se reparte por catalogo_prorrateo; cada fracción hereda la duración
 *   del ETF y la fracción EFECTIVO cuenta como liquidez.
 * - Equivalente de efectivo: cuenta para liquidez Y consume el límite de su
 *   clase. Un money market regulado (UCITS MMF o 2a-7, liquidez diaria, WAM ≤ 60
 *   días) está en el catálogo como EFECTIVO y equivalente (11-nov-2026).
 * - Fuera del catálogo:
 *     OPT o FUT                                → DERIVADO, no elegible.
 *     STK / ETF                                → ACC_SIC elegible, con aviso.
 *     STK / COMMON, ADR, NY REG SHRS o GDR     → ACC_SIC elegible, con aviso.
 *     cualquier otra cosa                      → NO_CATALOGADO, crítico.
 *   El ACC_SIC por defecto puede estar mal si la emisora es mexicana (sería
 *   ACC_BMV): el aviso lo dice, porque sin catálogo no hay cómo saber el emisor.
 *   Decisiones de Claudio del 12-nov-2026: ETF fuera de catálogo elegible con
 *   aviso; FUT como DERIVADO.
 *
 * La gravedad de un límite (P1–P5) la decide el semáforo, no este módulo; aquí
 * solo son críticos los huecos del catálogo.
 */

/** Espeja el CHECK catalogo_clase_valida (migraciones/2026-11-11-01-catalogo-y-checks.sql). */
export const CLASES_ACTIVO = [
  'GOB_MX',
  'GOB_EXT',
  'GOB_EMERGENTE',
  'CORP_IG',
  'HIGH_YIELD',
  'ACC_BMV',
  'ACC_SIC',
  'CRIPTO',
  'MIXTO',
  'DERIVADO',
  'EFECTIVO',
  'COMMODITY',
  'APALANCADO',
] as const;
export type ClaseActivo = (typeof CLASES_ACTIVO)[number];
/** Una fracción nunca es MIXTO: el MIXTO se descompone. */
export type ClaseFraccion = Exclude<ClaseActivo, 'MIXTO'> | 'NO_CATALOGADO';

/** Renta variable = ACC_BMV + ACC_SIC (por emisor). */
export const CLASES_RENTA_VARIABLE: readonly ClaseActivo[] = ['ACC_BMV', 'ACC_SIC'];

/** Subcategorías de IBKR que son acción individual (ESPEC_IBKR_Flex §3.2.4). */
export const SUBCATEGORIAS_ACCION: readonly string[] = ['COMMON', 'ADR', 'NY REG SHRS', 'GDR'];

export interface EntradaCatalogo {
  ticker: string;
  clase_activo: ClaseActivo;
  elegible: boolean;
  es_equivalente_efectivo: boolean;
  duracion_efectiva: number | null;
}

export interface FactorProrrateo {
  ticker: string;
  clase_activo: Exclude<ClaseActivo, 'MIXTO'>;
  factor: number;
}

export interface Catalogo {
  instrumentos: ReadonlyMap<string, EntradaCatalogo>;
  prorrateo: ReadonlyMap<string, readonly FactorProrrateo[]>;
}

export function armarCatalogo(
  instrumentos: readonly EntradaCatalogo[],
  prorrateo: readonly FactorProrrateo[],
): Catalogo {
  const porTicker = new Map<string, FactorProrrateo[]>();
  for (const f of prorrateo) porTicker.set(f.ticker, [...(porTicker.get(f.ticker) ?? []), f]);
  return { instrumentos: new Map(instrumentos.map((i) => [i.ticker, i])), prorrateo: porTicker };
}

/** Lo que este módulo necesita de un renglón de posiciones_detalle. */
export interface RenglonPosicion {
  tipo_renglon: 'posicion' | 'efectivo' | 'nav_ibkr';
  ticker: string;
  asset_category: string | null;
  sub_category: string | null;
  valor_base: number;
}

export interface Fraccion {
  clase: ClaseFraccion;
  factor: number;
  valor_base: number;
  elegible: boolean;
  /** Cuenta para el mínimo de liquidez: clase EFECTIVO o equivalente de efectivo. */
  liquidez: boolean;
  equivalente_efectivo: boolean;
  duracion_efectiva: number | null;
  origen: 'catalogo' | 'prorrateo' | 'regla';
}

export type CodigoAviso =
  | 'ETF_FUERA_DE_CATALOGO'
  | 'ACCION_FUERA_DE_CATALOGO'
  | 'NO_CATALOGADO'
  | 'MIXTO_SIN_PRORRATEO';

export interface AvisoClasificacion {
  nivel: 'aviso' | 'critico';
  codigo: CodigoAviso;
  ticker: string;
  mensaje: string;
}

export interface Clasificacion {
  fracciones: Fraccion[];
  avisos: AvisoClasificacion[];
}

const TOLERANCIA_SUMA = 1e-9;

function unica(
  r: RenglonPosicion,
  clase: ClaseFraccion,
  elegible: boolean,
  origen: Fraccion['origen'],
  equivalente = false,
  duracion: number | null = null,
): Fraccion {
  return {
    clase,
    factor: 1,
    valor_base: r.valor_base,
    elegible,
    liquidez: clase === 'EFECTIVO' || equivalente,
    equivalente_efectivo: equivalente,
    duracion_efectiva: duracion,
    origen,
  };
}

function noCatalogado(r: RenglonPosicion, codigo: CodigoAviso, mensaje: string): Clasificacion {
  return {
    fracciones: [unica(r, 'NO_CATALOGADO', false, 'regla')],
    avisos: [{ nivel: 'critico', codigo, ticker: r.ticker, mensaje }],
  };
}

export function clasificarRenglon(r: RenglonPosicion, catalogo: Catalogo): Clasificacion {
  if (r.tipo_renglon === 'nav_ibkr') {
    throw new Error('NAV_IBKR es un renglón de control: no se clasifica ni se suma.');
  }
  if (r.tipo_renglon === 'efectivo') {
    return { fracciones: [unica(r, 'EFECTIVO', true, 'regla')], avisos: [] };
  }

  const entrada = catalogo.instrumentos.get(r.ticker);
  if (entrada) {
    if (entrada.clase_activo !== 'MIXTO') {
      return {
        fracciones: [
          unica(r, entrada.clase_activo, entrada.elegible, 'catalogo', entrada.es_equivalente_efectivo,
                entrada.duracion_efectiva),
        ],
        avisos: [],
      };
    }
    const factores = catalogo.prorrateo.get(r.ticker) ?? [];
    const suma = factores.reduce((s, f) => s + f.factor, 0);
    if (factores.length === 0 || Math.abs(suma - 1) > TOLERANCIA_SUMA) {
      return noCatalogado(
        r,
        'MIXTO_SIN_PRORRATEO',
        `${r.ticker} es MIXTO pero su prorrateo ${factores.length ? `suma ${suma}` : 'no existe'}: ` +
          'no se puede repartir. Completar catalogo_prorrateo.',
      );
    }
    return {
      fracciones: factores.map((f) => ({
        clase: f.clase_activo,
        factor: f.factor,
        valor_base: r.valor_base * f.factor,
        elegible: entrada.elegible,
        liquidez: f.clase_activo === 'EFECTIVO',
        equivalente_efectivo: false,
        duracion_efectiva: entrada.duracion_efectiva,
        origen: 'prorrateo',
      })),
      avisos: [],
    };
  }

  const asset = r.asset_category ?? '';
  const sub = r.sub_category ?? '';
  if (asset === 'OPT' || asset === 'FUT') {
    return { fracciones: [unica(r, 'DERIVADO', false, 'regla')], avisos: [] };
  }
  if (asset === 'STK' && sub === 'ETF') {
    return {
      fracciones: [unica(r, 'ACC_SIC', true, 'regla')],
      avisos: [{
        nivel: 'aviso',
        codigo: 'ETF_FUERA_DE_CATALOGO',
        ticker: r.ticker,
        mensaje: `${r.ticker}: ETF fuera del catálogo, contado como ACC_SIC elegible. Verificar subyacente y ` +
          'emisor (si es mexicana, es ACC_BMV) y darlo de alta.',
      }],
    };
  }
  if (asset === 'STK' && SUBCATEGORIAS_ACCION.includes(sub)) {
    return {
      fracciones: [unica(r, 'ACC_SIC', true, 'regla')],
      avisos: [{
        nivel: 'aviso',
        codigo: 'ACCION_FUERA_DE_CATALOGO',
        ticker: r.ticker,
        mensaje: `${r.ticker}: acción (${sub}) fuera del catálogo, contada como ACC_SIC elegible. Verificar ` +
          'emisor (si es mexicana, es ACC_BMV) y darla de alta.',
      }],
    };
  }
  return noCatalogado(
    r,
    'NO_CATALOGADO',
    `${r.ticker} (${asset || 'sin categoría'}${sub ? ` / ${sub}` : ''}) no está en el catálogo y ninguna regla ` +
      'lo clasifica: sin clase. Darlo de alta antes de evaluarlo.',
  );
}
