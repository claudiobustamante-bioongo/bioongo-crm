/**
 * Listas de control PLD/FT · normalización, parseo y cotejo.
 * ---------------------------------------------------------------------------
 * Lógica pura: no toca Supabase ni la red. Las rutas la alimentan y guardan el
 * resultado. Aquí solo se decide QUÉ coincide, nunca qué se hace al respecto.
 *
 * Una sola lista es obligatoria para el Asesor en Inversiones: la de PEP
 * nacionales. OFAC, SAT 69-B y ONU son diligencia adicional y NO cumplen esa
 * obligación. Cargar OFAC y creer que la obligación quedó cubierta es el error
 * que `esObligatoria()` existe para hacer imposible: la bandera se deriva del
 * tipo, nunca se recibe.
 *
 * LA LISTA DE PERSONAS BLOQUEADAS DEJÓ DE SER OBLIGACIÓN — LEER ANTES DE
 * VOLVER A AGREGARLA
 *
 * La CNBV confirmó por escrito el 9 de septiembre de 2026 que las Disposiciones
 * de carácter general a que se refiere el artículo 226 Bis de la Ley del Mercado
 * de Valores NO contemplan el capítulo «Lista de Personas Bloqueadas» para los
 * asesores en inversiones, y que el artículo 48 fracción XVIII del Reglamento
 * Interior de la CNBV no los incluye entre los destinatarios de la lista.
 * Cotejado contra el texto publicado en el DOF (2014, 2019 y 2023): el capítulo
 * no existe. El fundamento de esta constante es ese oficio, no el apartado
 * III.10 del Manual de Cumplimiento v3.0, que sigue listando la búsqueda y debe
 * ajustarse fuera de este repositorio.
 *
 * `'LPB'` NO se retira del catálogo de tipos: sigue siendo una lista cargable y
 * cotejable, solo que no obligatoria. El régimen de SOFOM E.N.R. sí la
 * contempla y este módulo se reusa ahí. Retirar la capacidad técnica costaría
 * reconstruirla; retirar la obligación es lo que corresponde.
 *
 * EL COTEJO ES SOLO EXACTO, a propósito. Sin fuzzy, sin distancia de edición,
 * sin fonética. Un falso positivo en una lista de bloqueo cuesta suspenderle las
 * operaciones a un cliente que no era; una lista de coincidencias llena de ruido
 * se deja de revisar, que es la manera más silenciosa de incumplir. El precio de
 * esta decisión son los falsos negativos, y está documentado abajo.
 */

/** Tipos permitidos. Espeja el CHECK de `listas_control.tipo`. */
export type TipoLista = 'LPB' | 'PEP_NACIONAL' | 'OFAC' | 'SAT_69B' | 'ONU';

export const TIPOS_LISTA: readonly TipoLista[] = [
  'LPB',
  'PEP_NACIONAL',
  'OFAC',
  'SAT_69B',
  'ONU',
];

/**
 * Las obligatorias para el Asesor en Inversiones. Desde el 9 de septiembre de
 * 2026 queda solo la de PEP nacionales: ver la nota sobre la LPB en el
 * encabezado de este archivo.
 *
 * Un régimen distinto —SOFOM E.N.R.— agregaría `'LPB'` aquí y el resto del
 * módulo funcionaría sin tocar nada más. Esa es toda la diferencia.
 */
export const TIPOS_OBLIGATORIOS: readonly TipoLista[] = ['PEP_NACIONAL'];

export function esObligatoria(tipo: TipoLista): boolean {
  return TIPOS_OBLIGATORIOS.includes(tipo);
}

/**
 * Listas de SANCIONES: las únicas cuya coincidencia CONFIRMADA eleva el grado a
 * ALTO con alerta crítica y dispara la ruta reforzada —aviso, confirmación
 * explícita y obligaciones asentadas en la bitácora—.
 *
 * Una sola definición para el motor EBR, la ruta que resuelve coincidencias, la
 * carga de listas y la bandeja. Hasta el 11 de septiembre de 2026 vivía
 * repartida y se contradecía: el motor elevaba a ALTO con CUALQUIER coincidencia
 * confirmada —el SAT 69-B incluido— y las otras tres piezas solo reaccionaban a
 * `'LPB'`. Al retirar la LPB como lista operativa y quedar OFAC en su lugar, el
 * motor alarmaba y la bandeja se quedaba callada.
 *
 * SAT_69B NO ESTÁ: es materia fiscal —contribuyentes con operaciones
 * presuntamente inexistentes—, no una lista de sanciones. Decisión tomada, no se
 * reabre. PEP_NACIONAL tampoco: el PEP nacional no reclasifica de oficio
 * (Manual de Cumplimiento, apartado 4.7).
 *
 * `'LPB'` SÍ está aunque dejó de ser obligatoria: sigue siendo una lista de
 * bloqueo, y una coincidencia confirmada en ella pesa lo mismo que en OFAC.
 */
export const TIPOS_SANCIONES: readonly TipoLista[] = ['LPB', 'OFAC', 'ONU'];

/** Recibe texto y no `TipoLista` porque el tipo llega de la base, sin garantía. */
export function esListaDeSanciones(tipo: string | null | undefined): boolean {
  return typeof tipo === 'string' && (TIPOS_SANCIONES as readonly string[]).includes(tipo);
}

/** Nombre legible por tipo, para motivos, avisos y la bandeja. */
export const NOMBRE_LISTA: Record<TipoLista, string> = {
  LPB: 'Lista de Personas Bloqueadas',
  PEP_NACIONAL: 'PEP nacionales',
  OFAC: 'OFAC',
  SAT_69B: 'SAT 69-B',
  ONU: 'ONU',
};

export function nombreLista(tipo: string): string {
  return NOMBRE_LISTA[tipo as TipoLista] ?? tipo;
}

/**
 * Las dos obligaciones que nacen al CONFIRMAR una coincidencia en una lista de
 * sanciones. Manual de Cumplimiento, apartado 10.10.
 *
 * Son texto para quien decide, no acciones del sistema: ninguna parte de este
 * código suspende operaciones ni presenta el reporte. Ver el encabezado de
 * /api/resolver-coincidencia.
 */
export const OBLIGACIONES_SANCIONES = [
  'Suspender de inmediato la realización de cualquier acto u operación con el Cliente.',
  'Reportar a la CNBV dentro de las 24 horas siguientes, vía SITI, con la leyenda «Reporte de 24 horas».',
] as const;

/**
 * Tope del cuerpo de la petición al cargar una lista.
 *
 * Es el límite que Next impone cuando hay proxy —el `middleware.ts` de este
 * proyecto lo activa para toda ruta—. Al excederlo Next NO falla: bufferea
 * hasta el tope y deja un warning en consola, así que el CSV se truncaría en
 * silencio y la lista quedaría incompleta pareciendo completa.
 *
 * Vive aquí y no en la ruta porque el formulario avisa antes de subir y la
 * ruta rechaza al recibir: dos guardas del mismo número, una sola definición.
 * Subirlo requiere además tocar `experimental.proxyClientMaxBodySize`.
 */
export const TOPE_BODY_LISTA = 10 * 1024 * 1024;

/**
 * Cuántas filas se inspeccionan buscando el encabezado antes de rendirse.
 *
 * Los archivos oficiales traen preámbulo: el «Listado completo 69-B» del SAT
 * gasta dos renglones —párrafo legal y título— antes de los nombres de columna.
 * Diez da margen de sobra sin llegar nunca a los datos de un archivo que de
 * verdad no trae encabezado.
 */
export const MAX_FILAS_PREAMBULO = 10;

/** Espeja el CHECK de `listas_coincidencias.tipo_match`. */
export type TipoMatch = 'rfc_exacto' | 'curp_exacto' | 'nombre_exacto';

/** Error de entrada del operador: archivo ilegible o sin la columna mínima. */
export class ErrorLista extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorLista';
  }
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

// Mismo rango y misma forma explícita que `ips-catalogo.ts`: un literal de
// combinantes invisible en el fuente es intocable para quien lo lea después.
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');
const NO_ALFANUMERICO = /[^A-Z0-9 ]/g;
const ESPACIOS = / +/g;

/**
 * Nombre a su forma comparable: sin acentos, en mayúsculas, sin signos y con
 * los espacios colapsados.
 *
 * ADVERTENCIA · esta función es persistente. Su salida se guarda en
 * `listas_registros.nombre_norm`. Cambiarla deja viejos los valores ya escritos
 * y los cotejos empiezan a fallar SIN dar error: los nombres nuevos se
 * normalizan de una forma y los guardados están en otra. Si alguna vez hay que
 * tocarla, hay que re-normalizar la tabla entera en la misma operación.
 *
 * La Ñ se pierde: `normalize('NFD')` la descompone y el filtro de diacríticos
 * le quita la tilde, así que MUÑOZ y MUNOZ colapsan al mismo valor. Para
 * cotejar listas eso es deseable —las listas oficiales escriben de las dos
 * maneras—, pero conviene tenerlo presente. El mismo efecto está documentado
 * en `ips-catalogo.ts` para 'año' -> 'ano'.
 */
export function normalizarNombre(texto: string | null | undefined): string {
  if (!texto) return '';
  return texto
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toUpperCase()
    .replace(NO_ALFANUMERICO, ' ')
    .replace(ESPACIOS, ' ')
    .trim();
}

/**
 * RFC y CURP a su forma comparable: mayúsculas y solo alfanuméricos.
 *
 * Las listas oficiales y la captura del expediente escriben las claves con
 * guiones, espacios y homoclave separada. Comparar en crudo perdería
 * coincidencias reales por un guion de diferencia.
 */
export function normalizarClave(texto: string | null | undefined): string {
  if (!texto) return '';
  return texto
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Nombre completo del cliente tal como se arma en toda la aplicación. */
export function nombreCompletoCliente(cliente: {
  nombre?: string | null;
  apellido_paterno?: string | null;
  apellido_materno?: string | null;
}): string {
  return [cliente.nombre, cliente.apellido_paterno, cliente.apellido_materno]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Parseo de CSV
// ---------------------------------------------------------------------------

/** Un registro listo para insertar en `listas_registros`, sin `lista_id`. */
export interface RegistroLista {
  nombre: string;
  nombre_norm: string;
  rfc: string | null;
  curp: string | null;
  alias: string | null;
  programa: string | null;
  pais: string | null;
  observaciones: string | null;
}

type CampoRegistro = 'nombre' | 'rfc' | 'curp' | 'alias' | 'programa' | 'pais' | 'observaciones';

export interface ResultadoCSV {
  registros: RegistroLista[];
  /** Qué encabezado del archivo alimentó cada campo. Null = no venía. */
  columnas: Record<CampoRegistro, string | null>;
  delimitador: ',' | ';' | '\t';
  /** Filas descartadas por venir sin nombre, que es NOT NULL en la base. */
  filasSinNombre: number;
  /** Filas completamente vacías, típicas del salto final del archivo. */
  filasVacias: number;
  /** Todo lo que se ignoró o se dedujo. Nunca se traga en silencio. */
  avisos: string[];
}

/**
 * Encabezados que se reconocen, por campo. Se comparan normalizados con
 * `claveEncabezado()`, así que 'Nombre del Contribuyente' entra como
 * NOMBRE_DEL_CONTRIBUYENTE y da igual el acento o la caja.
 *
 * La variedad no es capricho: SAT 69-B publica 'Nombre del Contribuyente',
 * OFAC 'SDN_Name', la LPB 'Nombre o Razón Social'. Un parser que solo acepte
 * 'nombre' obliga a editar a mano cada archivo antes de cargarlo, y editar a
 * mano una lista de control es exactamente donde se pierden renglones.
 */
const ALIAS_COLUMNAS: Record<string, CampoRegistro> = {
  NOMBRE: 'nombre',
  NOMBRES: 'nombre',
  NOMBRE_COMPLETO: 'nombre',
  NOMBRE_O_RAZON_SOCIAL: 'nombre',
  NOMBRE_DEL_CONTRIBUYENTE: 'nombre',
  CONTRIBUYENTE: 'nombre',
  RAZON_SOCIAL: 'nombre',
  DENOMINACION: 'nombre',
  DENOMINACION_O_RAZON_SOCIAL: 'nombre',
  NAME: 'nombre',
  SDN_NAME: 'nombre',
  FULL_NAME: 'nombre',

  RFC: 'rfc',
  RFC_DEL_CONTRIBUYENTE: 'rfc',

  CURP: 'curp',

  ALIAS: 'alias',
  AKA: 'alias',
  AKAS: 'alias',
  OTROS_NOMBRES: 'alias',

  PROGRAMA: 'programa',
  PROGRAMAS: 'programa',
  PROGRAM: 'programa',
  SUPUESTO: 'programa',
  // La situación del 69-B —presunto, desvirtuado, definitivo, sentencia
  // favorable— entra por `programa`. El campo nació para el programa de
  // sanciones de OFAC y el nombre le queda flojo, pero es la única columna que
  // la bandeja ya muestra en el renglón, y ahí es donde el dato sirve: los
  // cuatro estados NO son equivalentes, y tratar un desvirtuado como definitivo
  // es un falso positivo grave.
  //
  // No se filtra al cargar. Un presunto que mañana pase a definitivo debe dejar
  // rastro de que ya venía listado; filtrar el archivo antes de subirlo borra
  // esa historia y deja la carga sin poder explicar desde cuándo aparece. En el
  // corte de julio de 2026, 2,844 de 14,761 filas (19%) no son definitivas.
  SITUACION: 'programa',
  SITUACION_DEL_CONTRIBUYENTE: 'programa',

  PAIS: 'pais',
  COUNTRY: 'pais',
  NACIONALIDAD: 'pais',
  PAIS_CIUDADANIA: 'pais',

  OBSERVACIONES: 'observaciones',
  OBSERVACION: 'observaciones',
  COMENTARIOS: 'observaciones',
  NOTAS: 'observaciones',
  REMARKS: 'observaciones',
};

function claveEncabezado(texto: string): string {
  return normalizarNombre(texto).replace(/ /g, '_');
}

/** Codificaciones que se saben leer. La segunda es el fallback. */
export type CodificacionCSV = 'utf-8' | 'windows-1252';

export interface TextoDecodificado {
  texto: string;
  codificacion: CodificacionCSV;
}

/**
 * Bytes del archivo a texto. UTF-8 estricto primero; si el archivo no es UTF-8
 * válido, se cae a windows-1252.
 *
 * NO se puede usar `File.text()`: decodifica siempre como UTF-8 y en modo
 * tolerante, así que un archivo en codificación heredada no falla — devuelve
 * U+FFFD donde había un acento. Ese es el peor resultado posible: la carga
 * «funciona» y lo que queda escrito son nombres corruptos.
 *
 * El SAT publica el «Listado completo 69-B» en windows-1252. Sin este fallback,
 * `AVALÚOS` se guardaría como `AVAL�OS` en `nombre` y en `nombre_norm`
 * —contaminando el cotejo por nombre y la evidencia—, y el encabezado
 * `Situación del contribuyente` normalizaría a SITUACI_N_DEL_CONTRIBUYENTE, que
 * no empata con ningún alias: la situación se perdería como columna no
 * reconocida, que es justo el dato que la bandeja necesita mostrar.
 *
 * `fatal: true` es lo que hace honesta la detección: sin él, UTF-8 nunca falla
 * y el fallback jamás se alcanzaría. windows-1252 se elige sobre ISO-8859-1
 * porque es un superconjunto en el rango 0x80–0x9F (comillas tipográficas y
 * guiones largos que Excel y los portales oficiales sí emiten).
 *
 * Requiere el runtime `nodejs` —el que Next usa por defecto—: las
 * codificaciones heredadas de `TextDecoder` necesitan ICU completo y no están
 * disponibles en el runtime edge.
 */
export function decodificarCSV(bytes: ArrayBuffer | Uint8Array): TextoDecodificado {
  try {
    return {
      texto: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      codificacion: 'utf-8',
    };
  } catch {
    return {
      texto: new TextDecoder('windows-1252').decode(bytes),
      codificacion: 'windows-1252',
    };
  }
}

/**
 * Delimitador del archivo, contado sobre la primera línea física y fuera de
 * comillas. Los exports de Excel en configuración regional mexicana salen con
 * punto y coma, no con coma: asumir ',' deja una sola columna y ningún error.
 */
function detectarDelimitador(texto: string): ',' | ';' | '\t' {
  const conteo: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let enComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') {
      if (enComillas && texto[i + 1] === '"') {
        i++;
        continue;
      }
      enComillas = !enComillas;
      continue;
    }
    if (enComillas) continue;
    if (c === '\n') break;
    if (c in conteo) conteo[c]++;
  }

  const ganador = (Object.keys(conteo) as Array<',' | ';' | '\t'>).reduce((a, b) =>
    conteo[b] > conteo[a] ? b : a
  );
  // Sin ningún separador el archivo es de una columna: la coma no estorba.
  return conteo[ganador] > 0 ? ganador : ',';
}

/**
 * Texto a matriz de celdas. Respeta comillas dobles, comillas escapadas
 * duplicándolas y saltos de línea dentro del campo entrecomillado.
 */
function dividirFilas(texto: string, delimitador: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let enComillas = false;
  let hayCampo = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += c;
      }
      continue;
    }

    if (c === '"') {
      enComillas = true;
      hayCampo = true;
      continue;
    }
    if (c === delimitador) {
      fila.push(campo);
      campo = '';
      hayCampo = true;
      continue;
    }
    if (c === '\r') continue;
    if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
      hayCampo = false;
      continue;
    }
    campo += c;
    hayCampo = true;
  }

  if (hayCampo || campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas;
}

/** Celda vacía -> null. Evita guardar cadenas vacías donde la base admite NULL. */
function celda(valor: string | undefined): string | null {
  const t = (valor ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * Parsea el CSV de una lista de control.
 *
 * Lanza `ErrorLista` si no encuentra columna de nombre: `nombre` y
 * `nombre_norm` son NOT NULL, y una lista sin nombres no es una lista. Es
 * preferible rechazar la carga a escribir una lista que nunca va a coincidir
 * con nadie y que se verá cargada y vigente en el tablero.
 */
export function parsearCSV(texto: string): ResultadoCSV {
  // BOM de los CSV exportados por Excel. Invisible, y pega justo en el primer
  // encabezado: sin quitarlo, 'RFC' llega como '\uFEFFRFC' y no se reconoce.
  const limpio = texto.replace(new RegExp('^\\uFEFF'), '');
  if (!limpio.trim()) {
    throw new ErrorLista('El archivo está vacío.');
  }

  const delimitador = detectarDelimitador(limpio);
  const filas = dividirFilas(limpio, delimitador);
  if (filas.length === 0) {
    throw new ErrorLista('El archivo está vacío.');
  }

  const avisos: string[] = [];

  // El encabezado no siempre es la primera fila. El «Listado completo 69-B» del
  // SAT trae dos renglones de preámbulo —un párrafo legal y un título— antes de
  // los nombres de columna, y tomar el párrafo como encabezado es exactamente
  // el fallo que se veía: «el archivo no tiene columna de nombre» sobre un
  // archivo que sí la tiene.
  //
  // Se busca la primera fila con una columna de nombre reconocible y se saltan
  // las de arriba, DEJÁNDOLO DICHO en los avisos. Saltarlas en silencio haría
  // que un archivo con más preámbulo del esperado se cargara torcido sin que
  // nadie se entere, y una lista torcida se ve igual de cargada que una buena.
  //
  // La ventana es corta a propósito: buscar el encabezado indefinidamente
  // acabaría encontrándolo en los datos de un archivo que de veras no lo trae.
  const limite = Math.min(filas.length, MAX_FILAS_PREAMBULO);
  let fEncabezado = -1;
  for (let f = 0; f < limite; f++) {
    if (filas[f].some((c) => ALIAS_COLUMNAS[claveEncabezado(c)] === 'nombre')) {
      fEncabezado = f;
      break;
    }
  }

  if (fEncabezado === -1) {
    throw new ErrorLista(
      `El archivo no tiene columna de nombre en sus primeras ${limite} fila(s). ` +
        'Se aceptan, entre otros: nombre, nombre completo, nombre del ' +
        'contribuyente, razón social, name, SDN_Name.'
    );
  }

  if (fEncabezado > 0) {
    avisos.push(
      `Se saltaron ${fEncabezado} fila(s) de preámbulo: el encabezado se encontró ` +
        `en la fila ${fEncabezado + 1}.`
    );
  }

  const encabezados = filas[fEncabezado];
  const columnas: Record<CampoRegistro, string | null> = {
    nombre: null,
    rfc: null,
    curp: null,
    alias: null,
    programa: null,
    pais: null,
    observaciones: null,
  };
  /** Campo -> índice de columna en el archivo. */
  const indice: Partial<Record<CampoRegistro, number>> = {};

  encabezados.forEach((crudo, i) => {
    const clave = claveEncabezado(crudo);
    if (!clave) return;
    const campo = ALIAS_COLUMNAS[clave];
    if (!campo) {
      avisos.push(`Columna no reconocida, se ignora: "${crudo.trim()}".`);
      return;
    }
    if (indice[campo] !== undefined) {
      avisos.push(
        `Columna duplicada para ${campo}: se usa "${columnas[campo]}" y se ignora "${crudo.trim()}".`
      );
      return;
    }
    indice[campo] = i;
    columnas[campo] = crudo.trim();
  });

  // La fila de encabezado se eligió justamente por traer columna de nombre, así
  // que `indice.nombre` está definido. El aserto conserva el estrechamiento de
  // tipo sin repetir un `throw` inalcanzable.
  const iNombre = indice.nombre as number;

  const registros: RegistroLista[] = [];
  let filasSinNombre = 0;
  let filasVacias = 0;

  for (let f = fEncabezado + 1; f < filas.length; f++) {
    const fila = filas[f];
    if (fila.every((c) => c.trim() === '')) {
      filasVacias++;
      continue;
    }

    const nombre = celda(fila[iNombre]);
    if (!nombre) {
      filasSinNombre++;
      continue;
    }

    registros.push({
      nombre,
      nombre_norm: normalizarNombre(nombre),
      rfc: indice.rfc !== undefined ? celda(fila[indice.rfc]) : null,
      curp: indice.curp !== undefined ? celda(fila[indice.curp]) : null,
      alias: indice.alias !== undefined ? celda(fila[indice.alias]) : null,
      programa: indice.programa !== undefined ? celda(fila[indice.programa]) : null,
      pais: indice.pais !== undefined ? celda(fila[indice.pais]) : null,
      observaciones:
        indice.observaciones !== undefined ? celda(fila[indice.observaciones]) : null,
    });
  }

  if (filasSinNombre > 0) {
    avisos.push(`${filasSinNombre} fila(s) sin nombre: se descartaron.`);
  }

  return { registros, columnas, delimitador, filasSinNombre, filasVacias, avisos };
}

// ---------------------------------------------------------------------------
// Cotejo
// ---------------------------------------------------------------------------

export interface ClienteCotejable {
  codigo_cliente: string;
  nombre?: string | null;
  apellido_paterno?: string | null;
  apellido_materno?: string | null;
  rfc?: string | null;
  curp?: string | null;
}

/** Un registro ya escrito en `listas_registros`, con su UUID real. */
export interface RegistroCotejable {
  id: string;
  nombre: string;
  nombre_norm?: string | null;
  rfc?: string | null;
  curp?: string | null;
}

/** Listo para insertar en `listas_coincidencias`, sin `lista_id`. */
export interface CoincidenciaDetectada {
  codigo_cliente: string;
  registro_id: string;
  tipo_match: TipoMatch;
  /** El valor del expediente, en crudo: es la evidencia de qué se comparó. */
  valor_cliente: string;
  /** El valor de la lista, en crudo, por la misma razón. */
  valor_lista: string;
}

/** Índice de clientes por llave normalizada. Arreglo: dos pueden compartirla. */
type Indice = Map<string, Array<{ cliente: ClienteCotejable; crudo: string }>>;

function agregar(indice: Indice, clave: string, cliente: ClienteCotejable, crudo: string) {
  // La llave vacía no es una llave. Sin esta guarda, un cliente sin CURP
  // coincidiría con todo registro sin CURP: cientos de falsos positivos, todos
  // con la misma pinta de coincidencia legítima.
  if (!clave) return;
  const previo = indice.get(clave);
  if (previo) previo.push({ cliente, crudo });
  else indice.set(clave, [{ cliente, crudo }]);
}

/**
 * Coteja los registros de una lista contra la cartera.
 *
 * Se indexa el lado chico —la cartera— y se recorre el grande: los clientes son
 * decenas y una lista puede traer decenas de miles. Un barrido, sin consultas
 * por registro.
 *
 * Un mismo par cliente/registro puede producir hasta tres coincidencias, una
 * por vía. Es deliberado: coincidir por RFC Y por nombre es una señal más
 * fuerte que coincidir solo por nombre, y colapsarlas escondería esa diferencia
 * justo de quien tiene que decidir.
 *
 * HUECO CONOCIDO · el cotejo por nombre es exacto sobre la cadena normalizada
 * completa. OFAC publica «APELLIDO, NOMBRE» y el expediente guarda «NOMBRE
 * APELLIDO»: contra esa lista, la vía del nombre no dispara. RFC y CURP no se
 * ven afectados, pero OFAC rara vez los trae. Cerrarlo es una decisión de
 * metodología —permutar tokens es dejar de ser exacto— y no se toma aquí.
 */
export function buscarCoincidencias(
  clientes: ClienteCotejable[],
  registros: RegistroCotejable[]
): CoincidenciaDetectada[] {
  const porRfc: Indice = new Map();
  const porCurp: Indice = new Map();
  const porNombre: Indice = new Map();

  for (const cliente of clientes) {
    const nombre = nombreCompletoCliente(cliente);
    agregar(porRfc, normalizarClave(cliente.rfc), cliente, cliente.rfc ?? '');
    agregar(porCurp, normalizarClave(cliente.curp), cliente, cliente.curp ?? '');
    agregar(porNombre, normalizarNombre(nombre), cliente, nombre);
  }

  const coincidencias: CoincidenciaDetectada[] = [];

  const cotejar = (
    indice: Indice,
    clave: string,
    tipo: TipoMatch,
    registro: RegistroCotejable,
    valorLista: string
  ) => {
    if (!clave) return;
    const encontrados = indice.get(clave);
    if (!encontrados) return;
    for (const { cliente, crudo } of encontrados) {
      coincidencias.push({
        codigo_cliente: cliente.codigo_cliente,
        registro_id: registro.id,
        tipo_match: tipo,
        valor_cliente: crudo,
        valor_lista: valorLista,
      });
    }
  };

  for (const registro of registros) {
    cotejar(porRfc, normalizarClave(registro.rfc), 'rfc_exacto', registro, registro.rfc ?? '');
    cotejar(porCurp, normalizarClave(registro.curp), 'curp_exacto', registro, registro.curp ?? '');
    // Se prefiere el `nombre_norm` que quedó guardado: es lo que la lista dice,
    // no lo que este proceso recalcularía.
    const norm = registro.nombre_norm ?? normalizarNombre(registro.nombre);
    cotejar(porNombre, norm, 'nombre_exacto', registro, registro.nombre);
  }

  return coincidencias;
}
