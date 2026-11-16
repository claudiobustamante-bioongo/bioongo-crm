/**
 * [banxico] Tipo de cambio FIX (serie SF43718) de la API SIE de Banxico. Puro
 * salvo la llamada, que recibe fetch inyectado; lo usa scripts/banxico/fix.mjs.
 * ---------------------------------------------------------------------------
 * - El token (BANXICO_TOKEN) va solo en el encabezado Bmx-Token; ningún mensaje
 *   de error lo repite.
 * - Día sin FIX (inhábil o aún no publicado): se toma el último dato publicado
 *   ANTES de la fecha pedida, dentro de una ventana de 10 días, y se anota en
 *   `nota`. Nunca se supone un valor.
 * - El registro lo hace fn_registrar_tipo_cambio con la sesión de quien
 *   confirma: el SQL va por psql con los claims, ensayo (ROLLBACK) y real
 *   (COMMIT), y una clave de confirmación sobre el dato.
 */

import { createHash } from 'node:crypto';

export const SERIE_FIX = 'SF43718';
export const URL_SIE = 'https://www.banxico.org.mx/SieAPIRest/service/v1/series';
export const VENTANA_DIAS = 10;

export class ErrorBanxico extends Error {
  readonly codigo: string | null;
  constructor(codigo: string | null, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorBanxico';
    this.codigo = codigo;
  }
}

export interface DatoFix {
  /** AAAA-MM-DD */
  fecha: string;
  valor: number;
}

export interface RegistroFix {
  serie: string;
  fecha: string;
  valor: number;
  fecha_solicitada: string;
  fuente: string;
  nota: string | null;
}

const REGLA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function fechaReal(iso: string): boolean {
  if (!REGLA_ISO.test(iso)) return false;
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

export function restarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10);
}

/** Lee la respuesta JSON de SIE: { bmx: { series: [{ idSerie, datos: [{ fecha: 'dd/mm/aaaa', dato }] }] } }. */
export function leerRespuestaSie(json: unknown, serie = SERIE_FIX): DatoFix[] {
  const series = (json as { bmx?: { series?: unknown[] } })?.bmx?.series;
  if (!Array.isArray(series)) throw new ErrorBanxico(null, 'La respuesta de Banxico no trae series.');
  const s = series.find((x) => (x as { idSerie?: string })?.idSerie === serie) as { datos?: unknown[] } | undefined;
  if (!s) throw new ErrorBanxico(null, `La respuesta de Banxico no trae la serie ${serie}.`);
  const datos: DatoFix[] = [];
  for (const d of s.datos ?? []) {
    const { fecha, dato } = d as { fecha?: string; dato?: string };
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha ?? '');
    if (!m) throw new ErrorBanxico(null, `Fecha con forma inesperada en la respuesta: «${fecha}».`);
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    const valor = Number(String(dato ?? '').replace(/,/g, ''));
    if (dato === 'N/E' || dato === undefined || !Number.isFinite(valor)) continue; // sin dato ese día
    if (valor <= 0) throw new ErrorBanxico(null, `Valor no positivo el ${iso}.`);
    datos.push({ fecha: iso, valor });
  }
  return datos.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** El FIX de la fecha pedida o, si no hubo, el último publicado antes (con nota). */
export function elegirFix(datos: readonly DatoFix[], fechaSolicitada: string): DatoFix & { nota: string | null } {
  const previos = datos.filter((d) => d.fecha <= fechaSolicitada);
  const ultimo = previos[previos.length - 1];
  if (!ultimo) {
    throw new ErrorBanxico(null, `No hay FIX publicado entre ${restarDias(fechaSolicitada, VENTANA_DIAS)} y ${fechaSolicitada}.`);
  }
  const nota = ultimo.fecha === fechaSolicitada ? null
    : `Sin FIX el ${fechaSolicitada}; se toma el del ${ultimo.fecha} (último publicado antes de la fecha pedida).`;
  return { ...ultimo, nota };
}

export interface DepsBanxico {
  token: string;
  fetch?: typeof fetch;
}

/** Pide la serie entre dos fechas (AAAA-MM-DD). Sin el token en ningún mensaje. */
export async function pedirSerie(serie: string, desde: string, hasta: string, deps: DepsBanxico): Promise<DatoFix[]> {
  if (!fechaReal(desde) || !fechaReal(hasta) || desde > hasta) throw new ErrorBanxico(null, 'Rango de fechas inválido.');
  if (!/^SF\d+$/.test(serie)) throw new ErrorBanxico(null, 'Serie con forma inválida.');
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${URL_SIE}/${serie}/datos/${desde}/${hasta}`, {
      headers: { 'Bmx-Token': deps.token, Accept: 'application/json' },
    });
  } catch {
    throw new ErrorBanxico(null, 'No se pudo contactar la API SIE de Banxico.');
  }
  if (res.status === 401 || res.status === 403) throw new ErrorBanxico(String(res.status), 'Banxico rechazó el token (BANXICO_TOKEN).');
  if (!res.ok) throw new ErrorBanxico(String(res.status), `Banxico respondió HTTP ${res.status}.`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ErrorBanxico(null, 'La respuesta de Banxico no es JSON.');
  }
  return leerRespuestaSie(json, serie);
}

const REGLA_CORREO = /^[^@\s'"$\\]+@[^@\s'"$\\]+\.[a-z]+$/;

function literal(texto: string): string {
  if (texto.includes('$t$')) throw new ErrorBanxico(null, 'Texto con «$t$»: no se puede pasar como literal.');
  return `$t$${texto}$t$`;
}

/** Guion para `psql service=bioongo -X -q -A -t -f -`: registra con la sesión y termina en ROLLBACK o COMMIT. */
export function sqlRegistroFix(r: RegistroFix, modo: 'ensayo' | 'real', usuario: string): string {
  if (!REGLA_CORREO.test(usuario)) throw new ErrorBanxico(null, 'El usuario debe ser un correo.');
  if (!/^SF\d+$/.test(r.serie) || !fechaReal(r.fecha) || !fechaReal(r.fecha_solicitada)
      || !(Number.isFinite(r.valor) && r.valor > 0)) {
    throw new ErrorBanxico(null, 'Registro con forma inválida.');
  }
  const claims = JSON.stringify({ email: usuario, canal: 'psql' });
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    `select set_config('request.jwt.claims', '${claims}', true) is null as sin_claims \\gset`,
    `select json_build_object('modo', '${modo}', 'resultado', public.fn_registrar_tipo_cambio('${r.serie}', ` +
      `date '${r.fecha}', ${r.valor}, date '${r.fecha_solicitada}', ${literal(r.fuente)}, ` +
      `${r.nota === null ? 'null' : literal(r.nota)}))::text;`,
    modo === 'real' ? 'commit;' : 'rollback;',
    '',
  ].join('\n');
}

/** Clave de confirmación: el dato que se escribirá (serie, fecha, valor, fecha pedida). */
export function claveFix(r: Pick<RegistroFix, 'serie' | 'fecha' | 'valor' | 'fecha_solicitada'>): string {
  return createHash('md5').update(`${r.serie}|${r.fecha}|${r.valor}|${r.fecha_solicitada}`, 'utf8').digest('hex').slice(0, 10);
}
