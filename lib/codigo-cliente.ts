/**
 * [expediente] Formato, coherencia y choques de un `codigo_cliente` NUEVO.
 * ---------------------------------------------------------------------------
 * Regla de Claudio, 6-oct-2026 (documentada en migraciones/README.md):
 *
 *   CSPF + U + <2 primeros dígitos de la cuenta IBKR> + <2 últimos del año de nacimiento>
 *
 * Desde el 7-oct-2026 /nuevo-cliente pide la cuenta IBKR (obligatoria: sin
 * cuenta no hay código definitivo; los prospectos sin cuenta entran por
 * /captura con LEAD-) y la fecha de nacimiento (opcional). Se valida la FORMA
 * (CSPFU + 4 dígitos) y que los dígitos salgan de ellas: los 2 primeros, de la
 * cuenta siempre; los 2 últimos, del año solo si hay fecha. Siempre CSPF: los
 * CSPM existentes no se renombran, pero no se asignan nuevos.
 *
 * Código y cuenta se normalizan (sin espacios, en mayúsculas) antes de validar
 * y de buscar choques. Los choques se buscan sin distinguir mayúsculas: en el
 * R03 202606 salió un «CSPfU1270» por error de captura, y para la CNBV eso es
 * otro ID.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const REGLA_CODIGO_NUEVO = /^CSPFU\d{4}$/;
export const REGLA_CUENTA_IBKR = /^U\d+$/;
const REGLA_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

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

export function validarCuentaIbkr(valor: unknown): { ok: true; cuenta: string } | CodigoInvalido {
  const cuenta = normalizarCodigo(valor);
  if (!cuenta) {
    return {
      ok: false,
      error: 'La cuenta IBKR es obligatoria. Un prospecto sin cuenta se captura en /captura con LEAD-.',
    };
  }
  if (!REGLA_CUENTA_IBKR.test(cuenta)) {
    return { ok: false, error: `La cuenta IBKR debe ser U seguida de dígitos; se recibió «${cuenta}».` };
  }
  return { ok: true, cuenta };
}

/** Vacío es «sin fecha» (null), no un error: la fecha es opcional en el alta. */
export function validarFechaNacimiento(valor: unknown): { ok: true; fecha: string | null } | CodigoInvalido {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) return { ok: true, fecha: null };
  const m = REGLA_FECHA.exec(texto);
  if (m) {
    const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const d = new Date(Date.UTC(anio, mes - 1, dia));
    if (d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia) {
      return { ok: true, fecha: texto };
    }
  }
  return { ok: false, error: `La fecha de nacimiento debe ser una fecha real en AAAA-MM-DD; se recibió «${texto}».` };
}

export type AltaValida = { ok: true; codigo: string; cuenta: string; fecha: string | null };

/**
 * Forma de los tres datos y coherencia del código con la cuenta y, si la hay,
 * con la fecha. Si algo no coincide no se guarda: el error dice qué esperaba y
 * qué recibió.
 */
export function validarAltaCliente(datos: { codigo: unknown; cuenta: unknown; fecha: unknown }): AltaValida | CodigoInvalido {
  const c = validarCodigoNuevo(datos.codigo);
  if (!c.ok) return c;
  const cu = validarCuentaIbkr(datos.cuenta);
  if (!cu.ok) return cu;
  const f = validarFechaNacimiento(datos.fecha);
  if (!f.ok) return f;

  const deCuenta = c.codigo.slice(5, 7);
  const cuentaInicio = cu.cuenta.slice(1, 3);
  if (deCuenta !== cuentaInicio) {
    return {
      ok: false,
      error:
        `El código no coincide con la cuenta: el código dice ${deCuenta} y la cuenta ${cu.cuenta} ` +
        `empieza con ${cuentaInicio}. No se guardó nada.`,
    };
  }
  if (f.fecha) {
    const deAnio = c.codigo.slice(7, 9);
    const anioFin = f.fecha.slice(2, 4);
    if (deAnio !== anioFin) {
      return {
        ok: false,
        error:
          `El código no coincide con la fecha de nacimiento: el código dice ${deAnio} y el año ` +
          `${f.fecha.slice(0, 4)} termina en ${anioFin}. No se guardó nada.`,
      };
    }
  }
  return { ok: true, codigo: c.codigo, cuenta: cu.cuenta, fecha: f.fecha };
}

export interface ResultadoChoques {
  /** Dónde ya existe: 'clientes', 'codigos_alias' y/o 'cuenta_ibkr'. Vacío si no choca. */
  choques: string[];
  /** La consulta falló: no se sabe si choca, y no se debe guardar. */
  error: boolean;
}

/**
 * Busca el código en clientes y en codigos_alias (anterior y actual) y, si se
 * da, la cuenta en clientes.cuenta_ibkr (UNIQUE en la base), sin distinguir
 * mayúsculas. Recibe valores YA validados: solo letras y dígitos, así que
 * `ilike` sin comodines equivale a una igualdad insensible a caja.
 */
export async function buscarChoques(
  supabase: SupabaseClient,
  codigo: string,
  cuenta?: string,
): Promise<ResultadoChoques> {
  const [enClientes, enAlias, enCuenta] = await Promise.all([
    supabase.from('clientes').select('codigo_cliente').ilike('codigo_cliente', codigo).limit(1),
    supabase
      .from('codigos_alias')
      .select('codigo_anterior, codigo_actual')
      .or(`codigo_anterior.ilike.${codigo},codigo_actual.ilike.${codigo}`)
      .limit(1),
    cuenta
      ? supabase.from('clientes').select('codigo_cliente').ilike('cuenta_ibkr', cuenta).limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (enClientes.error || enAlias.error || enCuenta.error) return { choques: [], error: true };

  const choques: string[] = [];
  if ((enClientes.data ?? []).length > 0) choques.push('clientes');
  if ((enAlias.data ?? []).length > 0) choques.push('codigos_alias');
  if ((enCuenta.data ?? []).length > 0) choques.push('cuenta_ibkr');
  return { choques, error: false };
}
