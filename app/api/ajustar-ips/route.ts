import { createClient } from '@/lib/supabase-server';
import { PERFILES, type PerfilRiesgo } from '@/lib/ips-catalogo';
import { registrarEvento } from '@/lib/bitacora';

/**
 * POST /api/ajustar-ips
 *
 * Guarda el ajuste manual del asesor sobre el perfil calculado por el motor.
 *
 * Coexistencia: `resultado_perfil` (el motor) y `bitacora_calculo` NUNCA se
 * tocan aquí. El ajuste vive en columnas aparte y quien consuma el perfil debe
 * resolver con `coalesce(perfil_ajustado, resultado_perfil)`.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */

function esPerfilValido(valor: unknown): valor is PerfilRiesgo {
  return typeof valor === 'string' && (PERFILES as readonly string[]).includes(valor);
}

export async function POST(request: Request) {
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json(
      { error: 'El cuerpo de la petición no es JSON válido.' },
      { status: 400 }
    );
  }

  const codigoCliente = cuerpo?.codigo_cliente;
  if (typeof codigoCliente !== 'string' || !codigoCliente.trim()) {
    return Response.json({ error: 'Falta codigo_cliente.' }, { status: 400 });
  }

  // `null`, `undefined` o cadena vacía significan "quitar el ajuste".
  const perfilCrudo = cuerpo?.perfil_ajustado;
  let perfilAjustado: PerfilRiesgo | null;
  if (perfilCrudo === null || perfilCrudo === undefined || perfilCrudo === '') {
    perfilAjustado = null;
  } else if (esPerfilValido(perfilCrudo)) {
    perfilAjustado = perfilCrudo;
  } else {
    return Response.json(
      { error: `perfil_ajustado debe ser null o uno de: ${PERFILES.join(', ')}.` },
      { status: 400 }
    );
  }

  const comentarioCrudo = cuerpo?.comentario_asesor;
  const comentario =
    typeof comentarioCrudo === 'string' && comentarioCrudo.trim()
      ? comentarioCrudo.trim()
      : null;

  const supabase = await createClient();

  // --- Sesión ---------------------------------------------------------------

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  // --- Fila objetivo --------------------------------------------------------

  // Misma selección que /api/calcular-ips y la ficha: la evaluación más
  // reciente. Se escribe por `id` para no tocar otras evaluaciones del cliente.
  const { data: perfil, error: errorLectura } = await supabase
    .from('perfil_riesgo')
    .select('id, resultado_perfil, perfil_ajustado')
    .eq('codigo_cliente', codigoCliente)
    .order('fecha_evaluacion', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (errorLectura) {
    console.error('ajustar-ips: fallo al leer perfil_riesgo.');
    return Response.json(
      { error: 'Error al leer el perfil de riesgo.' },
      { status: 500 }
    );
  }
  if (!perfil) {
    return Response.json(
      { error: 'Este cliente no tiene perfil de riesgo que ajustar.' },
      { status: 404 }
    );
  }

  // --- Regla: justificar cuando el ajuste contradice al motor ---------------

  const difiereDelMotor =
    perfilAjustado !== null && perfilAjustado !== perfil.resultado_perfil;

  if (difiereDelMotor && !comentario) {
    return Response.json(
      {
        error:
          'El comentario es obligatorio cuando el perfil ajustado difiere del ' +
          'calculado por el motor.',
      },
      { status: 400 }
    );
  }

  // --- Escritura ------------------------------------------------------------

  // Al quitar el ajuste se limpia solo `perfil_ajustado`: `ajustado_por`,
  // `fecha_ajuste` y el comentario se conservan como rastro de que hubo un
  // override y se retiró. Si viene un comentario nuevo, ese sí se guarda.
  const cambios: Record<string, string | null> =
    perfilAjustado === null
      ? comentario
        ? { perfil_ajustado: null, comentario_asesor: comentario }
        : { perfil_ajustado: null }
      : {
          perfil_ajustado: perfilAjustado,
          comentario_asesor: comentario,
          ajustado_por: user.email ?? user.id,
          fecha_ajuste: new Date().toISOString(),
        };

  const { data: guardado, error: errorGuardado } = await supabase
    .from('perfil_riesgo')
    .update(cambios)
    .eq('id', perfil.id)
    .select(
      'perfil_ajustado, comentario_asesor, ajustado_por, fecha_ajuste, resultado_perfil'
    )
    .maybeSingle();

  if (errorGuardado || !guardado) {
    console.error('ajustar-ips: fallo al guardar el ajuste.');
    return Response.json({ error: 'No se pudo guardar el ajuste.' }, { status: 500 });
  }

  // --- Bitácora -------------------------------------------------------------

  // El motivo es el comentario del asesor tal cual lo escribió: es la única
  // constancia de por qué su criterio se apartó del motor. Cuando se retira el
  // ajuste sin comentario, el motivo lo dice explícitamente en vez de quedar
  // vacío.
  await registrarEvento(supabase, {
    entidad: 'perfil_riesgo',
    entidadId: perfil.id,
    accion: 'ajuste_perfil_asesor',
    motivo:
      comentario ??
      'El asesor retiró el ajuste manual; el perfil vuelve al calculado por el motor.',
    usuario: user.email ?? user.id,
    campo: 'perfil_ajustado',
    valorAnterior: perfil.perfil_ajustado ?? null,
    valorNuevo: perfilAjustado,
    metadata: {
      codigo_cliente: codigoCliente,
      perfil_motor: perfil.resultado_perfil,
      difiere_del_motor: difiereDelMotor,
    },
  });

  return Response.json({ codigo_cliente: codigoCliente, ...guardado });
}
