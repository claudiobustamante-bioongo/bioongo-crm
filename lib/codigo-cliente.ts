/**
 * [expediente] Formato y choques de un `codigo_cliente` NUEVO.
 * ---------------------------------------------------------------------------
 * Regla de Claudio, 6-oct-2026 (documentada en migraciones/README.md):
 *
 *   CSPF + U + <2 primeros dígitos de la cuenta IBKR> + <2 últimos del año de nacimiento>
 *
 * Aquí se valida la FORMA (CSPFU + 4 dígitos), no que los dígitos salgan de la
 * cuenta y de la fecha: /nuevo-cliente no pide ninguna de las dos. Siempre
 * CSPF: los CSPM existentes no se renombran, pero no se asignan nuevos.
 *
 * El código se normaliza (sin espacios, en mayúsculas) antes de validar y de
 * buscar choques. Los choques se buscan sin distinguir mayúsculas: en el R03
 * 202606 salió un «CSPfU1270» por error de captura, y para la CNBV eso es otro
 * ID.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const REGLA_CODIGO_NUEVO = /^CSPFU\d{4}$/;

export type CodigoValido = { ok: true; codigo: string };
export type CodigoInvalido = { ok: false; error: string };

export function normalizarCodigo(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim().toUpperCase() : '';
}

export function validarCodigoNuevo(valor: unknown): CodigoValido | CodigoInvalido {
  const codigo = normalizarCodigo(valor);
  if (!codigo) return { ok: false, error: 'El código de cliente es obligatorio.' };
  if (codigo.startsWith('CSPM')) {
    return {
      ok: false,
      error:
        'Los códigos nuevos son siempre CSPF. Los CSPM existentes se conservan porque ya ' +
        'están reportados a la CNBV, pero no se asignan nuevos.',
    };
  }
  if (!REGLA_CODIGO_NUEVO.test(codigo)) {
    return {
      ok: false,
      error:
        'El código debe ser CSPFU seguido de 4 dígitos: los 2 primeros de la cuenta IBKR y ' +
        'los 2 últimos del año de nacimiento (p. ej. CSPFU2985).',
    };
  }
  return { ok: true, codigo };
}

export interface ResultadoChoques {
  /** Dónde ya existe: 'clientes' y/o 'codigos_alias'. Vacío si no choca. */
  choques: string[];
  /** La consulta falló: no se sabe si choca, y no se debe guardar. */
  error: boolean;
}

/**
 * Busca el código en clientes y en codigos_alias (anterior y actual), sin
 * distinguir mayúsculas. Recibe un código YA validado: solo letras y dígitos,
 * así que `ilike` sin comodines equivale a una igualdad insensible a caja.
 */
export async function buscarChoques(supabase: SupabaseClient, codigo: string): Promise<ResultadoChoques> {
  const [enClientes, enAlias] = await Promise.all([
    supabase.from('clientes').select('codigo_cliente').ilike('codigo_cliente', codigo).limit(1),
    supabase
      .from('codigos_alias')
      .select('codigo_anterior, codigo_actual')
      .or(`codigo_anterior.ilike.${codigo},codigo_actual.ilike.${codigo}`)
      .limit(1),
  ]);

  if (enClientes.error || enAlias.error) return { choques: [], error: true };

  const choques: string[] = [];
  if ((enClientes.data ?? []).length > 0) choques.push('clientes');
  if ((enAlias.data ?? []).length > 0) choques.push('codigos_alias');
  return { choques, error: false };
}
