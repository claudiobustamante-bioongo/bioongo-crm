/**
 * [ibkr-carga] Reglas de la foto diaria que no dependen de Node: qué cuentas se
 * cargan, cuáles cuentan como baja en los descuadres y cuándo una respuesta de
 * IBKR no se carga. Las comparten scripts/ibkr/cargar-foto.mjs (por
 * lib/ibkr-carga.ts) y la Edge Function ibkr-foto-diaria (Deno, M2 fase 2):
 * mismas reglas en la carga a mano y en la automática.
 */

import type { CuentaCRM, ReporteFlex } from './ibkr-flex-lectura.ts';

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

/**
 * Cuentas del CRM para los descuadres: una cuenta cerrada en IBKR
 * (cuentas_ibkr.fecha_cierre) o un contrato de baja cuentan como baja.
 */
export function crmParaDescuadres(ref: readonly CuentaReferencia[]): CuentaCRM[] {
  return ref.map((c) => ({
    cuenta_ibkr: c.cuenta_ibkr,
    codigo_cliente: c.codigo_cliente,
    fecha_baja: c.fecha_cierre ?? c.fecha_baja ?? (c.status === 'baja' ? 'sin fecha' : null),
  }));
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
