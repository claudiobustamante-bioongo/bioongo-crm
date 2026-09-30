import { createClient } from '@/lib/supabase-server';
import { registrarEvento } from '@/lib/bitacora';
import { hoyCDMX, validarBaja } from '@/lib/baja';
import { STATUS_BAJA } from '@/lib/cartera';

/**
 * POST /api/dar-baja
 *
 * Da de baja a un cliente: `status = 'baja'` con `fecha_baja` y `motivo_baja`,
 * los dos obligatorios. NO borra nada; el expediente se conserva por PLD.
 *
 * Deja dos rastros en bitácora: el del trigger (un asiento por campo cambiado,
 * con `origen = 'trigger'`) y uno de aplicación con la acción `baja` y el
 * motivo, la misma acción que usó la migración del 30-sep-2026 para las dos
 * primeras bajas. Por la regla de `registrarEvento`, si ese segundo asiento
 * falla la baja no se revierte: la respuesta lo dice con `bitacora: false`.
 *
 * Desde la aplicación no hay vuelta atrás: una baja se revierte a mano, con su
 * propio motivo, en el SQL Editor.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */
export async function POST(request: Request) {
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: 'El cuerpo de la petición no es JSON válido.' }, { status: 400 });
  }

  const codigoCliente = cuerpo?.codigo_cliente;
  if (typeof codigoCliente !== 'string' || !codigoCliente.trim()) {
    return Response.json({ error: 'Falta codigo_cliente.' }, { status: 400 });
  }

  const baja = validarBaja(cuerpo, hoyCDMX());
  if (!baja.ok) {
    return Response.json({ error: baja.error }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }
  const usuario = user.email ?? user.id;

  // --- Estado actual ----------------------------------------------------------

  const { data: cliente, error: errorLectura } = await supabase
    .from('clientes')
    .select('codigo_cliente, status')
    .eq('codigo_cliente', codigoCliente)
    .maybeSingle();

  if (errorLectura) {
    console.error('dar-baja: fallo al leer clientes.');
    return Response.json({ error: 'Error al leer el cliente.' }, { status: 500 });
  }
  if (!cliente) {
    return Response.json({ error: 'El cliente no existe.' }, { status: 404 });
  }
  if (cliente.status === STATUS_BAJA) {
    return Response.json({ error: 'El cliente ya está dado de baja.' }, { status: 409 });
  }

  // --- Escritura --------------------------------------------------------------

  // El `neq` cierra la carrera: si otra sesión lo dio de baja entre la lectura
  // y aquí, el UPDATE no toca nada y se responde 409, no se pisa su motivo.
  const { data: guardado, error: errorGuardado } = await supabase
    .from('clientes')
    .update({ status: STATUS_BAJA, fecha_baja: baja.fecha_baja, motivo_baja: baja.motivo_baja })
    .eq('codigo_cliente', codigoCliente)
    .neq('status', STATUS_BAJA)
    .select('codigo_cliente, status, fecha_baja, motivo_baja')
    .maybeSingle();

  if (errorGuardado) {
    console.error('dar-baja: fallo al guardar la baja.');
    return Response.json({ error: 'No se pudo registrar la baja.' }, { status: 500 });
  }
  if (!guardado) {
    return Response.json({ error: 'El cliente ya está dado de baja.' }, { status: 409 });
  }

  const bitacora = await registrarEvento(supabase, {
    entidad: 'clientes',
    entidadId: codigoCliente,
    accion: 'baja',
    campo: 'status',
    valorAnterior: cliente.status ?? null,
    valorNuevo: STATUS_BAJA,
    motivo: baja.motivo_baja,
    usuario,
    metadata: { fecha_baja: baja.fecha_baja },
  });

  return Response.json({ ok: true, cliente: guardado, bitacora });
}
