import { createClient } from '@/lib/supabase-server';
import { registrarEvento } from '@/lib/bitacora';
import { hoyCDMX } from '@/lib/baja';
import { validarDeterminacion } from '@/lib/clasificacion';

/**
 * POST /api/determinar-clasificacion
 *
 * Recibe { codigo_cliente, clasificacion, nota } y registra la clasificación
 * del inversionista (R03 J-0315, campo 6) como determinación del asesor:
 * `clasificacion_fuente = 'determinacion_asesor'`, fecha de registro de hoy en
 * CDMX, nota obligatoria, y asiento en bitácora con el usuario de la sesión.
 *
 * SOLO 201, 202 O 204. 203 (Sofisticado) no se determina: solo viene de la
 * carta del Anexo 1 Apartado A, y la base lo impide por CHECK
 * (clientes_clasificacion_203_solo_por_carta).
 *
 * UNA CLASIFICACIÓN POR CARTA NO SE SOBRESCRIBE. Si el cliente ya es 203 por
 * carta firmada, responde 409: la carta es constitutiva y una determinación del
 * asesor no la deshace. Cambiar eso exige primero que la carta deje de constar.
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

  const determinacion = validarDeterminacion(cuerpo);
  if (!determinacion.ok) {
    return Response.json({ error: determinacion.error }, { status: 400 });
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
    .select('codigo_cliente, clasificacion_inversionista, clasificacion_fuente')
    .eq('codigo_cliente', codigoCliente)
    .maybeSingle();

  if (errorLectura) {
    console.error('determinar-clasificacion: fallo al leer clientes.');
    return Response.json({ error: 'Error al leer el cliente.' }, { status: 500 });
  }
  if (!cliente) {
    return Response.json({ error: 'El cliente no existe.' }, { status: 404 });
  }
  if (cliente.clasificacion_fuente === 'carta_firmada') {
    return Response.json(
      {
        error:
          'El cliente es 203 por carta firmada. La carta es constitutiva: una determinación ' +
          'del asesor no la sustituye.',
      },
      { status: 409 }
    );
  }

  // --- Escritura --------------------------------------------------------------

  const fecha = hoyCDMX();

  // El `or` cierra la carrera: si entre la lectura y aquí alguien registró la
  // carta, el UPDATE no toca nada y se responde 409.
  const { data: guardado, error: errorGuardado } = await supabase
    .from('clientes')
    .update({
      clasificacion_inversionista: determinacion.clasificacion,
      clasificacion_fuente: 'determinacion_asesor',
      clasificacion_fecha: fecha,
      clasificacion_nota: determinacion.nota,
    })
    .eq('codigo_cliente', codigoCliente)
    .or('clasificacion_fuente.is.null,clasificacion_fuente.eq.determinacion_asesor')
    .select('codigo_cliente, clasificacion_inversionista, clasificacion_fuente, clasificacion_fecha, clasificacion_nota')
    .maybeSingle();

  if (errorGuardado) {
    // 23514 = la base rechazó por CHECK. Es una petición que no cumple las
    // reglas de la clasificación, no un fallo del sistema.
    if (errorGuardado.code === '23514') {
      return Response.json(
        { error: 'La base rechazó la clasificación por no cumplir sus reglas.' },
        { status: 400 }
      );
    }
    console.error('determinar-clasificacion: fallo al guardar.');
    return Response.json({ error: 'No se pudo guardar la clasificación.' }, { status: 500 });
  }
  if (!guardado) {
    return Response.json(
      { error: 'La clasificación cambió mientras la editabas. Vuelve a cargar la ficha.' },
      { status: 409 }
    );
  }

  // --- Bitácora ---------------------------------------------------------------

  const bitacora = await registrarEvento(supabase, {
    entidad: 'clientes',
    entidadId: codigoCliente,
    accion: 'determinacion_clasificacion',
    campo: 'clasificacion_inversionista',
    valorAnterior: cliente.clasificacion_inversionista ?? null,
    valorNuevo: determinacion.clasificacion,
    motivo: determinacion.nota,
    usuario,
    metadata: {
      fuente: 'determinacion_asesor',
      fecha_registro: fecha,
      fuente_anterior: cliente.clasificacion_fuente ?? null,
      campo_r03: 'R03 J-0315, campo 6',
    },
  });

  return Response.json({ ok: true, cliente: guardado, bitacora });
}
