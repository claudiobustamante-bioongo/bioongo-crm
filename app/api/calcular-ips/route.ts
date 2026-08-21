import { createClient } from '@/lib/supabase-server';
import { calcularPerfilIPS, type IPSInputs } from '@/lib/ips-engine';

/**
 * POST /api/calcular-ips
 *
 * Recibe { codigo_cliente }, calcula el perfil IPS con el motor y guarda el
 * resultado en perfil_riesgo. Devuelve el resultado completo con bitácora.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */

/** Convierte a número los `numeric` de Postgres, que pueden llegar como texto. */
function aNumero(valor: unknown): number | undefined {
  if (valor === null || valor === undefined) return undefined;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : undefined;
}

/** Normaliza texto: cadenas vacías o solo espacios se tratan como ausentes. */
function aTexto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor : undefined;
}

export async function POST(request: Request) {
  let codigoCliente: unknown;
  try {
    const body = await request.json();
    codigoCliente = body?.codigo_cliente;
  } catch {
    return Response.json(
      { error: 'El cuerpo de la petición no es JSON válido.' },
      { status: 400 }
    );
  }

  if (typeof codigoCliente !== 'string' || !codigoCliente.trim()) {
    return Response.json({ error: 'Falta codigo_cliente.' }, { status: 400 });
  }

  const supabase = await createClient();

  // --- 1. Sesión ------------------------------------------------------------

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  // --- 2. Lectura -----------------------------------------------------------

  const { data: cliente, error: errorCliente } = await supabase
    .from('clientes')
    .select(
      'nombre, apellido_paterno, apellido_materno, fecha_nacimiento, ocupacion, ingreso_neto_mensual'
    )
    .eq('codigo_cliente', codigoCliente)
    .maybeSingle();

  if (errorCliente) {
    console.error('calcular-ips: fallo al leer clientes.');
    return Response.json({ error: 'Error al leer el cliente.' }, { status: 500 });
  }
  if (!cliente) {
    return Response.json({ error: 'El cliente no existe.' }, { status: 404 });
  }

  // `perfil_riesgo` no tiene restricción única en codigo_cliente, así que puede
  // haber varias evaluaciones. Se toma la más reciente; `nullsFirst: false`
  // evita que una fila sin fecha desplace a una fechada (DESC pone NULL primero).
  const { data: perfil, error: errorPerfil } = await supabase
    .from('perfil_riesgo')
    // El select debe ser un literal: supabase-js infiere los tipos parseando la
    // cadena, y una concatenación en runtime le deja `GenericStringError`.
    .select(
      'id, tolerancia_perdida, reaccion_caida_10, negocio_propio, percepcion_riesgo_empleo, prefiere_ingreso_seguro, no_puede_perder, colchon_liquidez, dependientes, situacion_habitacional, ahorros, hipoteca, otras_deudas, objetivo_inversion, ganancia_deseada, horizonte'
    )
    .eq('codigo_cliente', codigoCliente)
    .order('fecha_evaluacion', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (errorPerfil) {
    console.error('calcular-ips: fallo al leer perfil_riesgo.');
    return Response.json(
      { error: 'Error al leer el perfil de riesgo.' },
      { status: 500 }
    );
  }
  // Sin fila no hay dónde guardar: un update afectaría 0 renglones en silencio.
  if (!perfil) {
    return Response.json(
      { error: 'Este cliente no tiene cuestionario de riesgo capturado.' },
      { status: 404 }
    );
  }

  // --- 3. Mapeo a IPSInputs -------------------------------------------------

  const nombreCompleto = [
    cliente.nombre,
    cliente.apellido_paterno,
    cliente.apellido_materno,
  ]
    .filter((parte): parte is string => typeof parte === 'string' && !!parte.trim())
    .join(' ')
    .trim();

  const inputs: IPSInputs = {
    nombreCompleto,
    fechaNacimiento: aTexto(cliente.fecha_nacimiento) ?? '',
    ocupacion: aTexto(cliente.ocupacion) ?? '',
    // Si viene nulo o ilegible pasa NaN, y el motor lo reporta como bloqueante.
    ingresoMensual: aNumero(cliente.ingreso_neto_mensual) ?? Number.NaN,

    escenarioGananciaPerdida: aTexto(perfil.tolerancia_perdida),
    reaccionCaida10: aTexto(perfil.reaccion_caida_10),
    negocioPropio: aTexto(perfil.negocio_propio),
    percepcionRiesgoEmpleo: aTexto(perfil.percepcion_riesgo_empleo),
    prefiereIngresoSeguro: aTexto(perfil.prefiere_ingreso_seguro),
    noPuedePerder: aTexto(perfil.no_puede_perder),

    colchonLiquidez: aTexto(perfil.colchon_liquidez),
    dependientes: aNumero(perfil.dependientes),
    situacionHabitacional: aTexto(perfil.situacion_habitacional),
    ahorros: aNumero(perfil.ahorros),
    hipoteca: aNumero(perfil.hipoteca),
    otrasDeudas: aNumero(perfil.otras_deudas),

    objetivoInversion: aTexto(perfil.objetivo_inversion),
    gananciaEsperada: aTexto(perfil.ganancia_deseada),
    horizonteDeclarado: aTexto(perfil.horizonte),
  };

  // --- 4. Cálculo -----------------------------------------------------------

  let resultado;
  try {
    resultado = calcularPerfilIPS(inputs);
  } catch (e) {
    // Datos bloqueantes faltantes: no se escribe nada en la base.
    return Response.json(
      { error: e instanceof Error ? e.message : 'No se pudo calcular el perfil.' },
      { status: 400 }
    );
  }

  // --- 5. Guardado ----------------------------------------------------------

  // Se actualiza por `id`, no por codigo_cliente: si el cliente tiene varias
  // evaluaciones, filtrar por código sobrescribiría todas.
  const { error: errorGuardado } = await supabase
    .from('perfil_riesgo')
    .update({
      fase: resultado.fase,
      tolerancia_puntos: resultado.toleranciaPuntos,
      tolerancia_nivel: resultado.toleranciaNivel,
      capacidad_puntos: resultado.capacidadPuntos,
      capacidad_nivel: resultado.capacidadNivel,
      puntuacion_ponderada: resultado.puntuacionPonderada,
      resultado_perfil: resultado.perfilFinal,
      bitacora_calculo: resultado.bitacora,
      fecha_calculo: new Date().toISOString(),
    })
    .eq('id', perfil.id);

  if (errorGuardado) {
    console.error('calcular-ips: fallo al guardar el resultado.');
    return Response.json(
      {
        error: 'El perfil se calculó pero no se pudo guardar.',
        codigo_cliente: codigoCliente,
        nombreCompleto,
        ...resultado,
      },
      { status: 500 }
    );
  }

  // --- 6. Respuesta ---------------------------------------------------------

  return Response.json({
    codigo_cliente: codigoCliente,
    nombreCompleto,
    ...resultado,
  });
}
