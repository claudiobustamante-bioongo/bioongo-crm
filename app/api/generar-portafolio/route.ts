import { createClient } from '@/lib/supabase-server';
import { PERFILES, type PerfilRiesgo } from '@/lib/ips-catalogo';
import {
  PORTAFOLIOS,
  UNIVERSOS,
  construirPortafolio,
  type Fase,
  type Ruta,
  type Universo,
} from '@/lib/ips-portafolios';

/**
 * POST /api/generar-portafolio
 *
 * Recibe { codigo_cliente, universo }, resuelve el perfil efectivo del cliente
 * y construye el portafolio con el motor de dos universos.
 *
 * HISTÓRICO: cada llamada INSERTA una fila nueva en `portafolios`. Nunca
 * actualiza la anterior. Varias generaciones del mismo cliente coexisten y la
 * vigente es la de `fecha_generacion` más reciente. Es deliberado: el
 * portafolio que se le mostró al cliente en una fecha debe seguir siendo
 * recuperable después de regenerar.
 *
 * PERFIL EFECTIVO: coalesce(perfil_ajustado, resultado_perfil). Si el asesor
 * ajustó el perfil vía /api/ajustar-ips, ese manda sobre el del motor. La
 * respuesta declara cuál se usó en `perfil_origen`.
 *
 * FASE: se lee de `perfil_riesgo.fase`, que escribe /api/calcular-ips. NO se
 * recalcula aquí a propósito: el portafolio debe construirse con la misma fase
 * con la que se determinó el perfil, no con una recalculada después que podría
 * haber cambiado.
 *
 * UNIVERSO: obligatorio y sin valor por omisión. Elegir entre UCITS y EE.UU.
 * decide si el cliente queda expuesto al impuesto sucesorio estadounidense;
 * una decisión así no puede ocurrir por defecto.
 *
 * RUTA: las rutas elegibles dependen del universo y salen de
 * `UNIVERSOS[universo].rutasDisponibles`, que es la única fuente.
 *
 *   UCITS → "LSE" o "SIC". Dos opciones, y la diferencia es fiscal y grande:
 *           por SIC aplica la retención definitiva del 10% del art. 129 LISR,
 *           por LSE la ganancia es acumulable a tasa marginal de hasta 35%.
 *           Por eso aquí la ruta es OBLIGATORIA y sin valor por omisión: una
 *           decisión así no puede quedar a merced de un default.
 *   EEUU  → "US" únicamente. Al no haber dos opciones fiscales entre las que
 *           elegir, la regla de "explícito o 400" no aplica: la decisión ya se
 *           tomó al elegir el universo. Se acepta omitida o como "US".
 *
 * Pedir "SIC" sobre el universo EEUU no es un error de datos faltantes sino una
 * combinación conceptualmente inválida, y se rechaza como tal.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */

/** Fases válidas derivadas del propio motor: si allá se agrega una, aquí entra sola. */
const FASES_VALIDAS = new Set(
  Object.keys(PORTAFOLIOS).map((clave) => clave.split('|')[0])
);

/** Universos válidos derivados del motor. Coincide con el CHECK de la tabla. */
const UNIVERSOS_VALIDOS = Object.keys(UNIVERSOS) as Universo[];

function esPerfilValido(valor: unknown): valor is PerfilRiesgo {
  return typeof valor === 'string' && (PERFILES as readonly string[]).includes(valor);
}

/**
 * El motor trabaja en fracciones (0.05 = 5%) pero las columnas se llaman
 * `_pct`. Se guarda en puntos porcentuales para que la columna diga la verdad.
 * OJO: `posiciones` sí conserva las fracciones del motor, tal cual salen.
 */
const aPct = (fraccion: number): number => Number((fraccion * 100).toFixed(4));

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

  // --- Universo: obligatorio, sin default ----------------------------------

  const universoCrudo = cuerpo?.universo;
  if (universoCrudo === undefined || universoCrudo === null || universoCrudo === '') {
    return Response.json(
      {
        error:
          `Falta universo. Debe declararse explícitamente como uno de: ` +
          `${UNIVERSOS_VALIDOS.join(', ')}. La elección determina la exposición ` +
          `al impuesto sucesorio de EE.UU. y no tiene valor por omisión.`,
      },
      { status: 400 }
    );
  }
  if (
    typeof universoCrudo !== 'string' ||
    !UNIVERSOS_VALIDOS.includes(universoCrudo as Universo)
  ) {
    return Response.json(
      { error: `universo debe ser uno de: ${UNIVERSOS_VALIDOS.join(', ')}.` },
      { status: 400 }
    );
  }
  const universo = universoCrudo as Universo;

  // --- Ruta: obligatoria, sin default --------------------------------------

  // Las rutas elegibles las declara el universo; no hay lista global.
  const rutasDelUniverso = UNIVERSOS[universo].rutasDisponibles;
  const rutaCruda = cuerpo?.ruta;
  const rutaOmitida =
    rutaCruda === undefined || rutaCruda === null || rutaCruda === '';

  let ruta: Ruta;

  if (rutasDelUniverso.length === 1) {
    // Un solo destino posible: no hay decisión fiscal que tomar aquí, se tomó
    // al elegir el universo. Se acepta omitida, pero no se acepta otra.
    const unica = rutasDelUniverso[0]!;
    if (!rutaOmitida && rutaCruda !== unica) {
      return Response.json(
        {
          error:
            `El universo ${universo} no se opera por ruta "${String(rutaCruda)}": ` +
            `su única ruta es "${unica}". ` +
            (universo === 'EEUU' && rutaCruda === 'SIC'
              ? 'Los ETFs domiciliados en EE.UU. no se ofrecen por el SIC. No es una ' +
                'limitación técnica: para operar por bolsa mexicana la vía es el ' +
                'universo UCITS, que suma la retención del 10% del art. 129 Y elimina ' +
                'la exposición al impuesto sucesorio de EE.UU., mientras que un ETF ' +
                'estadounidense por SIC daría solo lo primero.'
              : 'La restricción es del modelo, no de claves de pizarra pendientes.'),
        },
        { status: 400 }
      );
    }
    ruta = unica;
  } else {
    // Varias rutas: obligatoria y explícita, porque la elección es fiscal.
    if (rutaOmitida) {
      return Response.json(
        {
          error:
            `Falta ruta. Para el universo ${universo} debe declararse ` +
            `explícitamente como una de: ${rutasDelUniverso.join(', ')}. Por ` +
            `"SIC" aplica la retención definitiva del 10% del art. 129 LISR; ` +
            `por "LSE" la ganancia es acumulable a tasa marginal de hasta 35%. ` +
            `No tiene valor por omisión.`,
        },
        { status: 400 }
      );
    }
    if (
      typeof rutaCruda !== 'string' ||
      !(rutasDelUniverso as readonly string[]).includes(rutaCruda)
    ) {
      return Response.json(
        {
          error:
            `ruta debe ser una de: ${rutasDelUniverso.join(', ')} para el ` +
            `universo ${universo}.`,
        },
        { status: 400 }
      );
    }
    ruta = rutaCruda as Ruta;
  }

  const supabase = await createClient();

  // --- 1. Sesión ------------------------------------------------------------

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  // --- 2. Cliente -----------------------------------------------------------

  // `portafolios.codigo_cliente` tiene FK a `clientes`. Sin esta comprobación,
  // un código inexistente fallaría hasta el INSERT y saldría como 500 opaco.
  const { data: cliente, error: errorCliente } = await supabase
    .from('clientes')
    .select('codigo_cliente')
    .eq('codigo_cliente', codigoCliente)
    .maybeSingle();

  if (errorCliente) {
    console.error('generar-portafolio: fallo al leer clientes.');
    return Response.json({ error: 'Error al leer el cliente.' }, { status: 500 });
  }
  if (!cliente) {
    return Response.json({ error: 'El cliente no existe.' }, { status: 404 });
  }

  // --- 3. Perfil más reciente -----------------------------------------------

  // Mismo criterio que /api/calcular-ips y /api/ajustar-ips: la evaluación más
  // reciente por `fecha_evaluacion`. `nullsFirst: false` evita que una fila sin
  // fecha desplace a una fechada (DESC pone NULL primero).
  const { data: perfil, error: errorPerfil } = await supabase
    .from('perfil_riesgo')
    .select('fase, resultado_perfil, perfil_ajustado')
    .eq('codigo_cliente', codigoCliente)
    .order('fecha_evaluacion', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (errorPerfil) {
    console.error('generar-portafolio: fallo al leer perfil_riesgo.');
    return Response.json(
      { error: 'Error al leer el perfil de riesgo.' },
      { status: 500 }
    );
  }
  if (!perfil) {
    return Response.json(
      { error: 'El cliente no tiene perfil IPS calculado.' },
      { status: 400 }
    );
  }

  // --- 4. Perfil efectivo: el ajuste del asesor manda -----------------------

  const hayAjuste =
    typeof perfil.perfil_ajustado === 'string' && !!perfil.perfil_ajustado.trim();
  const perfilEfectivo = hayAjuste ? perfil.perfil_ajustado : perfil.resultado_perfil;

  if (!esPerfilValido(perfilEfectivo)) {
    return Response.json(
      {
        error:
          'El cliente no tiene perfil IPS calculado: falta el resultado del ' +
          'motor de riesgo. Corre /api/calcular-ips antes de generar el portafolio.',
      },
      { status: 400 }
    );
  }

  const fase = perfil.fase;
  if (typeof fase !== 'string' || !FASES_VALIDAS.has(fase)) {
    return Response.json(
      {
        error:
          'El cliente no tiene perfil IPS calculado: falta la fase del ciclo de ' +
          'vida. Corre /api/calcular-ips antes de generar el portafolio.',
      },
      { status: 400 }
    );
  }

  // --- 5. Construcción ------------------------------------------------------

  let resultado;
  try {
    resultado = construirPortafolio({
      universo,
      fase: fase as Fase,
      perfil: perfilEfectivo,
      ruta,
    });
  } catch (e) {
    // Por ruta "SIC" el motor rechaza cuando faltan claves de pizarra cotejadas
    // contra el ISIN: es una combinación que el llamador pidió y que hoy no es
    // ejecutable, así que es 400 y el mensaje dice qué falta. Por "Origen" solo
    // puede lanzar por configuración del universo (clase sin instrumentos,
    // pesos que no cierran en 1.00), y eso sí es 500.
    // En ninguno de los dos casos se escribe nada en la base.
    console.error('generar-portafolio: el motor rechazó la construcción.');
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : 'No se pudo construir el portafolio.',
      },
      { status: ruta === 'SIC' ? 400 : 500 }
    );
  }

  // `limitesOk: false` NO aborta: el motor señala y no ajusta. La fila se
  // guarda con sus validaciones, advertencias y bitácora para que el
  // incumplimiento quede completo en el histórico: qué límite se rompió, con
  // qué texto se le explicó al Asesor y qué hizo el motor por dentro.

  // --- 6. Guardado ----------------------------------------------------------

  const { data: guardado, error: errorGuardado } = await supabase
    .from('portafolios')
    .insert({
      codigo_cliente: codigoCliente,
      universo,
      fase: resultado.fase,
      perfil: resultado.perfil,
      // `portafolios` no tiene columna de ruta, pero cada Posicion lleva su
      // `rutaEjecucion` dentro del jsonb: la plaza queda asentada por posición,
      // que es lo que importa cuando una cartera sale por ruta mixta.
      posiciones: resultado.posiciones,
      liquidez_pct: aPct(resultado.liquidez),
      renta_variable_pct: aPct(resultado.rentaVariable),
      tech_pct: aPct(resultado.asignacionClases['Satelite Tecnologia']),
      validaciones: resultado.validaciones,
      // Sin estas dos, un portafolio con límites incumplidos quedaría en el
      // histórico sin el texto que explica cuáles, y se perdería el rastro de
      // las sustituciones de ruta y de las posiciones que absorbió el piso de
      // 1.5%. La bitácora es el porqué; las validaciones solo el qué.
      advertencias: resultado.advertencias,
      bitacora: resultado.bitacora,
      fecha_generacion: new Date().toISOString(),
    })
    .select('id, fecha_generacion')
    .maybeSingle();

  if (errorGuardado || !guardado) {
    console.error('generar-portafolio: fallo al guardar el portafolio.');
    return Response.json(
      {
        error: 'El portafolio se construyó pero no se pudo guardar.',
        codigo_cliente: codigoCliente,
        perfil_origen: hayAjuste ? 'ajuste_asesor' : 'motor',
        ...resultado,
      },
      { status: 500 }
    );
  }

  // --- 7. Respuesta ---------------------------------------------------------

  return Response.json({
    id: guardado.id,
    codigo_cliente: codigoCliente,
    fecha_generacion: guardado.fecha_generacion,
    perfil_origen: hayAjuste ? 'ajuste_asesor' : 'motor',
    ...resultado,
  });
}
