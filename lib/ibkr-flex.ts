/**
 * [ibkr-flex] Conector con el Flex Web Service de IBKR, para la app y los scripts.
 * ---------------------------------------------------------------------------
 * Especificación: docs/ESPEC_IBKR_Flex.md §1. Todo el pedido y la lectura viven
 * en lib/ibkr-flex-lectura.ts (sin dependencias de Node: también lo usa la Edge
 * Function ibkr-foto-diaria en Deno). Este módulo solo añade lo de Node:
 *
 * - `import 'server-only'`: el token da lectura de TODAS las cuentas de clientes.
 *   Las credenciales se leen al llamar (credencialesFlex), nunca al importar, y
 *   ningún mensaje de error las incluye.
 * - parsearFlex(xml, td): leerFlex con el sha256 de node:crypto (síncrono), la
 *   firma de siempre para la vista previa y cargar-foto.
 */

import 'server-only';
import { createHash } from 'node:crypto';
import { leerFlex, validarCredencialesFlex, type ReporteFlex } from './ibkr-flex-lectura';

export * from './ibkr-flex-lectura';

export function credencialesFlex(env: Record<string, string | undefined> = process.env): {
  token: string;
  queryId: string;
} {
  return validarCredencialesFlex(env.IBKR_FLEX_TOKEN, env.IBKR_FLEX_QUERY_ID);
}

/** Lee el FlexQueryResponse. `tdPedido` en AAAAMMDD. Una cuenta con un dato inválido se descarta entera. */
export function parsearFlex(xml: string, tdPedido: string): ReporteFlex {
  return leerFlex(xml, tdPedido, createHash('sha256').update(xml, 'utf8').digest('hex'));
}
