/**
 * Motor de Evaluación Basada en Riesgo PLD/FT · CABZ
 * ---------------------------------------------------------------------------
 * Implementa ESPEC_Motor_EBR_CABZ.md. Función pura: no lee la base, no escribe,
 * no consulta listas. Recibe `EBRInputs` y devuelve `EBRResultado`.
 *
 * LAS DOS CAPAS NO SE MEZCLAN
 *
 * Capa 1 · `construirMatriz`. Quince factores, probabilidad × impacto, total
 *   entre 43 y 130. Es EVIDENCIA TÉCNICA del análisis. No determina el grado.
 *
 * Capa 2 · `determinarGrado`. Produce el grado oficial por concurrencia de
 *   supuestos y por las dos reglas automáticas.
 *
 * La separación es estructural, no una convención: `determinarGrado` no recibe
 * el puntaje entre sus argumentos, así que no puede usarlo aunque se quiera.
 * Confundir ambas capas fue el error original del sistema (spec §1).
 *
 * FUNDAMENTO NORMATIVO DE LA CAPA 2 — LEER ANTES DE MODIFICAR
 *
 * La regla de concurrencia se implementa conforme al apartado 4.6 citado en
 * ESPEC_Motor_EBR_CABZ.md §2 y en Metodologia_EBR_PLD_CABZ.xlsx.
 *
 * Consta que el 7 de septiembre de 2026 se revisó el Manual de Cumplimiento
 * v3.0 (2___Manual_de_Cumplimiento_CABZ_VF.pdf) y no se localizaron en él las
 * frases literales de la regla; su sección III.3 transcribe la 13ª de las
 * Disposiciones sin regla de supuestos concurrentes. La decisión de implementar
 * la regla se tomó fuera de este repositorio, con la especificación citada como
 * fuente normativa. Por eso cada clasificación emitida por la vía de
 * concurrencia declara su fundamento en `razon_clasificacion` y en el supuesto
 * correspondiente: quien lea el expediente debe poder ver de dónde salió.
 *
 * Las dos reglas automáticas no dependen de esa discusión: la de listas
 * bloqueadas y la del apartado 4.7 / III.6 (PEP extranjero) están fuera de duda.
 */

import {
  ACTIVIDAD_ECONOMICA,
  BANDAS_MATRIZ,
  EDAD,
  ENTIDAD_FEDERATIVA,
  FRECUENCIA,
  GENERO,
  LISTAS_BLOQUEADAS,
  NACIONALIDAD,
  PAIS_NACIMIENTO,
  PEP,
  PRODUCTOS_CONTRATADOS,
  TIPO_CLIENTE,
  TIPO_MONEDA,
  TIPO_PERSONA,
  VOLUMEN_MONTO,
  VOLUMEN_OPERACIONES,
  normalizar,
  type OpcionFactor,
} from './ebr-catalogo';
import { TIPOS_LISTA, esListaDeSanciones, nombreLista } from './listas';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type GradoRiesgo = 'BAJO' | 'ALTO';
export type Regimen = 'Ordinario' | 'Reforzado';
export type FuenteOverride = 'automatic' | 'listas_csv_manual' | 'nubarium';

/**
 * Quién contestó la pregunta del Art. 17. Espeja el CHECK de
 * `clientes.actividad_vulnerable_fuente`.
 *
 * TRES ESTADOS, NO DOS. La columna `realiza_actividad_vulnerable` ya distinguía
 * `null` («no se preguntó») de `false` («contestó que no»). Esto agrega la
 * tercera posibilidad, que es la real en la cartera: nadie le preguntó al
 * Cliente, pero el Asesor determinó la respuesta a partir de la ocupación
 * declarada y firma esa determinación.
 *
 * NO son intercambiables y el expediente no puede confundirlas: una
 * determinación del Asesor presentada como declaración del Cliente es una
 * declaración inventada. Por eso el texto de `detalle` se arma distinto según
 * esta bandera, y por eso la determinación del Asesor deja constancia de que
 * está pendiente de ratificación.
 *
 * PENDIENTE ANOTADO · `clientes.ocupacion_pb_fuente` tiene el mismo defecto que
 * tenía esta columna: guarda un párrafo («Declarada por el Asesor a partir de
 * KYC…») donde debería guardar quién lo dijo. Debe partirse igual —procedencia
 * en `_fuente`, prosa en un `_detalle`— cuando se toque esa pieza. No se tocó
 * aquí a propósito: son dos migraciones distintas y mezclarlas haría que un
 * error en una revirtiera la otra.
 */
export type FuenteActividadVulnerable = 'cliente' | 'asesor';

/** Una lista vigente contra la que se corrió el cotejo. */
export interface ListaCotejadaEBR {
  /** Espeja `TipoLista` de `lib/listas.ts`: LPB, PEP_NACIONAL, OFAC, SAT_69B, ONU. */
  tipo: string;
  /** Fecha de corte de la lista, no la de la carga. */
  fecha_lista: string;
  /** Cuándo se corrió el cotejo, que es cuando se cargó la lista. */
  fecha_cotejo: string;
}

/**
 * Estado del cotejo del cliente contra las listas de control cargadas.
 *
 * Las coincidencias se cuentan SIN filtrar por vigencia de la lista: retirar
 * una lista no des-confirma un match que un humano ya revisó y confirmó.
 */
export interface CotejoListas {
  /** Las listas VIGENTES contra las que se cotejó. Vacío = ninguna cargada. */
  listas: ListaCotejadaEBR[];
  coincidencias_pendientes: number;
  /**
   * Confirmadas, POR TIPO de la lista de origen. Hasta el 11-sep-2026 era un
   * solo número, y un número no dice de qué lista salió el match: una
   * coincidencia confirmada en el SAT 69-B habría subido al cliente a ALTO con
   * alerta de 24 horas igual que una de OFAC. Se cambió el tipo, y no solo el
   * cálculo, para que todo el que lo lea tenga que decidir qué hace con cada
   * lista.
   *
   * Una coincidencia cuya lista no se pudo leer cuenta bajo
   * `TIPO_LISTA_NO_LEGIBLE`.
   */
  coincidencias_confirmadas_por_tipo: Record<string, number>;
}

/**
 * Qué tipo de lista cierra la verificación de sanciones del §12.
 *
 * SAT_69B NO APARECE, y es el punto entero de tener dos constantes en vez de un
 * booleano: el 69-B es el listado de contribuyentes con operaciones
 * presuntamente inexistentes, materia fiscal, no una lista de sanciones.
 * Cotejarlo es diligencia real y merece constar en el expediente, pero no
 * satisface la búsqueda que el §12 exige.
 *
 * HUBO UNA SEGUNDA VERIFICACIÓN AQUÍ, la de la Lista de Personas Bloqueadas de
 * la SHCP, y se retiró el 9 de septiembre de 2026: las Disposiciones del art.
 * 226 Bis LMV no contemplan ese capítulo para los asesores en inversiones (ver
 * el encabezado de `lib/listas.ts` para el fundamento completo). Mantenerla
 * dejaba TODA evaluación en preliminar por una verificación que no se podía
 * completar nunca.
 *
 * `'LPB'` sigue contando como lista de sanciones —es una lista de bloqueo, y
 * cotejarla es cotejo real— pero no cierra esta verificación: la que sigue
 * abierta es la de la ONU y OFAC, y la LPB no la cubre.
 *
 * Qué es lista de sanciones no se decide aquí: lo dice `TIPOS_SANCIONES` en
 * `lib/listas.ts`, la misma definición que usan la bandeja y la ruta que
 * resuelve coincidencias.
 */
const CIERRA_VERIFICACION_ONU_OFAC: readonly string[] = ['OFAC', 'ONU'];

/**
 * Llave de `coincidencias_confirmadas_por_tipo` para una coincidencia cuya lista
 * de origen no se pudo leer o trae un tipo fuera del catálogo.
 */
export const TIPO_LISTA_NO_LEGIBLE = 'NO_LEGIBLE';

/** ['A', 'B', 'C'] → 'A, B y C'. */
function enumerarListas(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** Error de expediente incompleto. Detiene el cálculo, no se degrada a default. */
export class ErrorEBR extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorEBR';
  }
}

export interface FactorMatriz {
  factor: string;
  opcion_seleccionada: string;
  probabilidad: number;
  impacto: number;
  puntaje: number;
}

export interface SupuestoEvaluado {
  supuesto: string;
  detalle: string;
  fundamento: string;
  activo: boolean;
}

export interface ObservacionEBR {
  factor: string;
  nota: string;
}

/**
 * Entrada del motor.
 *
 * Los booleanos de declaración admiten `null` a propósito: `null` es "la
 * pregunta no se formuló", que NO es lo mismo que "el cliente contestó que no".
 * Colapsar uno en el otro con `??` o con un truthy check es el bug que esta
 * firma existe para impedir.
 *
 * `genero`, `nacionalidad`, `pais_nacimiento` y `entidad_federativa` se declaran
 * como `string` y no como uniones literales porque en la base son texto libre.
 * Tipar lo que se desea en vez de lo que hay solo mueve el fallo a runtime.
 */
export interface EBRInputs {
  // Identidad
  nombre_completo: string;
  rfc: string;
  curp: string;
  fecha_nacimiento: string | null; // YYYY-MM-DD
  genero: string | null;
  nacionalidad: string | null;
  pais_nacimiento: string | null;

  // Domicilio de habitación
  domicilio: string;
  entidad_federativa: string | null;

  // Ocupación · dos campos separados que nunca se cruzan
  ocupacion_libre: string;
  /** Una de las 23 del catálogo PB. Alimenta la matriz. NO dispara Supuesto 1. */
  ocupacion_pb: string | null;
  /** `null` = pregunta no formulada. Marca preliminar, no activa el supuesto. */
  realiza_actividad_vulnerable: boolean | null;
  actividades_vulnerables: string[];
  actividad_vulnerable_detalle?: string | null;
  /**
   * Procedencia de la respuesta anterior. Va apareada con ella: las dos nulas
   * («no consta») o las dos llenas («consta, y consta quién lo dijo»). La base
   * sostiene ese invariante con un CHECK sobre ambas columnas; aquí se vuelve a
   * verificar porque el motor también corre con entradas que no vienen de ahí.
   */
  actividad_vulnerable_fuente?: FuenteActividadVulnerable | null;
  /** Fecha de la declaración o de la determinación. El motor NO evalúa su antigüedad. */
  actividad_vulnerable_fecha?: string | null;

  // PEP · declarado por el cliente
  es_pep_nacional_declarado: boolean | null;
  es_pep_extranjero_declarado: boolean | null;
  familiar_pep_nacional: boolean | null;
  familiar_pep_extranjero: boolean | null;

  // Operatividad
  monto_inicial: number | null;
  operaciones_esperadas_ano: number | null;
  fecha_cuestionario: string | null;

  // Estado documental · solo marca preliminar, nunca eleva el grado
  documentos_completos: boolean | null;

  // Resultado del match contra listas de control (§9). El motor no las consulta.
  override_lista_bloqueadas?: boolean;
  override_pep?: boolean;
  override_source?: FuenteOverride;
  override_notes?: string;

  /**
   * Estado del cotejo contra las listas de control cargadas. Lo arma la ruta
   * leyendo `listas_control` y `listas_coincidencias`; el motor no consulta.
   *
   * De aquí se DERIVA `override_lista_bloqueadas` cuando no viene fijado a
   * mano, y de aquí sale el texto que dice contra qué se cotejó. Ausente
   * significa que no se preguntó, no que no haya listas.
   */
  cotejo_listas?: CotejoListas;

  tipo_persona?: string | null;
}

export interface EBRResultado {
  // Identidad, para el reporte
  cliente: string;
  rfc: string;
  curp: string;
  edad: number | null;
  domicilio: string;
  ocupacion_libre: string;
  ocupacion_pb: string;
  realiza_actividad_vulnerable: boolean | null;
  actividades_vulnerables: string[];
  monto_inicial_declarado: number | null;
  fecha_cuestionario: string | null;

  // Clasificación oficial · Capa 2
  grado_riesgo: GradoRiesgo;
  regimen: Regimen;
  medidas: string;
  supuestos_evaluados: SupuestoEvaluado[];
  razon_clasificacion: string;
  fundamento_clasificacion: string;

  // Matriz PB · Capa 1, evidencia técnica
  matriz_factores: FactorMatriz[];
  matriz_puntaje_total: number;
  matriz_banda: string;
  matriz_valoracion_referencial: string;

  // Flags
  es_pep: boolean;
  pep_extranjero: boolean;
  requiere_aprobacion_oficial: boolean;
  aplica_medidas_pep: boolean;
  en_lista_bloqueadas: boolean;
  alerta_critica: string | null;

  // Estado del expediente
  evaluacion_preliminar: boolean;
  motivos_preliminar: string[];
  verificaciones_pendientes: string[];
  observaciones: ObservacionEBR[];

  // Trazabilidad
  fecha_evaluacion: string;
  override_source: string;
  elaboro: string;
  revisa_autoriza: string;
}

// ---------------------------------------------------------------------------
// Constantes normativas
// ---------------------------------------------------------------------------

export const ELABORO = 'Claudio Alberto Bustamante Zardain';
export const REVISA_AUTORIZA = 'Mtro. Erick Adair Islas Plata';

export const FUNDAMENTOS = {
  supuesto1:
    'Art. 17 LFPIORPI (Anexo 3 del Manual), reforma DOF 16-jul-2025. Actividad ' +
    'vulnerable manifestada por el Cliente.',
  supuesto2:
    'Anexo 2 del Manual, jurisdicciones de alto riesgo GAFI.',
  supuesto3:
    'Manual de Cumplimiento, apartado 4.7. Persona Políticamente Expuesta, ' +
    'propia o por parentesco hasta segundo grado.',
  concurrencia:
    'Manual de Cumplimiento, apartado 4.6, según ESPEC_Motor_EBR_CABZ.md §2: ' +
    'Riesgo bajo por regla general, salvo que concurran DOS de los tres ' +
    'supuestos.',
  listasBloqueadas:
    'Manual de Cumplimiento, apartado 10.10. Coincidencia en Lista de Personas ' +
    'Bloqueadas (SHCP/UIF), listas del Consejo de Seguridad de la ONU u OFAC.',
  pepExtranjero:
    'Manual de Cumplimiento, apartado 4.7 (III.6 en la v3.0). Los PEP de ' +
    'nacionalidad extranjera son de alto riesgo de oficio.',
} as const;

/**
 * Anexo 2 · jurisdicciones de alto riesgo GAFI (spec §7). Activan el Supuesto 2.
 *
 * Se reproduce la lista tal como está aprobada. Dos observaciones que el motor
 * emite cuando la usa, sin alterarla: COREA DEL SUR figura aquí pero no en las
 * listas del GAFI, e IRÁN sí está en la lista negra del GAFI y no figura aquí.
 */
export const ANEXO_2_GAFI: readonly string[] = [
  'bosnia-herzegovina',
  'corea del norte',
  'corea del sur',
  'etiopia',
  'irak',
  'siria',
  'uganda',
  'vanuatu',
  'venezuela',
  'yemen',
];

/** Jurisdicciones del Anexo 2 cuya inclusión no coincide con las listas GAFI. */
const ANEXO_2_DUDOSAS: readonly string[] = ['corea del sur'];

/**
 * Anexo 3 · las 16 actividades vulnerables del Art. 17 LFPIORPI (spec §6).
 * Son las que disparan el Supuesto 1. NO se confunden con el catálogo de
 * ocupación PB, que solo alimenta la matriz.
 */
export const ANEXO_3_ACTIVIDADES: readonly string[] = [
  'juegos con apuesta, concursos o sorteos',
  'tarjetas de servicios o de credito no financieras',
  'tarjetas prepagadas, vales o cupones',
  'cheques de viajero',
  'mutuo, prestamo o credito',
  'servicios de construccion o desarrollo inmobiliario',
  'comercializacion de metales preciosos, joyas o relojes',
  'comercializacion de obras de arte',
  'comercializacion de vehiculos aereos, maritimos o terrestres',
  'blindaje de bienes',
  'traslado o custodia de dinero o valores',
  'servicios profesionales (juridicos, notariales, contables, corredores)',
  'fe publica (notarios, corredores)',
  'recepcion de donativos por asociaciones civiles',
  'servicios de comercio exterior',
  'arrendamiento de inmuebles',
];

/**
 * Nombres correctos que no empatan con la llave del catálogo por erratas de
 * captura del Excel original. El catálogo se dejó fiel a la metodología
 * aprobada, así que la corrección vive aquí.
 *
 * Solo 'guatemala' tiene consecuencia de puntaje (8 contra el default de 2).
 * Las demás valen lo mismo que el default, pero se mapean igual para que la
 * opción seleccionada quede bien escrita en el expediente.
 */
export const ALIAS_PAISES: Record<string, string> = {
  'guatemala': 'guatemela',
  'dominica': 'dpminica',
  'eslovenia': 'eslovania',
  'irlanda': 'irlandia',
  'seychelles': 'sychelies',
  'tayikistan': 'tayikinstan',
  'antigua y barbuda': 'antigua y baruda',
  'tunez': 'tunez',
  'birmania (myanmar)': 'birmania',
  'myanmar': 'birmania',
  'paises bajos (holanda)': 'paises bajos',
  'holanda': 'paises bajos',
  'republica democratica del congo': 'republica democratica del congo',
  'suiza (confederacion helvetica)': 'suiza',
};

/**
 * Las verificaciones previas a la apertura (spec §12). Eran siete; quedan seis
 * desde que se retiró la búsqueda en la Lista de Personas Bloqueadas de la SHCP
 * (9 de septiembre de 2026, ver `CIERRA_VERIFICACION_ONU_OFAC`).
 *
 * PENDIENTE · la base no tiene columnas donde registrar que se ejecutaron. Solo
 * la de sanciones y la de PEP pueden darse por hechas, y eso a partir de los
 * overrides. Mientras esos campos no existan, toda evaluación sale preliminar,
 * que es exactamente lo que §12 ordena. Los campos de verificación son una
 * pieza aparte, todavía no construida.
 *
 * LAS DOS PRIMERAS SE NOMBRAN. El filtro de abajo las distinguía por posición
 * (`i === 0`, `i === 1`), así que quitar un renglón de esta lista corría los
 * índices y cambiaba en silencio qué verificación se daba por cerrada. Con
 * constantes, moverlas de lugar no rompe nada.
 */
export const VERIF_SANCIONES =
  'Búsqueda en las listas del Consejo de Seguridad de la ONU y sanciones internacionales, incluida OFAC.';

export const VERIF_PEP =
  'Consulta de la condición de PEP propia y de familiares hasta segundo grado.';

export const VERIFICACIONES: readonly string[] = [
  VERIF_SANCIONES,
  VERIF_PEP,
  'Verificación de identidad contra el padrón del RENAPO.',
  'Validación de la Constancia de Situación Fiscal ante el SAT.',
  'Documentación del origen lícito de los recursos.',
  'Entrevista personal registrada en el expediente.',
];

const MEDIDAS_ORDINARIO =
  'Expediente conforme al Capítulo I del Manual. Evaluación del perfil ' +
  'transaccional y del grado de riesgo al menos una vez por año calendario, ' +
  'sobre Clientes cuyo contrato se haya celebrado con al menos seis meses de ' +
  'anticipación. Seguimiento de operaciones por el Sistema Automatizado.';

const MEDIDAS_REFORZADO =
  'Cuestionario de identificación adicional sobre el origen y destino de los ' +
  'recursos. Aprobación por escrito del Asesor previa a la celebración del ' +
  'contrato, con constancia en el expediente (apartado III.5). Visita ' +
  'domiciliaria dentro de los 20 días hábiles siguientes cuando se actualice ' +
  'alguno de los supuestos. Evaluación anual del perfil transaccional y del ' +
  'grado de riesgo.';

// ---------------------------------------------------------------------------
// Contexto de cálculo
// ---------------------------------------------------------------------------

interface Contexto {
  observaciones: ObservacionEBR[];
  motivosPreliminar: string[];
}

function anotar(ctx: Contexto, factor: string, nota: string): void {
  ctx.observaciones.push({ factor, nota });
}

function marcarPreliminar(ctx: Contexto, motivo: string): void {
  if (!ctx.motivosPreliminar.includes(motivo)) ctx.motivosPreliminar.push(motivo);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function aFechaUTC(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (!m) return null;
  const fecha = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return fecha.getUTCMonth() === Number(m[2]) - 1 ? fecha : null;
}

/** Edad cumplida a la fecha de evaluación. */
function calcularEdad(fechaNacimiento: string | null, ahora: Date): number | null {
  const nacimiento = aFechaUTC(fechaNacimiento);
  if (!nacimiento) return null;
  let edad = ahora.getUTCFullYear() - nacimiento.getUTCFullYear();
  const mes = ahora.getUTCMonth() - nacimiento.getUTCMonth();
  if (mes < 0 || (mes === 0 && ahora.getUTCDate() < nacimiento.getUTCDate())) edad--;
  return edad >= 0 ? edad : null;
}

function bandaDe(total: number): string {
  return BANDAS_MATRIZ.find((b) => total <= b.max)?.valor ?? 'Alta';
}

/**
 * Etiquetas de presentación de los factores derivados.
 *
 * Las llaves del catálogo están normalizadas —minúsculas y sin acentos— para
 * poder comparar. No deben imprimirse tal cual en el expediente: «MAS DE 50
 * ANOS» no es texto presentable en un documento que lee el supervisor. Donde
 * el valor lo captura el cliente se imprime lo capturado; donde el motor lo
 * deriva de un número, se imprime la etiqueta de esta tabla.
 */
const ETIQUETAS: Record<string, string> = {
  '18 a 35 anos': '18 A 35 AÑOS',
  '36 a 50 anos': '36 A 50 AÑOS',
  'mas de 50 anos': 'MÁS DE 50 AÑOS',
  'entre 1 y 50 mil pesos': 'ENTRE 1 Y 50 MIL PESOS',
  'entre 51 y 100 mil pesos': 'ENTRE 51 Y 100 MIL PESOS',
  'mas de 100 mil pesos': 'MÁS DE 100 MIL PESOS',
  'de 1 a 2 operaciones': 'DE 1 A 2 OPERACIONES',
  'de 2 a 5 operaciones': 'DE 2 A 5 OPERACIONES',
  'mas de 5 operaciones': 'MÁS DE 5 OPERACIONES',
  '1 o 2 operaciones al ano': '1 O 2 OPERACIONES AL AÑO',
  'entre 3 y 5 operaciones al ano': 'ENTRE 3 Y 5 OPERACIONES AL AÑO',
  'mas de 5 operaciones al ano': 'MÁS DE 5 OPERACIONES AL AÑO',
  'persona moral': 'PERSONA MORAL',
  'hombre': 'HOMBRE',
  'extranjera': 'EXTRANJERA',
  'servicios profesionales': 'SERVICIOS PROFESIONALES',
};

function etiqueta(clave: string): string {
  return ETIQUETAS[clave] ?? clave.toUpperCase();
}

function buscar(
  catalogo: Record<string, OpcionFactor>,
  valor: string | null | undefined,
): { clave: string; opcion: OpcionFactor } | null {
  if (!valor) return null;
  const clave = normalizar(valor);
  const opcion = catalogo[clave];
  return opcion ? { clave, opcion } : null;
}

function fila(
  factor: string,
  etiqueta: string,
  opcion: OpcionFactor,
): FactorMatriz {
  return {
    factor,
    opcion_seleccionada: etiqueta,
    probabilidad: opcion.probabilidad,
    impacto: opcion.impacto,
    puntaje: opcion.puntaje,
  };
}

/**
 * Resuelve un factor de catálogo. Cuando el valor no se reconoce, imputa la
 * opción de respaldo y deja constancia: ningún dato faltante cae a un default
 * en silencio (spec §4).
 *
 * Criterio de imputación cuando la spec no fija un default: se toma la opción
 * de MAYOR puntaje. En PLD el dato ausente nunca debe beneficiar al expediente.
 * Donde la spec sí fija un default (entidad federativa 6, país 2) manda la spec.
 */
function factorConRespaldo(
  ctx: Contexto,
  factor: string,
  catalogo: Record<string, OpcionFactor>,
  valor: string | null | undefined,
  claveRespaldo: string,
): FactorMatriz {
  const hallado = buscar(catalogo, valor);
  // Se imprime lo que el cliente declaró, no la llave normalizada de búsqueda.
  if (hallado) return fila(factor, (valor ?? hallado.clave).toUpperCase(), hallado.opcion);

  const respaldo = catalogo[claveRespaldo];
  const motivo = valor ? `valor no reconocido: «${valor}»` : 'dato ausente';
  anotar(
    ctx,
    factor,
    `${motivo}. Se imputó «${etiqueta(claveRespaldo)}», la opción de mayor ` +
      `puntaje del factor. La imputación no beneficia al expediente y queda aquí asentada.`,
  );
  marcarPreliminar(ctx, `Factor ${factor} imputado por ${motivo}.`);
  return fila(factor, `${etiqueta(claveRespaldo)} (imputado)`, respaldo);
}

// ---------------------------------------------------------------------------
// §15 · Validaciones que detienen el cálculo
// ---------------------------------------------------------------------------

/**
 * Estas cuatro condiciones son expediente incompleto, no dato faltante: el
 * motor se detiene con el mensaje literal de la spec en vez de adivinar.
 *
 * Excepción deliberada: `realiza_actividad_vulnerable === null` NO se valida
 * aquí. La spec §15 lo listaba como error, pero la columna admite null con el
 * significado «pregunta no formulada» y el padrón vigente la tiene en null en
 * la mayoría de los expedientes. Abortar dejaría al motor sin poder correr
 * sobre la cartera real, así que ese caso marca la evaluación como preliminar
 * (ver `evaluarSupuesto1`). Las otras tres validaciones se conservan intactas.
 */
export function validarInputs(inputs: EBRInputs): void {
  if (!inputs.ocupacion_pb || !inputs.ocupacion_pb.trim()) {
    throw new ErrorEBR(
      'El cliente no ha seleccionado su ocupación del catálogo PB. La EBR no puede correrse.',
    );
  }

  if (!buscar(ACTIVIDAD_ECONOMICA, inputs.ocupacion_pb)) {
    throw new ErrorEBR(
      `Ocupación no reconocida en el catálogo. Valor recibido: «${inputs.ocupacion_pb}».`,
    );
  }

  if (
    inputs.realiza_actividad_vulnerable === true &&
    inputs.actividades_vulnerables.length === 0
  ) {
    throw new ErrorEBR('Debe seleccionarse al menos una actividad vulnerable.');
  }
}

// ---------------------------------------------------------------------------
// Capa 1 · Matriz institucional PB
// ---------------------------------------------------------------------------

/**
 * Los quince factores. Devuelve evidencia técnica del análisis.
 *
 * No devuelve ni recibe nada relacionado con el grado de riesgo: esa es la
 * frontera entre las dos capas.
 */
export function construirMatriz(
  inputs: EBRInputs,
  ctx: Contexto,
  edad: number | null,
  esPep: boolean,
  enListaBloqueadas: boolean,
): { factores: FactorMatriz[]; total: number; banda: string } {
  const factores: FactorMatriz[] = [];

  // 1 · Tipo de persona. Universo CABZ: todas son personas físicas.
  factores.push(
    factorConRespaldo(
      ctx,
      'TIPO DE PERSONA',
      TIPO_PERSONA,
      inputs.tipo_persona ?? 'PERSONA FÍSICA',
      'persona moral',
    ),
  );

  // 2 · Edad. Derivada de la fecha de nacimiento.
  if (edad === null) {
    anotar(
      ctx,
      'EDAD',
      'Sin fecha de nacimiento legible. Se imputó «18 A 35 AÑOS», la banda de mayor puntaje.',
    );
    marcarPreliminar(ctx, 'Factor EDAD imputado por falta de fecha de nacimiento.');
    factores.push(fila('EDAD', '18 A 35 AÑOS (imputado)', EDAD['18 a 35 anos']));
  } else {
    const clave = edad <= 35 ? '18 a 35 anos' : edad <= 50 ? '36 a 50 anos' : 'mas de 50 anos';
    factores.push(fila('EDAD', etiqueta(clave), EDAD[clave]));
  }

  // 3 · Género.
  factores.push(factorConRespaldo(ctx, 'GÉNERO', GENERO, inputs.genero, 'hombre'));

  // 4 · Actividad económica. Ya validada contra las 23 del catálogo PB.
  // Es la ocupación declarada, NO la actividad vulnerable: no dispara supuestos.
  factores.push(
    factorConRespaldo(
      ctx,
      'ACTIVIDAD ECONÓMICA',
      ACTIVIDAD_ECONOMICA,
      inputs.ocupacion_pb,
      'servicios profesionales',
    ),
  );

  // 5 · PEP.
  factores.push(fila('PERSONA POLÍTICAMENTE EXPUESTA', esPep ? 'SÍ' : 'NO', PEP[esPep ? 'si' : 'no']));

  // 6 · Listas bloqueadas. Sin búsqueda ejecutada no se puede afirmar una
  // coincidencia: se registra NO y la evaluación queda preliminar.
  factores.push(
    fila(
      'LISTA DE PERSONAS BLOQUEADAS / LISTAS DE LA ONU',
      enListaBloqueadas ? 'SÍ' : 'NO',
      LISTAS_BLOQUEADAS[enListaBloqueadas ? 'si' : 'no'],
    ),
  );

  // 7 · Nacionalidad.
  factores.push(
    factorConRespaldo(ctx, 'NACIONALIDAD', NACIONALIDAD, inputs.nacionalidad, 'extranjera'),
  );

  // 8 · Entidad federativa. La spec §8 fija default P2 × I3 = 6 si no coincide.
  const entidad = buscar(ENTIDAD_FEDERATIVA, inputs.entidad_federativa);
  if (entidad) {
    factores.push(
      fila(
        'ENTIDAD FEDERATIVA DE RESIDENCIA',
        (inputs.entidad_federativa ?? entidad.clave).toUpperCase(),
        entidad.opcion,
      ),
    );
  } else {
    anotar(
      ctx,
      'ENTIDAD FEDERATIVA DE RESIDENCIA',
      `${inputs.entidad_federativa ? `«${inputs.entidad_federativa}» no está en el catálogo` : 'dato ausente'}. ` +
        'Se aplicó el default de la spec §8 (P2 × I3 = 6). Revisar la captura: el campo ' +
        'debe llevar el nombre completo con acentos («Ciudad de México», no «CDMX»).',
    );
    marcarPreliminar(ctx, 'Entidad federativa no reconocida en el catálogo.');
    factores.push(
      fila('ENTIDAD FEDERATIVA DE RESIDENCIA', `${inputs.entidad_federativa ?? 'SIN DATO'} (default)`, {
        probabilidad: 2,
        impacto: 3,
        puntaje: 6,
      }),
    );
  }

  // 9 · Tipo de cliente. Criterio acordado: INVERSIONISTA en todos los casos.
  factores.push(fila('TIPO DE CLIENTE', 'INVERSIONISTA', TIPO_CLIENTE['inversionista']));

  // 10 · País de nacimiento. La spec §10 fija default P2 × I1 = 2.
  const claveAlias = inputs.pais_nacimiento
    ? (ALIAS_PAISES[normalizar(inputs.pais_nacimiento)] ?? normalizar(inputs.pais_nacimiento))
    : null;
  const pais = buscar(PAIS_NACIMIENTO, claveAlias);
  if (pais) {
    factores.push(fila('PAÍS DE NACIMIENTO', (inputs.pais_nacimiento ?? '').toUpperCase(), pais.opcion));
  } else {
    // «Dato ausente» y «valor no reconocido» son huecos distintos y se corrigen
    // distinto: el primero se captura, el segundo se investiga contra el
    // catálogo. La observación ya los distinguía; el motivo preliminar no, y es
    // el que el revisor lee primero. Se arma una sola vez, como en
    // `factorConRespaldo`, para que los dos textos no puedan volver a divergir.
    const ausente = !inputs.pais_nacimiento;
    anotar(
      ctx,
      'PAÍS DE NACIMIENTO',
      `${ausente ? 'dato ausente' : `«${inputs.pais_nacimiento}» no está en el catálogo`}. ` +
        'Se aplicó el default de la spec §10 (P2 × I1 = 2).',
    );
    // El motivo nombra además la consecuencia sobre la matriz, para que no se
    // confunda con el que emite el Supuesto 2 sobre el mismo campo ausente.
    marcarPreliminar(
      ctx,
      ausente
        ? 'No se capturó el país de nacimiento: la matriz usó el default de la spec §10.'
        : `País de nacimiento «${inputs.pais_nacimiento}» no reconocido en el catálogo de la matriz.`,
    );
    factores.push(
      fila('PAÍS DE NACIMIENTO', `${inputs.pais_nacimiento ?? 'SIN DATO'} (default)`, {
        probabilidad: 2,
        impacto: 1,
        puntaje: 2,
      }),
    );
  }

  // 11 · Productos. Criterio acordado: GESTIÓN DE INVERSIONES, único servicio.
  factores.push(
    fila('PRODUCTOS CONTRATADOS', 'GESTIÓN DE INVERSIONES', PRODUCTOS_CONTRATADOS['gestion de inversiones']),
  );

  // 12 · Volumen en monto. Depósito inicial declarado, no el ahorro acumulado.
  if (inputs.monto_inicial === null || !Number.isFinite(inputs.monto_inicial)) {
    anotar(
      ctx,
      'VOLUMEN EN MONTO',
      'Sin depósito inicial declarado. Se imputó «MÁS DE 100 MIL PESOS», la banda de mayor puntaje.',
    );
    marcarPreliminar(ctx, 'Volumen en monto imputado por falta de depósito inicial declarado.');
    factores.push(fila('VOLUMEN EN MONTO', 'MÁS DE 100 MIL PESOS (imputado)', VOLUMEN_MONTO['mas de 100 mil pesos']));
  } else {
    const monto = inputs.monto_inicial;
    const clave =
      monto <= 50_000 ? 'entre 1 y 50 mil pesos' : monto <= 100_000 ? 'entre 51 y 100 mil pesos' : 'mas de 100 mil pesos';
    factores.push(fila('VOLUMEN EN MONTO', etiqueta(clave), VOLUMEN_MONTO[clave]));
  }

  // 13 y 14 · Número de operaciones y frecuencia. Ambos salen del mismo dato
  // declarado. Las bandas del factor 13 se solapan en el valor 2 («DE 1 A 2» y
  // «DE 2 A 5»): se resuelve el empate hacia la banda baja, y aquí queda dicho.
  const ops = inputs.operaciones_esperadas_ano;
  if (ops === null || !Number.isFinite(ops)) {
    anotar(
      ctx,
      'VOLUMEN EN NÚMERO DE OPERACIONES',
      'Sin operaciones esperadas declaradas. Se imputó la banda de mayor puntaje en este factor y en FRECUENCIA.',
    );
    marcarPreliminar(ctx, 'Volumen y frecuencia imputados por falta de operatividad declarada.');
    factores.push(
      fila('VOLUMEN EN NÚMERO DE OPERACIONES', 'MÁS DE 5 OPERACIONES (imputado)', VOLUMEN_OPERACIONES['mas de 5 operaciones']),
    );
    factores.push(
      fila('FRECUENCIA', 'MÁS DE 5 OPERACIONES AL AÑO (imputado)', FRECUENCIA['mas de 5 operaciones al ano']),
    );
  } else {
    const claveOps = ops <= 2 ? 'de 1 a 2 operaciones' : ops <= 5 ? 'de 2 a 5 operaciones' : 'mas de 5 operaciones';
    factores.push(fila('VOLUMEN EN NÚMERO DE OPERACIONES', etiqueta(claveOps), VOLUMEN_OPERACIONES[claveOps]));

    const claveFrec =
      ops <= 2 ? '1 o 2 operaciones al ano' : ops <= 5 ? 'entre 3 y 5 operaciones al ano' : 'mas de 5 operaciones al ano';
    factores.push(fila('FRECUENCIA', etiqueta(claveFrec), FRECUENCIA[claveFrec]));
  }

  // 15 · Moneda. Criterio acordado: DÓLAR USA, la cartera es íntegramente USD.
  factores.push(fila('TIPO DE MONEDA', 'DÓLAR USA', TIPO_MONEDA['dolar usa']));

  const total = factores.reduce((suma, f) => suma + f.puntaje, 0);
  return { factores, total, banda: bandaDe(total) };
}

// ---------------------------------------------------------------------------
// Capa 2 · Los tres supuestos
// ---------------------------------------------------------------------------

function evaluarSupuesto1(inputs: EBRInputs, ctx: Contexto): SupuestoEvaluado {
  const base = {
    supuesto: '1 · Actividad vulnerable (Art. 17 LFPIORPI, Anexo 3)',
    fundamento: FUNDAMENTOS.supuesto1,
  };

  const fuente = inputs.actividad_vulnerable_fuente ?? null;

  // null NO es false: la pregunta no se formuló. El supuesto no se puede
  // evaluar, la evaluación es preliminar, y el grado no se eleva por ello.
  if (inputs.realiza_actividad_vulnerable === null) {
    anotar(
      ctx,
      'SUPUESTO 1',
      'No consta la respuesta del cliente sobre actividades vulnerables del Art. 17. ' +
        'El supuesto no pudo evaluarse; no se presume ni afirmativo ni negativo.',
    );
    marcarPreliminar(ctx, 'No consta la declaración de actividad vulnerable (Art. 17).');
    return { ...base, detalle: 'Pregunta no formulada. Supuesto no evaluable.', activo: false };
  }

  // Hay respuesta pero no consta quién la dio. La base lo impide con un CHECK
  // sobre las dos columnas; si llega igual, el motor NO elige un texto: escribir
  // «el Cliente declara» sin saberlo es inventar una declaración, y escribir
  // «el Asesor determinó» sin saberlo es atribuirle una firma que no dio.
  //
  // Un SÍ sin procedencia sí activa el supuesto: en PLD, un dato que agrava no
  // se descarta por venir mal documentado. Un NO sin procedencia no cierra
  // nada, porque una negativa sin origen no es una negativa.
  if (fuente === null) {
    const afirmativo = inputs.realiza_actividad_vulnerable === true;
    anotar(
      ctx,
      'SUPUESTO 1',
      'Consta una respuesta sobre actividades vulnerables del Art. 17 SIN procedencia: no ' +
        'se registró si la declaró el Cliente o la determinó el Asesor. El expediente no ' +
        'puede atribuirla a ninguno de los dos.',
    );
    marcarPreliminar(
      ctx,
      'La respuesta sobre actividad vulnerable (Art. 17) no tiene procedencia registrada.',
    );
    return {
      ...base,
      detalle: afirmativo
        ? `Consta que realiza: ${inputs.actividades_vulnerables.join(', ')}. Sin procedencia registrada.`
        : 'Consta una respuesta negativa sin procedencia registrada. Supuesto no evaluable.',
      activo: afirmativo,
    };
  }

  const porAsesor = fuente === 'asesor';
  const fecha = inputs.actividad_vulnerable_fecha
    ? ` del ${inputs.actividad_vulnerable_fecha.slice(0, 10)}`
    : '';

  // La determinación del Asesor CIERRA el motivo preliminar —la pregunta ya
  // tiene respuesta con procedencia, que era lo que faltaba— pero deja dicho en
  // el expediente que todavía no la ratifica quien tiene que ratificarla. Es una
  // observación y no un motivo: constar no es lo mismo que bloquear.
  if (porAsesor) {
    anotar(
      ctx,
      'SUPUESTO 1',
      `Determinación del Asesor en Inversiones${fecha}, no declaración del Cliente. Se sostiene ` +
        'en la ocupación declarada y queda pendiente de ratificación conforme al detalle ' +
        'asentado en el expediente.',
    );
  }

  if (inputs.realiza_actividad_vulnerable === false) {
    return {
      ...base,
      detalle: porAsesor
        ? `Determinación del Asesor en Inversiones${fecha}: no consta que el Cliente realice ` +
          'actividades vulnerables del Art. 17.'
        : 'El cliente declara no realizar actividades vulnerables.',
      activo: false,
    };
  }

  const desconocidas = inputs.actividades_vulnerables.filter(
    (a) => !ANEXO_3_ACTIVIDADES.includes(normalizar(a)),
  );
  if (desconocidas.length > 0) {
    anotar(
      ctx,
      'SUPUESTO 1',
      `Actividades ${porAsesor ? 'determinadas' : 'declaradas'} que no figuran entre las 16 del ` +
        `Art. 17: ${desconocidas.join(', ')}. Se contabilizan igual, pero conviene cotejar la captura.`,
    );
  }

  return {
    ...base,
    detalle: porAsesor
      ? `Determinación del Asesor en Inversiones${fecha}: el Cliente realiza ` +
        `${inputs.actividades_vulnerables.join(', ')}.`
      : `El cliente declara realizar: ${inputs.actividades_vulnerables.join(', ')}.`,
    activo: true,
  };
}

function evaluarSupuesto2(inputs: EBRInputs, ctx: Contexto): SupuestoEvaluado {
  const base = {
    supuesto: '2 · Domicilio o nacimiento en jurisdicción de alto riesgo (Anexo 2)',
    fundamento: FUNDAMENTOS.supuesto2,
  };

  // El expediente no captura país de residencia como campo propio. La entidad
  // federativa solo admite estados mexicanos, así que con residencia en México
  // este supuesto se evalúa contra el país de nacimiento, y en la práctica no
  // se actualiza (spec §7).
  const clave = inputs.pais_nacimiento ? normalizar(inputs.pais_nacimiento) : null;
  const canonica = clave ? (ALIAS_PAISES[clave] ?? clave) : null;

  if (!canonica) {
    anotar(ctx, 'SUPUESTO 2', 'Sin país de nacimiento capturado. El supuesto no pudo evaluarse.');
    marcarPreliminar(ctx, 'No consta el país de nacimiento para evaluar el Anexo 2.');
    return { ...base, detalle: 'Sin país de nacimiento capturado. Supuesto no evaluable.', activo: false };
  }

  const activo = ANEXO_2_GAFI.includes(canonica);

  if (activo && ANEXO_2_DUDOSAS.includes(canonica)) {
    anotar(
      ctx,
      'SUPUESTO 2',
      `«${inputs.pais_nacimiento}» figura en el Anexo 2 aprobado, pero no aparece en las ` +
        'listas vigentes del GAFI. El supuesto se activa conforme al Anexo, y la ' +
        'discrepancia se asienta para revisión del Oficial de Cumplimiento.',
    );
  }

  return {
    ...base,
    detalle: activo
      ? `País de nacimiento «${inputs.pais_nacimiento}» figura en el Anexo 2.`
      : `País de nacimiento «${inputs.pais_nacimiento}» no figura en el Anexo 2.`,
    activo,
  };
}

function evaluarSupuesto3(inputs: EBRInputs, ctx: Contexto, esPep: boolean): SupuestoEvaluado {
  const base = {
    supuesto: '3 · Persona Políticamente Expuesta',
    fundamento: FUNDAMENTOS.supuesto3,
  };

  const banderas = [
    inputs.es_pep_nacional_declarado,
    inputs.es_pep_extranjero_declarado,
    inputs.familiar_pep_nacional,
    inputs.familiar_pep_extranjero,
  ];

  // Sin ninguna declaración capturada, no consta que se haya preguntado.
  if (banderas.every((b) => b === null || b === undefined) && inputs.override_pep === undefined) {
    anotar(
      ctx,
      'SUPUESTO 3',
      'No consta la declaración PEP del cliente ni de sus familiares hasta segundo grado. ' +
        'El supuesto no pudo evaluarse; la ausencia de registro no equivale a una respuesta negativa.',
    );
    marcarPreliminar(ctx, 'No consta la declaración PEP (apartado 4.7).');
    return { ...base, detalle: 'Declaración PEP no capturada. Supuesto no evaluable.', activo: false };
  }

  const detalles: string[] = [];
  if (inputs.es_pep_nacional_declarado) detalles.push('PEP nacional declarado');
  if (inputs.es_pep_extranjero_declarado) detalles.push('PEP extranjero declarado');
  if (inputs.familiar_pep_nacional) detalles.push('familiar de PEP nacional');
  if (inputs.familiar_pep_extranjero) detalles.push('familiar de PEP extranjero');
  if (inputs.override_pep) detalles.push('coincidencia PEP por screening');

  return {
    ...base,
    detalle: esPep ? detalles.join('; ') + '.' : 'El cliente declara no ser PEP ni tener familiar PEP.',
    activo: esPep,
  };
}

// ---------------------------------------------------------------------------
// Capa 2 · Determinación del grado
// ---------------------------------------------------------------------------

/**
 * Produce el grado oficial. Nótese que NO recibe el puntaje de la matriz: la
 * separación entre capas está impuesta por la firma de la función.
 *
 * Orden de evaluación, con corto circuito (spec §2):
 *   1. Coincidencia en listas bloqueadas → ALTO (automática)
 *   2. PEP extranjero                    → ALTO (automática)
 *   3. Dos o más supuestos activos       → ALTO (concurrencia 4.6)
 *   4. Resto                             → BAJO (regla general)
 */
export function determinarGrado(
  supuestos: SupuestoEvaluado[],
  enListaBloqueadas: boolean,
  pepExtranjero: boolean,
): { grado: GradoRiesgo; razon: string; fundamento: string } {
  if (enListaBloqueadas) {
    return {
      grado: 'ALTO',
      // No se nombra UNA lista: el motor recibe el conteo de coincidencias
      // confirmadas, no de cuál lista salieron. Decir «Lista de Personas
      // Bloqueadas» cuando el match vino de OFAC sería afirmar en el expediente
      // algo que no consta. Cuál fue está en la bandeja de coincidencias.
      razon:
        'Regla automática: coincidencia confirmada en listas de bloqueo o sanciones ' +
        '(Lista de Personas Bloqueadas, ONU u OFAC). Suspender operaciones y reportar en ' +
        '24 horas vía SITI.',
      fundamento: FUNDAMENTOS.listasBloqueadas,
    };
  }

  if (pepExtranjero) {
    return {
      grado: 'ALTO',
      razon: 'Regla automática: PEP extranjero. Reclasificación de oficio, sin necesidad de concurrencia.',
      fundamento: FUNDAMENTOS.pepExtranjero,
    };
  }

  const activos = supuestos.filter((s) => s.activo);
  if (activos.length >= 2) {
    return {
      grado: 'ALTO',
      razon:
        `Concurrencia de ${activos.length} supuestos: ${activos.map((s) => s.supuesto).join(' + ')}.`,
      fundamento: FUNDAMENTOS.concurrencia,
    };
  }

  return {
    grado: 'BAJO',
    razon:
      activos.length === 1
        ? `Regla general. Un solo supuesto activo (${activos[0].supuesto}); la regla exige dos para elevar a ALTO.`
        : 'Regla general. Ningún supuesto activo.',
    fundamento: FUNDAMENTOS.concurrencia,
  };
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

/**
 * Recorre las coincidencias CONFIRMADAS por tipo de lista, asienta lo que toca
 * a cada una y devuelve cuántas son de sanciones —las únicas que activan la
 * regla automática del §2— y cuántas no.
 *
 *   LPB, OFAC, ONU    cuentan para el bloqueo. El texto lo pone `determinarGrado`.
 *   SAT 69-B          observación. Materia fiscal: no eleva el grado.
 *   PEP nacionales    no bloquea; deja preliminar si la declaración no lo dice.
 *   Tipo no legible   cuenta para el bloqueo Y deja un motivo preliminar.
 */
function procesarConfirmadas(
  inputs: EBRInputs,
  cotejo: CotejoListas,
  ctx: Contexto
): { sanciones: number; otras: number } {
  let sanciones = 0;
  let otras = 0;

  for (const [tipo, n] of Object.entries(cotejo.coincidencias_confirmadas_por_tipo)) {
    if (!(n > 0)) continue;

    if (esListaDeSanciones(tipo)) {
      sanciones += n;
      continue;
    }

    if (tipo === 'SAT_69B') {
      otras += n;
      anotar(
        ctx,
        'LISTAS DE CONTROL',
        `${n} coincidencia(s) CONFIRMADA(S) contra el SAT 69-B. Es materia fiscal, no lista ` +
          'de sanciones: no eleva el grado, no genera alerta crítica ni dispara la ruta de 24 ' +
          'horas. Consta en el expediente como insumo de debida diligencia.'
      );
      continue;
    }

    if (tipo === 'PEP_NACIONAL') {
      // Criterio de Claudio Bustamante, 11 de septiembre de 2026. El expediente
      // tiene que explicar las dos mitades: por qué no bloquea y por qué, aun
      // así, la evaluación no puede darse por concluida.
      otras += n;
      const noBloquea =
        'No reclasifica de oficio ni bloquea: el apartado 4.7 del Manual reserva la ' +
        'reclasificación de oficio al PEP extranjero, y el PEP nacional se evalúa como ' +
        'Supuesto 3, en concurrencia con los otros dos.';

      if (inputs.es_pep_nacional_declarado === true) {
        // La lista corrobora lo declarado: no hay nada que conciliar.
        anotar(
          ctx,
          'LISTAS DE CONTROL',
          `${n} coincidencia(s) CONFIRMADA(S) contra la lista de PEP nacionales, que ` +
            `corrobora la declaración del Cliente. ${noBloquea}`
        );
      } else {
        const declaracion =
          inputs.es_pep_nacional_declarado === false ? 'niega ser PEP' : 'no consta';
        marcarPreliminar(
          ctx,
          `${n} coincidencia(s) CONFIRMADA(S) contra la lista de PEP nacionales. ${noBloquea} ` +
            `Pero la coincidencia deja SIN VERIFICAR la declaración del Cliente —que ` +
            `${declaracion}—, y el Supuesto 3 se evalúa con esa declaración: el motor todavía ` +
            'no toma la condición de PEP de las listas. La evaluación queda preliminar hasta ' +
            'conciliar la declaración con la lista.'
        );
      }
      continue;
    }

    // Tipo no legible o fuera del catálogo. Ante un origen desconocido se falla
    // del lado conservador —una coincidencia confirmada no se da por limpia—,
    // pero DICIÉNDOLO: un bug de datos que empiece a producir ALTOs tiene que
    // verse en el expediente, no descubrirse después.
    sanciones += n;
    marcarPreliminar(
      ctx,
      `${n} coincidencia(s) CONFIRMADA(S) cuyo tipo de lista no fue legible` +
        (tipo === TIPO_LISTA_NO_LEGIBLE ? '' : ` (se leyó «${tipo}»)`) +
        '. Se tratan como coincidencia en listas de sanciones —ante un origen desconocido el ' +
        'motor falla del lado conservador— y por eso elevan el grado a ALTO. Si la ' +
        'clasificación no corresponde, lo que falló es la lectura de la lista de origen: ' +
        'revisar la coincidencia en la bandeja de listas de control y reevaluar.'
    );
  }

  return { sanciones, otras };
}

/** Lo que el cotejo de listas resuelve para el resto de la evaluación. */
interface EstadoListas {
  /** Solo una coincidencia CONFIRMADA lo pone en true. */
  enListaBloqueadas: boolean;
  /** ¿Se ejecutó la búsqueda de sanciones (ONU / OFAC)? */
  cierraOnuOfac: boolean;
  /** Fuente a declarar cuando el estado se derivó del cotejo cargado. */
  fuente: FuenteOverride | null;
}

/**
 * Resuelve el estado de listas a partir del override manual o del cotejo.
 *
 * UNA COINCIDENCIA PENDIENTE NO ES UNA COINCIDENCIA. Puede ser un homónimo, y
 * confirmarla es un acto humano que ocurre en la bandeja de /admin/listas.
 * Tratarla como confirmada elevaría el grado a ALTO y dispararía la suspensión
 * de operaciones y el reporte de 24 horas contra alguien que quizá solo comparte
 * apellido. Por eso una pendiente deja la evaluación PRELIMINAR —no puede darse
 * por concluida— pero no eleva el grado.
 *
 * Criterio confirmado por Claudio Bustamante el 9 de septiembre de 2026, y es
 * el mismo que ya aplican `/api/cargar-lista` y la bandeja de coincidencias.
 */
function resolverListas(inputs: EBRInputs, ctx: Contexto): EstadoListas {
  // 1 · El override capturado a mano manda sobre el cotejo. Es la vía para
  //     asentar un screening ejecutado fuera del sistema, y quien lo captura
  //     está declarando que la búsqueda en sanciones se hizo.
  if (inputs.override_lista_bloqueadas !== undefined) {
    return {
      enListaBloqueadas: inputs.override_lista_bloqueadas === true,
      cierraOnuOfac: true,
      fuente: null,
    };
  }

  const cotejo = inputs.cotejo_listas;

  // 2 · Sin cotejo, o con cotejo pero sin ninguna lista vigente: nada cambia
  //     respecto del comportamiento anterior.
  if (!cotejo || cotejo.listas.length === 0) {
    marcarPreliminar(
      ctx,
      'No consta la búsqueda en las listas del Consejo de Seguridad de la ONU ni en las de ' +
        'sanciones internacionales (OFAC).'
    );
    return { enListaBloqueadas: false, cierraOnuOfac: false, fuente: null };
  }

  const tipos = cotejo.listas.map((l) => l.tipo);
  const cierraOnuOfac = tipos.some((t) => CIERRA_VERIFICACION_ONU_OFAC.includes(t));
  const haySanciones = tipos.some((t) => esListaDeSanciones(t));

  const detalle = enumerarListas(
    cotejo.listas.map((l) => `${nombreLista(l.tipo)} (corte ${l.fecha_lista})`)
  );
  // El cotejo más antiguo manda: el conjunto vale lo que su eslabón más viejo.
  const fechaCotejo = cotejo.listas
    .map((l) => l.fecha_cotejo)
    .reduce((min, f) => (f < min ? f : min));

  // 3 · Coincidencias CONFIRMADAS. Un humano ya revisó el careo y dijo que es
  //     la persona. Qué sigue depende de la lista de origen: solo una lista de
  //     sanciones activa la regla automática del §2.
  const confirmadas = procesarConfirmadas(inputs, cotejo, ctx);
  if (confirmadas.sanciones > 0) {
    return { enListaBloqueadas: true, cierraOnuOfac, fuente: 'listas_csv_manual' };
  }

  // Con una confirmada que no es de sanciones —un 69-B, un PEP nacional—,
  // decir «sin coincidencias» a secas sería falso. Sin ninguna, el texto queda
  // exactamente como antes.
  const resultadoCotejo =
    confirmadas.otras > 0 ? 'sin coincidencias en listas de sanciones' : 'sin coincidencias';

  // 4 · Coincidencias PENDIENTES. Ni limpio ni bloqueado: sin resolver.
  if (cotejo.coincidencias_pendientes > 0) {
    marcarPreliminar(
      ctx,
      `Hay ${cotejo.coincidencias_pendientes} coincidencia(s) PENDIENTE(S) de revisión ` +
        `contra ${detalle}. Una coincidencia pendiente puede ser un homónimo: no eleva el ` +
        'grado ni suspende operaciones, pero la evaluación no puede darse por concluida ' +
        'hasta resolverla en la bandeja de listas de control.'
    );
    return { enListaBloqueadas: false, cierraOnuOfac: false, fuente: 'listas_csv_manual' };
  }

  // 5 · Sin coincidencias, pero ninguna lista de sanciones entre las vigentes.
  //     El cotejo vale —es debida diligencia y así se asienta—, pero la búsqueda
  //     en sanciones no se ha hecho y eso sí deja la evaluación preliminar.
  if (!haySanciones) {
    marcarPreliminar(
      ctx,
      `Cotejo ejecutado el ${fechaCotejo} contra ${detalle}, ${resultadoCotejo}. Es medida de ` +
        'debida diligencia reforzada e insumo de la metodología de evaluación de riesgos ' +
        '(Capítulo II Bis de las Disposiciones), pero ninguna de esas listas es de ' +
        'sanciones —el SAT 69-B es materia fiscal, no PLD—, así que NO consta la búsqueda en ' +
        'las listas del Consejo de Seguridad de la ONU y de OFAC.'
    );
    return { enListaBloqueadas: false, cierraOnuOfac: false, fuente: 'listas_csv_manual' };
  }

  // 6 · Sin coincidencias y con sanciones cotejadas. ESTO ES UNA OBSERVACIÓN, NO
  //     UN MOTIVO PRELIMINAR, y el cambio es deliberado.
  //
  //     Hasta el 9 de septiembre de 2026 aquí se marcaba preliminar diciendo que
  //     el cotejo «NO sustituye la búsqueda en la Lista de Personas Bloqueadas
  //     (SHCP), que es la única que cierra la verificación del apartado III.10».
  //     Eso dejó de ser cierto: las Disposiciones del art. 226 Bis LMV no
  //     contemplan ese capítulo para los asesores en inversiones (fundamento
  //     completo en el encabezado de `lib/listas.ts`). Con OFAC y el 69-B basta,
  //     y sostener el motivo mantenía a los expedientes en preliminar por una
  //     verificación que no se podía completar nunca.
  //
  //     El cotejo NO se degrada a trámite: sigue siendo debida diligencia
  //     reforzada e insumo de la metodología de evaluación de riesgos del
  //     Capítulo II Bis de las Disposiciones, que sí es obligatorio. Por eso se
  //     asienta en `observaciones`, donde el revisor lo lee como lo que es:
  //     esfuerzo ejecutado que consta en el expediente.
  anotar(
    ctx,
    'LISTAS DE CONTROL',
    `Cotejo ejecutado el ${fechaCotejo} contra ${detalle}, ${resultadoCotejo}. Se asienta como ` +
      'medida de debida diligencia reforzada e insumo de la metodología de evaluación de ' +
      'riesgos del Capítulo II Bis de las Disposiciones de carácter general a que se refiere ' +
      'el artículo 226 Bis de la Ley del Mercado de Valores.'
  );

  return { enListaBloqueadas: false, cierraOnuOfac, fuente: 'listas_csv_manual' };
}

export function evaluarEBR(inputs: EBRInputs, ahora: Date = new Date()): EBRResultado {
  // §15 antes que nada: expediente incompleto no se calcula.
  validarInputs(inputs);

  const ctx: Contexto = { observaciones: [], motivosPreliminar: [] };

  const estadoListas = resolverListas(inputs, ctx);
  const enListaBloqueadas = estadoListas.enListaBloqueadas;

  // PEP: cualquiera de las cuatro declaraciones, o el resultado del screening.
  const esPep =
    inputs.es_pep_nacional_declarado === true ||
    inputs.es_pep_extranjero_declarado === true ||
    inputs.familiar_pep_nacional === true ||
    inputs.familiar_pep_extranjero === true ||
    inputs.override_pep === true;

  /**
   * CRITERIO ACORDADO (Claudio Bustamante, 7 de septiembre de 2026): el
   * familiar de PEP extranjero dispara la regla automática igual que el
   * titular del cargo. El Manual da a los relacionados —cónyuge, concubina o
   * concubinario y parientes por consanguinidad o afinidad hasta segundo
   * grado— el mismo tratamiento que al titular, y en PLD la lectura
   * conservadora es la defendible ante el supervisor.
   *
   * No es una interpretación del motor: es criterio de la firma. Cambiarlo
   * requiere decisión del Oficial de Cumplimiento, no un ajuste de código.
   */
  const pepExtranjero =
    inputs.es_pep_extranjero_declarado === true || inputs.familiar_pep_extranjero === true;

  const edad = calcularEdad(inputs.fecha_nacimiento, ahora);

  // Capa 1
  const matriz = construirMatriz(inputs, ctx, edad, esPep, enListaBloqueadas);

  // Capa 2
  const supuestos = [
    evaluarSupuesto1(inputs, ctx),
    evaluarSupuesto2(inputs, ctx),
    evaluarSupuesto3(inputs, ctx, esPep),
  ];
  const { grado, razon, fundamento } = determinarGrado(supuestos, enListaBloqueadas, pepExtranjero);

  // Documentación incompleta: marca preliminar y nada más. No es supuesto.
  if (inputs.documentos_completos !== true) {
    marcarPreliminar(ctx, 'Documentación del expediente incompleta.');
  }

  const verificacionesPendientes = VERIFICACIONES.filter((v) => {
    // Se identifican por su texto, no por su posición en el arreglo: mover o
    // quitar un renglón de `VERIFICACIONES` no puede volver a cambiar en
    // silencio qué verificación se da por cerrada.
    //
    // La búsqueda de sanciones la cierra ONU u OFAC, nunca el SAT 69-B: es
    // materia fiscal, no PLD, y darla por hecha al cargar el 69-B es
    // exactamente lo que no puede pasar.
    if (v === VERIF_SANCIONES) return !estadoListas.cierraOnuOfac;
    if (v === VERIF_PEP) {
      return inputs.es_pep_nacional_declarado === null && inputs.override_pep === undefined;
    }
    // Las otras cuatro no tienen dónde registrarse en la base: siempre pendientes.
    return true;
  });

  if (verificacionesPendientes.length > 0) {
    marcarPreliminar(ctx, `Quedan ${verificacionesPendientes.length} verificaciones sin ejecutar.`);
  }

  return {
    cliente: inputs.nombre_completo,
    rfc: inputs.rfc,
    curp: inputs.curp,
    edad,
    domicilio: inputs.domicilio,
    ocupacion_libre: inputs.ocupacion_libre,
    ocupacion_pb: inputs.ocupacion_pb as string,
    realiza_actividad_vulnerable: inputs.realiza_actividad_vulnerable,
    actividades_vulnerables: inputs.actividades_vulnerables,
    monto_inicial_declarado: inputs.monto_inicial,
    fecha_cuestionario: inputs.fecha_cuestionario,

    grado_riesgo: grado,
    regimen: grado === 'ALTO' ? 'Reforzado' : 'Ordinario',
    medidas: grado === 'ALTO' ? MEDIDAS_REFORZADO : MEDIDAS_ORDINARIO,
    supuestos_evaluados: supuestos,
    razon_clasificacion: razon,
    fundamento_clasificacion: fundamento,

    matriz_factores: matriz.factores,
    matriz_puntaje_total: matriz.total,
    matriz_banda: matriz.banda,
    matriz_valoracion_referencial:
      `Banda ${matriz.banda} (${matriz.total} de 130 puntos). Referencial: es evidencia ` +
      'técnica del análisis y no determina el grado de riesgo.',

    es_pep: esPep,
    pep_extranjero: pepExtranjero,
    requiere_aprobacion_oficial: esPep && grado === 'ALTO',
    aplica_medidas_pep: esPep,
    en_lista_bloqueadas: enListaBloqueadas,
    alerta_critica: enListaBloqueadas
      ? 'ALERTA CRÍTICA: coincidencia en listas. Suspender operaciones y reportar en 24 horas vía SITI (apartado 10.10).'
      : null,

    evaluacion_preliminar: ctx.motivosPreliminar.length > 0,
    motivos_preliminar: ctx.motivosPreliminar,
    verificaciones_pendientes: verificacionesPendientes,
    observaciones: ctx.observaciones,

    fecha_evaluacion: ahora.toISOString().slice(0, 10),
    // La fuente declarada explícitamente manda; si no, se declara de dónde
    // salió realmente el estado de listas. 'automatic' solo cuando no hubo ni
    // override ni cotejo, que es cuando el motor no supo nada de listas.
    override_source: inputs.override_source ?? estadoListas.fuente ?? 'automatic',
    elaboro: ELABORO,
    revisa_autoriza: REVISA_AUTORIZA,
  };
}

// ---------------------------------------------------------------------------
// Adaptador · filas de la base a EBRInputs
// ---------------------------------------------------------------------------

/** Filas tal como llegan de Supabase. Los `any` de la base se acotan aquí. */
export interface FilasEBR {
  cliente: Record<string, unknown>;
  kyc?: Record<string, unknown> | null;
  pep?: Record<string, unknown> | null;
  transaccionalidad?: Record<string, unknown> | null;
  /**
   * Filas de `listas_control` (las vigentes) y `listas_coincidencias` (las del
   * cliente). Las lee la ruta: el motor no consulta la base.
   *
   * `undefined` significa que no se preguntó y la evaluación se comporta como
   * antes de que existieran las listas. Un arreglo vacío en `vigentes` sí es
   * una respuesta: no hay ninguna lista cargada.
   */
  listas?: FilasListas | null;
}

/** Lo que la ruta lee de las tablas de listas, en crudo. */
export interface FilasListas {
  vigentes: Record<string, unknown>[];
  /** Coincidencias del cliente en estado `pendiente` o `confirmada`. */
  coincidencias: Record<string, unknown>[];
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function textoONull(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}

function boolONull(valor: unknown): boolean | null {
  return typeof valor === 'boolean' ? valor : null;
}

/**
 * Procedencia de la respuesta del Art. 17, acotada al par válido.
 *
 * Cualquier otro valor cae a `null`, que el motor lee como «sin procedencia» y
 * trata como hueco. Es lo correcto: una procedencia que no se reconoce no es
 * una procedencia, y colarla como si fuera 'cliente' sería inventar la
 * declaración. La columna trajo texto libre hasta el 10-sep-2026, así que este
 * filtro también es la red que evita que un renglón heredado se lea como firma.
 */
function fuenteActividad(valor: unknown): FuenteActividadVulnerable | null {
  return valor === 'cliente' || valor === 'asesor' ? valor : null;
}

function numeroONull(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Traduce las filas de `clientes`, `kyc_detalle`, `pep_listas` y
 * `transaccionalidad` a la entrada del motor.
 *
 * Tres renombres respecto de la spec §13, que usa otros nombres:
 *   pep_listas.es_pep_nacional      -> es_pep_nacional_declarado
 *   pep_listas.es_pep_extranjero    -> es_pep_extranjero_declarado
 *   kyc_detalle.entidad_federativa_pb -> entidad_federativa
 *
 * Cuando falta la fila de `pep_listas` no se asume que el cliente no es PEP:
 * los cuatro campos quedan en `null`, que el motor lee como «no consta».
 */
/**
 * Filas de listas a `CotejoListas`.
 *
 * `fecha_cotejo` sale de `fecha_carga`, no de `fecha_lista`: el cotejo ocurre
 * al cargar la lista, y son dos fechas que responden preguntas distintas —de
 * cuándo son los datos, y cuándo se compararon contra la cartera—.
 *
 * Las coincidencias llegan ya filtradas por la ruta a `pendiente` y
 * `confirmada`: una `descartada` es un homónimo que alguien revisó y descartó,
 * y contarla reabriría una decisión ya tomada.
 *
 * Cada coincidencia trae embebida su lista de origen (`lista: { tipo }`), y las
 * confirmadas se cuentan por ese tipo: es lo que separa una coincidencia en
 * OFAC de una en el SAT 69-B.
 */
function construirCotejo(filas: FilasListas | null | undefined): CotejoListas | undefined {
  if (!filas) return undefined;

  const listas: ListaCotejadaEBR[] = filas.vigentes.map((l) => ({
    tipo: texto(l.tipo),
    fecha_lista: texto(l.fecha_lista).slice(0, 10),
    fecha_cotejo: texto(l.fecha_carga).slice(0, 10),
  }));

  let pendientes = 0;
  const confirmadasPorTipo: Record<string, number> = {};
  for (const c of filas.coincidencias) {
    if (c.estado === 'confirmada') {
      const tipo = tipoDeLaCoincidencia(c);
      confirmadasPorTipo[tipo] = (confirmadasPorTipo[tipo] ?? 0) + 1;
    } else if (c.estado === 'pendiente') {
      pendientes++;
    }
  }

  return {
    listas,
    coincidencias_pendientes: pendientes,
    coincidencias_confirmadas_por_tipo: confirmadasPorTipo,
  };
}

/**
 * Tipo de la lista de origen de una coincidencia, tal como lo embebe el runner.
 *
 * PostgREST entrega objeto en una relación muchos-a-uno, pero se acepta también
 * arreglo: si la forma cambia, la coincidencia debe seguir contando por su tipo
 * y no caer en «no legible».
 *
 * Lo que no sea un tipo del catálogo cae en `TIPO_LISTA_NO_LEGIBLE`, que el
 * motor trata como lista de sanciones y además deja dicho en un motivo.
 */
function tipoDeLaCoincidencia(c: Record<string, unknown>): string {
  const lista = Array.isArray(c.lista) ? c.lista[0] : c.lista;
  const tipo =
    lista && typeof lista === 'object' ? (lista as Record<string, unknown>).tipo : undefined;
  return typeof tipo === 'string' && (TIPOS_LISTA as readonly string[]).includes(tipo)
    ? tipo
    : TIPO_LISTA_NO_LEGIBLE;
}

export function construirInputsEBR(filas: FilasEBR): EBRInputs {
  const { cliente, kyc, pep, transaccionalidad } = filas;

  const nombre = [cliente.nombre, cliente.apellido_paterno, cliente.apellido_materno]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ');

  const domicilio = [kyc?.calle, kyc?.numero_exterior, kyc?.colonia, kyc?.municipio, kyc?.estado, kyc?.codigo_postal]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(', ');

  const actividades = Array.isArray(cliente.actividades_vulnerables)
    ? (cliente.actividades_vulnerables as unknown[]).filter((a): a is string => typeof a === 'string')
    : [];

  // `operaciones_esperadas_ano` no existe como columna en la base: se deriva.
  //
  // ES UNA INFERENCIA, no un dato declarado por el cliente. La spec §17 fija
  // que volumen y frecuencia salen «de los depósitos y retiros mensuales
  // declarados en el cuestionario de conocimiento del cliente»: la fuente es
  // la correcta, pero la anualización a doce meses es aritmética de este
  // adaptador. Se suman depósitos y retiros porque los factores 13 y 14 miden
  // operaciones totales, no solo entradas.
  //
  // Criterio confirmado por Claudio Bustamante el 7 de septiembre de 2026.
  //
  // Si ambos vienen vacíos el resultado es null, nunca cero: sin declaración
  // no se inventa una operatividad de cero, se marca preliminar.
  const depositos = numeroONull(transaccionalidad?.depositos_mensuales);
  const retiros = numeroONull(transaccionalidad?.retiros_mensuales);
  const operacionesAno =
    depositos === null && retiros === null ? null : ((depositos ?? 0) + (retiros ?? 0)) * 12;

  return {
    nombre_completo: nombre,
    rfc: texto(cliente.rfc),
    curp: texto(cliente.curp),
    fecha_nacimiento: textoONull(cliente.fecha_nacimiento),
    genero: textoONull(cliente.genero),
    nacionalidad: textoONull(kyc?.nacionalidad),
    pais_nacimiento: textoONull(kyc?.pais_nacimiento),

    domicilio,
    entidad_federativa: textoONull(kyc?.entidad_federativa_pb),

    ocupacion_libre: texto(cliente.ocupacion),
    ocupacion_pb: textoONull(cliente.ocupacion_pb),
    realiza_actividad_vulnerable: boolONull(cliente.realiza_actividad_vulnerable),
    actividades_vulnerables: actividades,
    actividad_vulnerable_detalle: textoONull(cliente.actividad_vulnerable_detalle),
    actividad_vulnerable_fuente: fuenteActividad(cliente.actividad_vulnerable_fuente),
    actividad_vulnerable_fecha: textoONull(cliente.actividad_vulnerable_fecha),

    es_pep_nacional_declarado: boolONull(pep?.es_pep_nacional),
    es_pep_extranjero_declarado: boolONull(pep?.es_pep_extranjero),
    familiar_pep_nacional: boolONull(pep?.familiar_pep_nacional),
    familiar_pep_extranjero: boolONull(pep?.familiar_pep_extranjero),

    monto_inicial: numeroONull(transaccionalidad?.monto_inicial_deposito),
    operaciones_esperadas_ano: operacionesAno,
    fecha_cuestionario: textoONull(transaccionalidad?.fecha_declaracion),

    documentos_completos: boolONull(cliente.documentos_completos),

    cotejo_listas: construirCotejo(filas.listas),

    tipo_persona: 'PERSONA FÍSICA',
  };
}
