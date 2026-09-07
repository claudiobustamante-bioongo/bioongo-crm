/**
 * CATÁLOGO EBR/PLD · CABZ
 * ---------------------------------------------------------------------------
 * Generado desde Metodologia_EBR_PLD_CABZ.xlsx, hoja "Factores".
 * Data pura: quince factores, cada opción con probabilidad, impacto y puntaje.
 * El puntaje es probabilidad × impacto. El total va de 43 a 130 puntos.
 *
 * IMPORTANTE — LAS DOS CAPAS DE LA METODOLOGÍA
 *
 * Capa 1 · Esta matriz. Es EVIDENCIA del análisis, NO determina el grado de
 *   riesgo. Bandas de referencia: 43-74 baja, 75-98 media, 99-130 alta.
 *
 * Capa 2 · La regla del Manual. El grado (alto o bajo, sin medio para personas
 *   físicas) se determina conforme al Manual de Cumplimiento.
 *
 * PENDIENTE DE COMPLIANCE — no implementado a propósito:
 *   La metodología cita un "apartado 4.6" con tres supuestos concurrentes. Ese
 *   apartado no existe con esa numeración en el Manual v3.0 (marzo 2026), cuya
 *   sección equivalente III.3 transcribe la 13ª de las Disposiciones y no
 *   contiene la regla de "dos de tres supuestos". La propia metodología marca
 *   el supuesto 3 como PRESUMIDO. Hasta que el Oficial de Cumplimiento aclare
 *   el criterio, este motor calcula la matriz pero NO determina el grado.
 *
 * Lo que sí está en el Manual v3.0 y es regla explícita:
 *   III.6 — Los PEP de nacionalidad extranjera deben ser considerados de alto
 *   riesgo.
 *
 * Todas las claves están normalizadas con normalizar(): minúsculas, sin
 * acentos. Normaliza la respuesta antes de buscarla.
 */

/** Una opción del catálogo: probabilidad, impacto y su producto. */
export interface OpcionFactor {
  readonly probabilidad: number;
  readonly impacto: number;
  readonly puntaje: number;
}

/** Rango de marcas diacríticas combinantes que produce la descomposición NFD. */
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Minúsculas y sin acentos. Nota: la ñ pierde la tilde ('año' → 'ano'), lo cual
 * es consistente mientras ambos lados de la comparación pasen por aquí.
 */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(DIACRITICOS, '').toLowerCase().trim();
}

/** TIPO DE PERSONA — 2 opciones. */
export const TIPO_PERSONA: Record<string, OpcionFactor> = {
  'persona fisica': { probabilidad: 2, impacto: 2, puntaje: 4 },
  'persona moral': { probabilidad: 2, impacto: 3, puntaje: 6 },
};

/** EDAD — 3 opciones. */
export const EDAD: Record<string, OpcionFactor> = {
  '18 a 35 anos': { probabilidad: 4, impacto: 2, puntaje: 8 },
  '36 a 50 anos': { probabilidad: 3, impacto: 2, puntaje: 6 },
  'mas de 50 anos': { probabilidad: 1, impacto: 2, puntaje: 2 },
};

/** GÉNERO — 2 opciones. */
export const GENERO: Record<string, OpcionFactor> = {
  'mujer': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'hombre': { probabilidad: 3, impacto: 3, puntaje: 9 },
};

/** ACTIVIDAD ECONÓMICA — 23 opciones. */
export const ACTIVIDAD_ECONOMICA: Record<string, OpcionFactor> = {
  'ama de casa': { probabilidad: 1, impacto: 2, puntaje: 2 },
  'estudiante': { probabilidad: 1, impacto: 2, puntaje: 2 },
  'empleado privado': { probabilidad: 1, impacto: 2, puntaje: 2 },
  'empleado publico': { probabilidad: 4, impacto: 3, puntaje: 12 },
  'comerciante o profesionista independiente': { probabilidad: 3, impacto: 4, puntaje: 12 },
  'desempleado': { probabilidad: 3, impacto: 4, puntaje: 12 },
  'jubilado': { probabilidad: 3, impacto: 3, puntaje: 9 },
  'pensionado': { probabilidad: 3, impacto: 4, puntaje: 12 },
  'compra venta de vehiculos': { probabilidad: 4, impacto: 3, puntaje: 12 },
  'mutuo, prestamo o credito': { probabilidad: 4, impacto: 2, puntaje: 8 },
  'transmision de derechos sobre inmuebles': { probabilidad: 1, impacto: 2, puntaje: 2 },
  'juegos y sorteos': { probabilidad: 1, impacto: 2, puntaje: 2 },
  'tarjetas de servicio y credito': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'metales, joyas y relojes': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'obras de arte': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'fe publica': { probabilidad: 1, impacto: 4, puntaje: 4 },
  'arrendamiento de inmuebles': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'tarjetas prepagadas': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'traslado y custodia de valores': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'recepcion de donativos': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'servicios profesionales': { probabilidad: 3, impacto: 4, puntaje: 12 },
  'tarjetas de devoluciones y recompensas': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'servicios de blindaje': { probabilidad: 1, impacto: 4, puntaje: 4 },
};

/** PERSONA POLÍTICAMENTE EXPUESTA — 2 opciones. */
export const PEP: Record<string, OpcionFactor> = {
  'si': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'no': { probabilidad: 1, impacto: 1, puntaje: 1 },
};

/** LISTA DE PERSONAS BLOQUEADAS / LISTAS DE LA ONU — 2 opciones. */
export const LISTAS_BLOQUEADAS: Record<string, OpcionFactor> = {
  'si': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'no': { probabilidad: 1, impacto: 1, puntaje: 1 },
};

/** NACIONALIDAD — 2 opciones. */
export const NACIONALIDAD: Record<string, OpcionFactor> = {
  'mexicana': { probabilidad: 3, impacto: 2, puntaje: 6 },
  'extranjera': { probabilidad: 2, impacto: 4, puntaje: 8 },
};

/** ENTIDAD FEDERATIVA DE RESIDENCIA — 33 opciones. */
export const ENTIDAD_FEDERATIVA: Record<string, OpcionFactor> = {
  'aguascalientes': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'baja california': { probabilidad: 4, impacto: 3, puntaje: 12 },
  'baja california sur': { probabilidad: 4, impacto: 3, puntaje: 12 },
  'campeche': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'chiapas': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'chihuahua': { probabilidad: 3, impacto: 3, puntaje: 9 },
  'ciudad de mexico': { probabilidad: 3, impacto: 3, puntaje: 9 },
  'coahuila': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'colima': { probabilidad: 4, impacto: 3, puntaje: 12 },
  'durango': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'estado de mexico': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'guanajuato': { probabilidad: 3, impacto: 4, puntaje: 12 },
  'guerrero': { probabilidad: 4, impacto: 3, puntaje: 12 },
  'hidalgo': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'jalisco': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'michoacan': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'morelos': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'nayarit': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'nuevo leon': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'oaxaca': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'puebla': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'queretaro': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'quintana roo': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'san luis potosi': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'sin localidad': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'sinaloa': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'sonora': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'tabasco': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'tamaulipas': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'tlaxcala': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'veracruz': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'yucatan': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'zacatecas': { probabilidad: 3, impacto: 3, puntaje: 9 },
};

/** TIPO DE CLIENTE — 2 opciones. */
export const TIPO_CLIENTE: Record<string, OpcionFactor> = {
  'empresa solicitante': { probabilidad: 1, impacto: 4, puntaje: 4 },
  'inversionista': { probabilidad: 2, impacto: 3, puntaje: 6 },
};

/** PAÍS DE NACIMIENTO — 195 opciones. */
export const PAIS_NACIMIENTO: Record<string, OpcionFactor> = {
  'afganistan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'albania': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'alemania': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'andorra': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'angola': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'antigua y baruda': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'arabia saudita': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'argelia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'argentina': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'armenia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'australia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'austria': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'azerbaiyan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'bahamas': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'banglades': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'barbados': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'barein': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'belgica': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'belice': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'benin': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'bielorrusia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'birmania': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'bolivia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'bosnia-herzegovina': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'botsuana': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'brasil': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'brunei': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'bulgaria': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'burkina faso': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'burundi': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'butan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'cabo verde': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'camboya': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'camerun': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'canada': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'catar': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'chad': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'chile': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'china': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'chipre': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'colombia': { probabilidad: 3, impacto: 4, puntaje: 12 },
  'comoras': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'congo': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'corea del norte': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'corea del sur': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'costa rica': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'croacia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'cuba': { probabilidad: 3, impacto: 4, puntaje: 12 },
  'dinamarca': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'dpminica': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'ecuador': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'egipto': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'el salvador': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'emiratos arabes unidos': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'eritrea': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'eslovania': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'eslovaquia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'espana': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'estados unidos': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'estonia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'etiopia': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'filipinas': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'finlandia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'fiyi': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'francia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'gabon': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'gambia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'georgia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'ghana': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'granada': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'grecia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'guatemela': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'guinea': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'guinea ecuatorial': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'guinea-bisau': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'guyana': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'haiti': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'honduras': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'hungria': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'india': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'indonesia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'irak': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'iran': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'irlandia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'islandia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'islas marshall': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'islas salomon': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'israel': { probabilidad: 2, impacto: 4, puntaje: 8 },
  'italia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'jamaica': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'japon': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'jordania': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'kazajistan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'kenia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'kirguistan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'kiribati': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'kosovo': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'kuwait': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'laos': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'lesoto': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'letonia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'libano': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'liberia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'libia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'liechtenstein': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'lituania': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'luxemburgo': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'macedonia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'madagascar': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'malasia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'malaui': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'maldivas': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'mali': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'malta': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'marruecos': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'mauricio': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'mauritania': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'mexico': { probabilidad: 4, impacto: 2, puntaje: 8 },
  'micronesia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'moldavia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'monaco': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'mongolia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'montenegro': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'mozambique': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'namibia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'nauru': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'nepal': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'nicaragua': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'niger': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'nigeria': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'noruega': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'nueva zelanda': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'oman': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'paises bajos': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'pakistan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'palaos': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'palestina': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'panama': { probabilidad: 3, impacto: 4, puntaje: 12 },
  'papua nueva guinea': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'paraguay': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'peru': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'polonia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'portugal': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'reino unido': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'republica centroafricana': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'republica checa': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'republica democratica del congo': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'republica dominicana': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'ruanda': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'rusia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'samoa': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'san cristobal y nieves': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'san marino': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'san vicente y las granadinas': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'santa lucia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'santo tome y principe': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'senegal': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'serbia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'sierra leona': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'singapur': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'siria': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'somalia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'sri lanka': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'suazilandia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'sudafrica': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'sudan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'sudan del sur': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'suecia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'suiza': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'surinam': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'sychelies': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'tailandia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'taiwan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'tanzania': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'tayikinstan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'timor oriental': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'togo': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'tonga': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'trinidad y tobago': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'tunez': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'turkmenistan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'turquia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'tuvalu': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'ucrania': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'uganda': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'uruguay': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'uzbekistan': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'vanuatu': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'vaticano': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'venezuela': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'vietnam': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'yemen': { probabilidad: 4, impacto: 4, puntaje: 16 },
  'yibuti': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'zambia': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'zimbabue': { probabilidad: 2, impacto: 1, puntaje: 2 },
};

/** PRODUCTOS CONTRATADOS — 3 opciones. */
export const PRODUCTOS_CONTRATADOS: Record<string, OpcionFactor> = {
  'asesoria de inversiones': { probabilidad: 2, impacto: 2, puntaje: 4 },
  'manejo de tesoreria': { probabilidad: 1, impacto: 2, puntaje: 2 },
  'gestion de inversiones': { probabilidad: 3, impacto: 2, puntaje: 6 },
};

/** VOLUMEN EN MONTO — 3 opciones. */
export const VOLUMEN_MONTO: Record<string, OpcionFactor> = {
  'entre 1 y 50 mil pesos': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'entre 51 y 100 mil pesos': { probabilidad: 2, impacto: 2, puntaje: 4 },
  'mas de 100 mil pesos': { probabilidad: 2, impacto: 4, puntaje: 8 },
};

/** VOLUMEN EN NÚMERO DE OPERACIONES — 3 opciones. */
export const VOLUMEN_OPERACIONES: Record<string, OpcionFactor> = {
  'de 1 a 2 operaciones': { probabilidad: 3, impacto: 1, puntaje: 3 },
  'de 2 a 5 operaciones': { probabilidad: 2, impacto: 2, puntaje: 4 },
  'mas de 5 operaciones': { probabilidad: 2, impacto: 3, puntaje: 6 },
};

/** FRECUENCIA — 3 opciones. */
export const FRECUENCIA: Record<string, OpcionFactor> = {
  '1 o 2 operaciones al ano': { probabilidad: 2, impacto: 1, puntaje: 2 },
  'entre 3 y 5 operaciones al ano': { probabilidad: 2, impacto: 2, puntaje: 4 },
  'mas de 5 operaciones al ano': { probabilidad: 2, impacto: 4, puntaje: 8 },
};

/** TIPO DE MONEDA — 4 opciones. */
export const TIPO_MONEDA: Record<string, OpcionFactor> = {
  'peso mexicano': { probabilidad: 3, impacto: 1, puntaje: 3 },
  'dolar usa': { probabilidad: 2, impacto: 3, puntaje: 6 },
  'euro': { probabilidad: 1, impacto: 3, puntaje: 3 },
  'cripto monedas': { probabilidad: 1, impacto: 4, puntaje: 4 },
};

/** Bandas de la matriz. Referencia del análisis, no determinan el grado. */
export const BANDAS_MATRIZ = [
  { max: 74, valor: 'Baja' },
  { max: 98, valor: 'Media' },
  { max: Infinity, valor: 'Alta' },
] as const;

export type BandaMatriz = 'Baja' | 'Media' | 'Alta';
export type GradoRiesgo = 'Alto' | 'Bajo';

/** Mínimo y máximo teóricos de la suma de los quince factores. */
export const PUNTAJE_MINIMO = 43;
export const PUNTAJE_MAXIMO = 130;

/**
 * Criterios ya acordados con el Oficial de Cumplimiento. Aplicar sin volver a
 * preguntar (hoja "Criterios" de la metodología).
 */
export const CRITERIOS_FIJOS = {
  /** Único servicio que presta el Asesor. */
  productosContratados: 'gestion de inversiones',
  /** La cartera está denominada en su totalidad en dólares. */
  tipoMoneda: 'dolar usa',
  /** Todos los clientes son personas físicas. */
  tipoPersona: 'persona fisica',
} as const;

/**
 * Filas del catálogo con puntaje dudoso, detectadas al revisar la metodología.
 * El motor las reproduce tal cual (fidelidad a la metodología aprobada) pero
 * emite una advertencia cuando el puntaje proviene de una de ellas.
 */
export const FILAS_DUDOSAS: readonly string[] = [
  'corea del sur',   // puntúa 16, igual que Corea del Norte y Siria
  'iran',            // puntúa 2, el mínimo
  'uganda',          // puntúa 16
  'vanuatu',         // puntúa 16
];
