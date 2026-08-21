/**
 * Catálogo de la metodología IPS de Bioongo.
 *
 * Data pura: tablas de puntaje, pesos y bandas. Sin lógica de cálculo.
 * El motor que consume estas tablas vive fuera de este archivo.
 *
 * IMPORTANTE: todas las claves de las tablas están normalizadas con
 * `normalizar()` — minúsculas y sin acentos. El consumidor DEBE normalizar
 * la respuesta del cliente antes de buscarla:
 *
 *     CAPACIDAD_COLCHON[normalizar(respuesta)]
 *
 * Un lookup con el texto crudo no encuentra nada.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Fase =
  | 'Desarrollo'
  | 'Aceleracion'
  | 'Acumulacion'
  | 'Consolidacion'
  | 'Retiro';

export type PerfilRiesgo = 'Alto' | 'Moderado' | 'Bajo' | 'Libre de Riesgo';

// ---------------------------------------------------------------------------
// Tolerancia al riesgo (disposición) — puntaje máximo 24
// ---------------------------------------------------------------------------

/** Escenario ganancia/pérdida preferido. Máx 3. */
export const TOLERANCIA_ESCENARIO: Record<string, number> = {
  'posibilidad de ganar +15% y perder -8%': 1,
  'posibilidad de ganar +7% y perder -3%': 2,
  'posibilidad de ganar +4% y perder -0%': 3,
};

/** Reacción ante una caída de 10% en un mes. Máx 4. */
export const TOLERANCIA_REACCION_CAIDA: Record<string, number> = {
  'compro mas': 1,
  'mantengo mi posicion': 2,
  'vendo lo que mas perdio': 3,
  'vendo todo': 4,
};

/** Tiene o ha intentado tener negocio propio. Máx 2. */
export const TOLERANCIA_NEGOCIO_PROPIO: Record<string, number> = {
  si: 1,
  no: 2,
};

/** Qué percibe más riesgoso: negocio propio o empleo. Máx 5. */
export const TOLERANCIA_PERCEPCION_EMPLEO: Record<string, number> = {
  'definitivamente trabajar para alguien mas': 1,
  'tal vez trabajar para alguien mas': 2,
  'no se': 3,
  'tal vez tener un negocio propio': 4,
  'definitivamente tener un negocio propio': 5,
};

/**
 * Escala Likert. Máx 5.
 * Se usa para dos reactivos: ingreso_seguro y no_puedo_perder.
 *
 * 'tal vez' es un alias de la posición neutral, equivalente a 'no se'.
 */
export const LIKERT: Record<string, number> = {
  'completamente en desacuerdo': 1,
  'en desacuerdo': 2,
  'no se': 3,
  'tal vez': 3,
  'de acuerdo': 4,
  'completamente de acuerdo': 5,
};

// ---------------------------------------------------------------------------
// Capacidad de riesgo (holgura financiera) — puntaje máximo 19
// ---------------------------------------------------------------------------

/** Fase del ciclo patrimonial. Máx 5. */
export const CAPACIDAD_FASE: Record<string, number> = {
  desarrollo: 1,
  aceleracion: 2,
  acumulacion: 3,
  consolidacion: 4,
  retiro: 5,
};

/**
 * Situación laboral. Máx 6.
 *
 * Las últimas tres entradas son alias de ocupaciones que aparecen en los
 * datos reales y no estaban en el catálogo original.
 */
export const CAPACIDAD_EMPLEO: Record<string, number> = {
  'soy profesionista': 2,
  'soy empresari@': 3,
  'soy estudiante': 4,
  'soy freelancer': 4,
  'trabajo del hogar': 5,
  jubilado: 5,
  desempleado: 6,
  otro: 4,
  'empleado de gobierno': 2,
  'soy profesionista independiente': 2,
  'asesor profesional de seguros': 4,
};

/**
 * Colchón de liquidez: cuánto aguanta sin su fuente de ingresos. Máx 5.
 *
 * Ojo con 'ano': `normalizar()` descompone la ñ y le quita la tilde, así que
 * 'año' normalizado es 'ano'. Las claves de abajo ya reflejan eso.
 */
export const CAPACIDAD_COLCHON: Record<string, number> = {
  'mas de 1 ano': 1,
  'entre 6 meses y 1 ano': 2,
  'entre 3 meses y 6 meses': 3,
  'entre 1 mes y 3 meses': 4,
  'menos de 1 mes': 5,
};

/**
 * Situación habitacional. Máx 3.
 *
 * La última entrada es un alias presente en los datos reales.
 */
export const CAPACIDAD_HABITACIONAL: Record<string, number> = {
  'casa propia': 1,
  rento: 2,
  'casa propia con hipoteca': 3,
  'casa propia con hipoteca rentada por tercero': 3,
};

// ---------------------------------------------------------------------------
// Debida diligencia
// ---------------------------------------------------------------------------

/**
 * Ocupaciones que obligan a revisar el estatus PEP del cliente antes de dar
 * por válida su declaración, conforme a las obligaciones de debida diligencia.
 *
 * El motor debe marcar una alerta en bitácora cuando la ocupación coincida,
 * sin bloquear el cálculo.
 *
 * Los valores ya están normalizados: comparar contra `normalizar(ocupacion)`.
 */
export const OCUPACIONES_REVISION_PEP: string[] = ['empleado de gobierno'];

// ---------------------------------------------------------------------------
// Ponderación
// ---------------------------------------------------------------------------

export const PESO_TOLERANCIA = 0.6;
export const PESO_CAPACIDAD = 0.4;

// ---------------------------------------------------------------------------
// Bandas
// ---------------------------------------------------------------------------

/** Banda: se toma el primer elemento cuyo `max` no sea superado por el puntaje. */
export type Banda<T> = { max: number; valor: T };

/**
 * RECALIBRACIÓN 20/08/2026
 *
 * Las bandas de capacidad y de perfil se recalibraron al pasar el puntaje de
 * capacidad de 4 a 6 componentes. Con 4 componentes (fase, empleo, colchón,
 * habitacional) el rango era 5–19; al sumar dependientes y cobertura de deuda
 * pasó a 7–27, y los cortes viejos dejaban los niveles altos casi vacíos.
 *
 * Valores anteriores, correspondientes al modelo de 4 componentes:
 *   BANDAS_CAPACIDAD: <=8 -> 1, <=13 -> 2, <=18 -> 3, <=23 -> 4, resto -> 5
 *   BANDAS_PERFIL:    <=1.75 Alto, <=2.5 Moderado, <=3.4 Bajo, resto Libre
 *
 * BANDAS_TOLERANCIA no cambió: sus 6 reactivos y su rango 6–24 son los mismos.
 */

/** Puntaje de tolerancia (6–24) → nivel 1–4. */
export const BANDAS_TOLERANCIA: Banda<number>[] = [
  { max: 10, valor: 1 },
  { max: 15, valor: 2 },
  { max: 20, valor: 3 },
  { max: Infinity, valor: 4 },
];

/** Puntaje de capacidad (7–27, seis componentes) → nivel 1–5. */
export const BANDAS_CAPACIDAD: Banda<number>[] = [
  { max: 11, valor: 1 },
  { max: 15, valor: 2 },
  { max: 19, valor: 3 },
  { max: 23, valor: 4 },
  { max: Infinity, valor: 5 },
];

/** Puntuación ponderada (1.0–4.4) → perfil de riesgo. */
export const BANDAS_PERFIL: Banda<PerfilRiesgo>[] = [
  { max: 2.0, valor: 'Alto' },
  { max: 2.8, valor: 'Moderado' },
  { max: 3.5, valor: 'Bajo' },
  { max: Infinity, valor: 'Libre de Riesgo' },
];

// ---------------------------------------------------------------------------
// Auxiliar
// ---------------------------------------------------------------------------

/**
 * Quita acentos y pasa a minúsculas, para comparar respuestas sin importar
 * mayúsculas ni tildes. No recorta espacios ni normaliza puntuación.
 *
 * Nota: al descomponer en NFD también se pierde la tilde de la ñ
 * ('año' → 'ano'). Es consistente mientras ambos lados de la comparación
 * pasen por esta función.
 */
/** Rango de marcas diacríticas combinantes que produce la descomposición NFD. */
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase();
}
