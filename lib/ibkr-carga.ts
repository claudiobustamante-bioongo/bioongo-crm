/**
 * [ibkr-carga] Reglas de la carga de la foto diaria (M2, fase 1). Pura: sin red ni
 * base; la usa scripts/ibkr/cargar-foto.mjs y, más adelante, la carga automática.
 * ---------------------------------------------------------------------------
 * - Qué cuentas se cargan: las del CRM que NO están cerradas en IBKR
 *   (cuentas_ibkr.fecha_cierre) ni con su contrato de baja (clientes.status). Las
 *   excluidas cuentan en `ignoradas` y siguen saliendo en los descuadres.
 * - es_propia NO se copia a la foto: vive en cuentas_ibkr y el semáforo lo lee
 *   de ahí. Duplicarlo haría dos fuentes de verdad.
 * - Una respuesta de IBKR sin NAV en ninguna cuenta (pasa con la primera
 *   respuesta de algunos días) no se carga: se repite más tarde.
 * - El SQL para psql lleva la carga en un literal $carga$…$carga$: sin archivo en
 *   disco y sin interpolación de la shell ni de psql.
 * - La clave de confirmación es una huella de las POSICIONES (no del XML, cuyo
 *   whenGenerated cambia en cada descarga): confirmar con ella exige que lo que
 *   se escribe sea exactamente lo que se vio en la vista previa.
 */

import { createHash } from 'node:crypto';
import type { CargaFoto, CuentaCRM, ReporteFlex } from './ibkr-flex';

export interface CuentaReferencia {
  cuenta_ibkr: string;
  codigo_cliente: string;
  tipo: string;
  status: string | null;
  fecha_baja: string | null;
  fecha_cierre: string | null;
  es_propia: boolean;
}

export type CodigoErrorCarga = 'SIN_NAV' | 'SIN_CUENTAS' | 'USUARIO' | 'LITERAL' | 'CONFIRMACION';

export class ErrorCarga extends Error {
  readonly codigo: CodigoErrorCarga;
  constructor(codigo: CodigoErrorCarga, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCarga';
    this.codigo = codigo;
  }
}

/** Cuentas que entran a la foto: ni cerradas en IBKR ni con su contrato de baja. */
export function cuentasCargables(ref: readonly CuentaReferencia[]): CuentaCRM[] {
  return ref
    .filter((c) => !c.fecha_cierre && c.status !== 'baja')
    .map((c) => ({ cuenta_ibkr: c.cuenta_ibkr, codigo_cliente: c.codigo_cliente, fecha_baja: null }));
}

/** Si IBKR no trajo NAV en ninguna cuenta, no se carga nada: se repite más tarde. */
export function validarRespuesta(rep: ReporteFlex): void {
  // Ninguna cuenta leída y alguna sin NAV: es la respuesta incompleta de IBKR (el
  // 12-nov llegó así para las 33). Las demás causas se listan, pero la acción es repetir.
  const sinNav = rep.descartadas.filter((d) => d.motivo.startsWith('sin NAV'));
  if (rep.cuentas.length === 0 && sinNav.length > 0) {
    throw new ErrorCarga(
      'SIN_NAV',
      `IBKR respondió sin NAV (${sinNav.length} de ${rep.total_statements} cuentas) y ninguna se pudo leer: ` +
        'no se carga. Repetir en unos minutos.',
    );
  }
  if (rep.cuentas.length === 0) {
    throw new ErrorCarga('SIN_CUENTAS', 'Ninguna cuenta del XML se pudo leer: no hay nada que cargar.');
  }
}

const REGLA_CORREO = /^[^@\s'"$\\]+@[^@\s'"$\\]+\.[a-z]+$/;

/** La llamada a fn_cargar_ibkr con la carga en un literal $carga$. La usan psql y el test de contrato. */
export function sqlLlamada(carga: CargaFoto): string {
  const json = JSON.stringify(carga);
  if (json.includes('$carga$')) {
    throw new ErrorCarga('LITERAL', 'La carga contiene «$carga$»: no se puede pasar como literal.');
  }
  return `select public.fn_cargar_ibkr($carga$${json}$carga$::jsonb)::text`;
}

/**
 * El guion para `psql service=bioongo -X -q -A -t -f -`. En una transacción: fija
 * el firmante en los claims, carga, cuenta lo escrito, y termina en ROLLBACK
 * (ensayo) o COMMIT (real). Imprime una sola línea JSON.
 */
export function sqlCarga(carga: CargaFoto, modo: 'ensayo' | 'real', usuario: string): string {
  if (!REGLA_CORREO.test(usuario)) {
    throw new ErrorCarga('USUARIO', 'El usuario debe ser un correo (sin comillas ni símbolos raros).');
  }
  const claims = JSON.stringify({ email: usuario, canal: 'psql' });
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    `select set_config('request.jwt.claims', '${claims}', true) is null as sin_claims \\gset`,
    `${sqlLlamada(carga)} as r \\gset`,
    `select json_build_object('modo', '${modo}', 'resultado', :'r'::jsonb,`,
    `  'renglones_escritos', (select count(*) from public.posiciones_detalle where sync_id = (:'r'::jsonb ->> 'sync_id')::uuid))::text;`,
    modo === 'real' ? 'commit;' : 'rollback;',
    '',
  ].join('\n');
}

/**
 * Huella de confirmación: md5 de las posiciones (sin el sha del XML ni los
 * descuadres), en orden estable. Diez caracteres bastan para que el humano la
 * copie y no coincida por accidente.
 */
export function claveConfirmacion(carga: CargaFoto): string {
  const filas = carga.posiciones
    .map((p) => [p.cuenta_ibkr, p.tipo_renglon, p.ticker, p.conid ?? '', p.cantidad ?? '', p.valor_base, p.moneda_base].join('|'))
    .sort();
  return createHash('md5').update(`${carga.td}\n${filas.join('\n')}`, 'utf8').digest('hex').slice(0, 10);
}

export function exigirConfirmacion(carga: CargaFoto, clave: string): void {
  if (clave !== claveConfirmacion(carga)) {
    throw new ErrorCarga(
      'CONFIRMACION',
      'La clave no coincide con las posiciones de esta descarga: lo que se escribiría no es lo que viste. No se carga.',
    );
  }
}
