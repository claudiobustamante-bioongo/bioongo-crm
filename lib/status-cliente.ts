/**
 * [expediente] Los valores de `clientes.status` y quién puede escribir cada uno.
 *
 * ESPEJO DEL CHECK `clientes_status_valido` (migración 2026-09-30). Si el CHECK
 * cambia, esta lista cambia en el mismo commit; un valor que esté aquí y no en
 * el CHECK da error al guardar, y uno que esté en el CHECK y no aquí no se
 * puede elegir.
 *
 * 'baja' NO es editable desde /editar. Exige `fecha_baja` y `motivo_baja`
 * (CHECK `clientes_baja_completa`) y deja asiento en bitácora, así que tiene su
 * propio flujo. Por la misma razón, /editar no puede sacar a un cliente de la
 * baja: con status 'baja' el campo se muestra y no se envía.
 */

import { STATUS_BAJA } from '@/lib/cartera';

export const STATUS_CLIENTE = ['lead_nuevo', 'vigente', 'inactivo', STATUS_BAJA] as const;
export type StatusCliente = (typeof STATUS_CLIENTE)[number];

/** Los que /editar ofrece en su selector: todos menos 'baja'. */
export const STATUS_EDITABLES = STATUS_CLIENTE.filter(
  (s): s is Exclude<StatusCliente, typeof STATUS_BAJA> => s !== STATUS_BAJA,
);

export const esBaja = (status: string | null | undefined) => status === STATUS_BAJA;

/**
 * El payload del UPDATE de /editar: vacío → null, y sin `status` si el cliente
 * está de baja (esa marca solo la mueve su propio flujo).
 */
export function datosParaGuardar(
  form: Record<string, string>,
  statusActual: string | null,
): Record<string, string | null> {
  const datos: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(form)) {
    if (k === 'status' && esBaja(statusActual)) continue;
    datos[k] = v === '' ? null : v;
  }
  return datos;
}
