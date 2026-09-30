/**
 * [expediente] Validación de la baja de un cliente.
 *
 * La baja no borra nada: marca `clientes.status = 'baja'` con `fecha_baja` y
 * `motivo_baja`, que el CHECK `clientes_baja_completa` exige juntos. El
 * expediente se conserva por obligación PLD.
 *
 * `fecha_baja` es la fecha en que se REGISTRA la baja en el expediente, no
 * necesariamente la del cierre de la cuenta (así lo dice el COMMENT de la
 * columna). Por eso no puede ser futura. Si el cierre tiene otra fecha, o no
 * tiene fecha documentada, eso se declara en el motivo.
 *
 * Pura, para poder probarla sin base de datos ni red.
 */

export type BajaValida = { ok: true; fecha_baja: string; motivo_baja: string };
export type BajaInvalida = { ok: false; error: string };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Hoy en la Ciudad de México, como AAAA-MM-DD. */
export function hoyCDMX(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

export function validarBaja(
  entrada: { fecha_baja?: unknown; motivo_baja?: unknown },
  hoy: string,
): BajaValida | BajaInvalida {
  const fecha = typeof entrada.fecha_baja === 'string' ? entrada.fecha_baja.trim() : '';
  const motivo = typeof entrada.motivo_baja === 'string' ? entrada.motivo_baja.trim() : '';

  if (!fecha) return { ok: false, error: 'La fecha de baja es obligatoria.' };
  if (!motivo) return { ok: false, error: 'El motivo de baja es obligatorio.' };

  // AAAA-MM-DD y además una fecha real: 2026-02-30 tiene la forma y no existe.
  const d = new Date(`${fecha}T00:00:00Z`);
  if (!FECHA.test(fecha) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fecha) {
    return { ok: false, error: 'La fecha de baja debe ser una fecha válida AAAA-MM-DD.' };
  }
  if (fecha > hoy) {
    return {
      ok: false,
      error:
        'La fecha de baja no puede ser futura: es la fecha en que se registra la baja en el expediente.',
    };
  }

  return { ok: true, fecha_baja: fecha, motivo_baja: motivo };
}
