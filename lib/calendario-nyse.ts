/**
 * [calendario] Feriados de la Bolsa de Nueva York (NYSE) y el td de la foto
 * diaria automática (M2 fase 2). Puro, sin dependencias de Node.
 * ---------------------------------------------------------------------------
 * - td = el último día de lunes a viernes ANTES de hoy (CDMX): el lunes carga el
 *   viernes. Un feriado mexicano no cambia nada (IBKR opera con el mercado de
 *   EE. UU.; el FIX de ese día toma el hábil anterior, con nota).
 * - Si el td es feriado de NYSE, la foto de ese td queda «omitida»: no se pide
 *   nada a IBKR (decisión de Claudio, 18-nov-2026).
 * - Lista ESTÁTICA, con las reglas de NYSE (Rule 7.2) comprobadas por el test:
 *   sábado → viernes anterior (salvo Año Nuevo, que no se recorre a diciembre),
 *   domingo → lunes. Un cierre extraordinario (luto nacional, etc.) se agrega a
 *   EXTRAORDINARIOS con su fuente.
 * - CUBIERTO_HASTA: después de esa fecha la función registra un error en vez de
 *   suponer: el calendario se actualiza cada año, antes de diciembre.
 */

export const CUBIERTO_HASTA = '2027-12-31';

export const FERIADOS_NYSE: Readonly<Record<string, string>> = {
  '2026-01-01': 'Año Nuevo',
  '2026-01-19': 'Martin Luther King Jr.',
  '2026-02-16': 'Día de los Presidentes',
  '2026-04-03': 'Viernes Santo',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independencia (observado)',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Acción de Gracias',
  '2026-12-25': 'Navidad',
  '2027-01-01': 'Año Nuevo',
  '2027-01-18': 'Martin Luther King Jr.',
  '2027-02-15': 'Día de los Presidentes',
  '2027-03-26': 'Viernes Santo',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth (observado)',
  '2027-07-05': 'Independencia (observado)',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Acción de Gracias',
  '2027-12-24': 'Navidad (observado)',
};

/** Cierres fuera de las reglas, con su fuente. Hoy, ninguno en el rango cubierto. */
export const EXTRAORDINARIOS: Readonly<Record<string, string>> = {};

const REGLA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function utc(iso: string): Date {
  if (!REGLA_ISO.test(iso)) throw new Error(`Fecha con forma inválida: ${iso}`);
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}
const iso = (f: Date) => f.toISOString().slice(0, 10);

/** Fecha de hoy en CDMX (AAAA-MM-DD). CDMX es UTC−6 todo el año desde 2022. */
export function fechaCdmx(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(ahora);
}

/** El último día de lunes a viernes antes de `hoy` (AAAA-MM-DD). */
export function tdFotoDiaria(hoy: string): string {
  const f = utc(hoy);
  do f.setUTCDate(f.getUTCDate() - 1); while (f.getUTCDay() === 0 || f.getUTCDay() === 6);
  return iso(f);
}

export function cubierto(fecha: string): boolean {
  utc(fecha);
  return fecha <= CUBIERTO_HASTA;
}

/** Nombre del feriado o cierre de NYSE en esa fecha, o null si opera. */
export function feriadoNyse(fecha: string): string | null {
  utc(fecha);
  return FERIADOS_NYSE[fecha] ?? EXTRAORDINARIOS[fecha] ?? null;
}
