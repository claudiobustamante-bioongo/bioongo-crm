/**
 * [expediente] Documentos del expediente · validación, ruta y errores.
 * ---------------------------------------------------------------------------
 * Lógica pura: no toca Supabase ni la red. La usan POST /api/documentos y la
 * sección «Documentos» de la ficha.
 *
 * Espeja las reglas de la base (migraciones/2026-10-14-documentos-expediente.sql):
 * los tipos son el CHECK documentos_tipo_valido, el tope es documentos_tamano y
 * la ruta es documentos_ruta_forma. Los tests atan las tres a la migración.
 * Validar aquí devuelve un 400 claro sin subir nada; la base sigue siendo la
 * guarda que no se puede saltar.
 *
 * QUIÉN SUBE NO SE RECIBE: lo toma la base del JWT (fn_firmante_sesion).
 *
 * Este módulo lo importa también la ficha (componente de cliente): no puede
 * depender de node:crypto. El sha256 y la ruta final se arman en
 * lib/documentos-servidor.ts.
 */

/** Espeja el CHECK documentos_tipo_valido. */
export const TIPOS_DOCUMENTO = [
  'carta_clasificacion',
  'identificacion',
  'comprobante_domicilio',
  'constancia_fiscal',
  'contrato',
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const NOMBRE_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  carta_clasificacion: 'Carta de clasificación',
  identificacion: 'Identificación',
  comprobante_domicilio: 'Comprobante de domicilio',
  constancia_fiscal: 'Constancia de situación fiscal',
  contrato: 'Contrato',
};

/** Espeja el CHECK documentos_tamano y el file_size_limit del bucket. */
export const TAMANO_MAXIMO_BYTES = 4194304;

const REGLA_CODIGO = /^CSP[FM]U\d{4}$/;
const REGLA_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const REGLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esTipoDocumento(valor: unknown): valor is TipoDocumento {
  return typeof valor === 'string' && (TIPOS_DOCUMENTO as readonly string[]).includes(valor);
}

export function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && REGLA_UUID.test(valor);
}

/** Un PDF empieza con `%PDF-`. El MIME lo declara el navegador; esto no. */
export function esPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}

/**
 * La llave del objeto en el bucket: solo datos del sistema, nunca el nombre
 * original del archivo ni el de una persona. Espeja documentos_ruta_forma.
 */
export function rutaStorage(
  tipo: TipoDocumento,
  codigo: string,
  fecha: string | null,
  sha256: string,
): string {
  return `${tipo}/${codigo}/${fecha ?? 'sin-fecha'}_${sha256.slice(0, 12)}.pdf`;
}

type FechaValida = { ok: true; fecha: string | null };
type Invalido = { ok: false; error: string };

/**
 * Fecha del documento. Vacía = no consta (null), salvo en la carta, que exige
 * su fecha de firma. Debe ser una fecha real y no futura en CDMX.
 */
export function validarFechaDocumento(
  valor: unknown,
  tipo: TipoDocumento,
  hoy: string,
): FechaValida | Invalido {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) {
    return tipo === 'carta_clasificacion'
      ? { ok: false, error: 'La carta de clasificación exige su fecha de firma.' }
      : { ok: true, fecha: null };
  }
  const m = texto.match(REGLA_FECHA);
  if (!m) return { ok: false, error: 'La fecha debe tener la forma AAAA-MM-DD.' };
  const [, a, mes, d] = m;
  const f = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  if (
    f.getUTCFullYear() !== Number(a) ||
    f.getUTCMonth() !== Number(mes) - 1 ||
    f.getUTCDate() !== Number(d)
  ) {
    return { ok: false, error: 'La fecha no existe en el calendario.' };
  }
  if (texto > hoy) return { ok: false, error: 'La fecha del documento no puede ser futura.' };
  return { ok: true, fecha: texto };
}

export interface DocumentoValidado {
  codigo: string;
  tipo: TipoDocumento;
  fecha: string | null;
  reemplazaA: string | null;
  tamano: number;
}

export interface EntradaDocumento {
  codigo: unknown;
  tipo: unknown;
  fecha: unknown;
  reemplazaA: unknown;
  bytes: Uint8Array;
  hoy: string;
}

/** Todo lo que se puede decidir sin la base. El 413 de tamaño lo da la ruta. */
export function validarDocumento(e: EntradaDocumento): { ok: true; doc: DocumentoValidado } | Invalido {
  const codigo = typeof e.codigo === 'string' ? e.codigo.trim().toUpperCase() : '';
  if (!REGLA_CODIGO.test(codigo)) return { ok: false, error: 'Código de cliente con forma inválida.' };
  if (!esTipoDocumento(e.tipo)) return { ok: false, error: 'Tipo de documento no válido.' };
  const reemplazaTexto = typeof e.reemplazaA === 'string' ? e.reemplazaA.trim() : '';
  if (reemplazaTexto && !esUuid(reemplazaTexto)) {
    return { ok: false, error: 'El documento a reemplazar no tiene un identificador válido.' };
  }
  if (e.bytes.length === 0) return { ok: false, error: 'El archivo está vacío.' };
  if (e.bytes.length > TAMANO_MAXIMO_BYTES) return { ok: false, error: 'El PDF excede 4 MB.' };
  if (!esPdf(e.bytes)) return { ok: false, error: 'El archivo no es un PDF.' };
  const fecha = validarFechaDocumento(e.fecha, e.tipo, e.hoy);
  if (!fecha.ok) return fecha;

  return {
    ok: true,
    doc: {
      codigo,
      tipo: e.tipo,
      fecha: fecha.fecha,
      reemplazaA: reemplazaTexto || null,
      tamano: e.bytes.length,
    },
  };
}

/** Errores propios de fn_registrar_documento y fn_registrar_consulta_documento. */
const ESTATUS_ERROR_DOCUMENTO: Record<string, number> = {
  DX400: 400,
  DX401: 401,
  DX404: 404,
  DX409: 409,
};

export function estatusErrorDocumento(codigo: unknown): number | null {
  return typeof codigo === 'string' && codigo in ESTATUS_ERROR_DOCUMENTO
    ? ESTATUS_ERROR_DOCUMENTO[codigo]
    : null;
}

/** Segundos de vida del enlace firmado que emite GET /api/documentos/[id]. */
export const SEGUNDOS_ENLACE = 60;

/** La liga interna que la base guarda en carta_sofisticado_url. */
export function ligaDocumento(id: string): string {
  return `/api/documentos/${id}`;
}
