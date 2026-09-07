/**
 * Estado de la revisión anual de cartera y del expediente de cliente
 * sofisticado.
 *
 * Contexto que justifica el estado SIN_REGISTRO: las revisiones anuales sí se
 * han venido haciendo, pero sin bitácora formal. El CRM empieza a registrarlas
 * ahora, así que un `fecha_ultima_revision` en null significa "no hay registro
 * previo en el CRM", NO "el cliente lleva un año sin revisión". Marcar ese
 * histórico como vencido sería afirmar un incumplimiento que no ocurrió.
 *
 * Todas las cuentas se hacen en UTC a medianoche: las columnas `date` de
 * Postgres no tienen hora, y construirlas con el constructor local mueve el día
 * según la zona horaria del servidor.
 */

export type EstadoRevision = 'sin_registro' | 'vencida' | 'por_vencer' | 'vigente';

export type ColorSemaforo = 'gris' | 'rojo' | 'ambar' | 'verde';

/** Días de anticipación con los que una revisión se marca "por vencer". */
export const DIAS_AVISO = 60;

const MS_DIA = 86_400_000;

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export interface RevisionAnual {
  estado: EstadoRevision;
  /** Texto corto para el badge. */
  etiqueta: string;
  color: ColorSemaforo;
  /** Clases del badge (fondo + texto). */
  clases: string;
  /** Clase del punto del semáforo. */
  punto: string;
  /** Frase de una línea con la fecha y los días; null si no hay registro. */
  detalle: string | null;
  /** Aclaración fija del histórico sin bitácora; solo en SIN_REGISTRO. */
  nota: string | null;
  /** Días para cumplir el año desde la última revisión. Negativo = vencida. */
  diasRestantes: number | null;
  /** Última revisión + 1 año, ISO `YYYY-MM-DD`. */
  fechaLimite: string | null;
  /** Aniversario del año en curso o el siguiente, ISO `YYYY-MM-DD`. */
  proximaRevision: string | null;
}

/** Fila de `clientes` en lo que a esta evaluación le concierne. */
export interface DatosRevision {
  fecha_aniversario?: string | null;
  fecha_ultima_revision?: string | null;
}

// ---------------------------------------------------------------------------
// Utilidades de fecha (UTC)
// ---------------------------------------------------------------------------

/** Acepta `YYYY-MM-DD` o un timestamp ISO; se queda con el día. */
function aFechaUTC(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (!m) return null;
  const [, anio, mes, dia] = m;
  const fecha = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)));
  // Rechaza fechas imposibles: '2025-02-31' se desbordaría a marzo en silencio.
  if (fecha.getUTCMonth() !== Number(mes) - 1) return null;
  return fecha;
}

/**
 * "Hoy" según el calendario de quien mira la pantalla, llevado a medianoche UTC
 * para poder restarlo contra las fechas de la base sin corrimientos.
 */
function aDiaUTC(ahora: Date): Date {
  return new Date(Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()));
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
}

/** Suma años recortando el día al último del mes (29 de febrero -> 28). */
function sumarAnios(fecha: Date, anios: number): Date {
  const anio = fecha.getUTCFullYear() + anios;
  const mes = fecha.getUTCMonth();
  const dia = Math.min(fecha.getUTCDate(), diasDelMes(anio, mes));
  return new Date(Date.UTC(anio, mes, dia));
}

function aISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** `2026-03-14` -> `14 de marzo de 2026`. Devuelve null si no se puede leer. */
export function formatearFecha(valor: string | null | undefined): string | null {
  const fecha = aFechaUTC(valor);
  if (!fecha) return null;
  return `${fecha.getUTCDate()} de ${MESES[fecha.getUTCMonth()]} de ${fecha.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Evaluación
// ---------------------------------------------------------------------------

const ESTILOS: Record<ColorSemaforo, { clases: string; punto: string }> = {
  gris: { clases: 'bg-slate-100 text-slate-600', punto: 'bg-slate-400' },
  rojo: { clases: 'bg-red-100 text-red-700', punto: 'bg-red-500' },
  ambar: { clases: 'bg-amber-100 text-amber-700', punto: 'bg-amber-500' },
  verde: { clases: 'bg-green-100 text-green-700', punto: 'bg-green-500' },
};

/**
 * Próxima revisión estimada: el aniversario del año en curso si todavía no
 * pasa, o el del año siguiente. Es independiente del estado: sirve para agendar
 * incluso cuando no hay ninguna revisión registrada.
 */
export function proximaRevisionEstimada(
  fechaAniversario: string | null | undefined,
  ahora: Date = new Date(),
): string | null {
  const aniversario = aFechaUTC(fechaAniversario);
  if (!aniversario) return null;

  const hoy = aDiaUTC(ahora);
  const mes = aniversario.getUTCMonth();
  const anioEnCurso = hoy.getUTCFullYear();
  const dia = Math.min(aniversario.getUTCDate(), diasDelMes(anioEnCurso, mes));
  const enCurso = new Date(Date.UTC(anioEnCurso, mes, dia));

  return aISO(enCurso >= hoy ? enCurso : sumarAnios(enCurso, 1));
}

/**
 * Estado de la revisión anual de un cliente.
 *
 * El estado depende únicamente de `fecha_ultima_revision`; `fecha_aniversario`
 * solo alimenta la próxima revisión estimada.
 */
export function evaluarRevisionAnual(
  cliente: DatosRevision,
  ahora: Date = new Date(),
): RevisionAnual {
  const proximaRevision = proximaRevisionEstimada(cliente.fecha_aniversario, ahora);
  const ultima = aFechaUTC(cliente.fecha_ultima_revision);

  if (!ultima) {
    return {
      estado: 'sin_registro',
      etiqueta: 'Sin registro',
      color: 'gris',
      ...ESTILOS.gris,
      detalle: null,
      nota: 'Revisiones previas al CRM sin bitácora formal. El registro inicia con la próxima revisión.',
      diasRestantes: null,
      fechaLimite: null,
      proximaRevision,
    };
  }

  const hoy = aDiaUTC(ahora);
  const limite = sumarAnios(ultima, 1);
  const diasRestantes = Math.round((limite.getTime() - hoy.getTime()) / MS_DIA);
  const fechaLimite = aISO(limite);
  const limiteTexto = formatearFecha(fechaLimite);

  const base = { fechaLimite, diasRestantes, proximaRevision, nota: null };

  if (diasRestantes < 0) {
    const dias = Math.abs(diasRestantes);
    return {
      ...base,
      estado: 'vencida',
      etiqueta: 'Vencida',
      color: 'rojo',
      ...ESTILOS.rojo,
      detalle: `Venció el ${limiteTexto} (hace ${dias} día${dias === 1 ? '' : 's'}).`,
    };
  }

  if (diasRestantes <= DIAS_AVISO) {
    return {
      ...base,
      estado: 'por_vencer',
      etiqueta: 'Por vencer',
      color: 'ambar',
      ...ESTILOS.ambar,
      detalle:
        diasRestantes === 0
          ? `Vence hoy, ${limiteTexto}.`
          : `Vence el ${limiteTexto} (faltan ${diasRestantes} día${diasRestantes === 1 ? '' : 's'}).`,
    };
  }

  return {
    ...base,
    estado: 'vigente',
    etiqueta: 'Vigente',
    color: 'verde',
    ...ESTILOS.verde,
    detalle: `Vence el ${limiteTexto} (faltan ${diasRestantes} días).`,
  };
}
