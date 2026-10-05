import { createClient } from '@/lib/supabase-server';
import Anthropic from '@anthropic-ai/sdk';
import { leerBloqueoAbierto, mensajeClienteBloqueado } from '@/lib/bloqueo';

/**
 * POST /api/perfil-ia
 *
 * Redacta con IA la narrativa del perfil a partir del cuestionario y la guarda
 * en `perfil_riesgo.perfil_ia`.
 *
 * CLIENTE BLOQUEADO: con un bloqueo abierto en `cliente_bloqueos` responde 423
 * ANTES de leer el cuestionario y de llamar a la API: no se escribe nada ni se
 * manda nada fuera. Un bloqueo que no se puede leer da 500.
 */

export const dynamic = 'force-dynamic';

const MODELO = 'claude-sonnet-5';

const SISTEMA =
  'Eres un asesor financiero profesional. Escribes perfiles de inversión en español, ' +
  'en prosa narrativa, para el expediente interno de un cliente.';

function construirPrompt(respuestas: string) {
  return `Analiza las respuestas del cuestionario de perfil de riesgo de este cliente y escribe un párrafo narrativo que describa su perfil de inversión.

Dentro del mismo párrafo cubre tres cosas:
- Su tolerancia al riesgo.
- Sus objetivos de inversión y su horizonte.
- Cualquier inconsistencia entre lo que declara y lo que revelan sus respuestas (por ejemplo, declararse conservador y luego elegir instrumentos volátiles). Si no encuentras inconsistencias, dilo en una frase.

Formato: prosa continua, sin listas, viñetas ni encabezados. Español, tono profesional de asesor financiero, máximo 200 palabras. Responde únicamente con el párrafo, sin preámbulo.

Respuestas del cuestionario:
<respuestas>
${respuestas}
</respuestas>`;
}

export async function POST(request: Request) {
  let codigoCliente: unknown;
  try {
    const body = await request.json();
    codigoCliente = body?.codigo_cliente;
  } catch {
    return Response.json({ error: 'El cuerpo de la petición no es JSON válido.' }, { status: 400 });
  }

  if (typeof codigoCliente !== 'string' || !codigoCliente.trim()) {
    return Response.json({ error: 'Falta codigo_cliente.' }, { status: 400 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'El servidor no tiene configurada la llave de Anthropic.' },
      { status: 500 }
    );
  }

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  // --- Bloqueo ----------------------------------------------------------------

  // Un cliente con bloqueo abierto por sanciones no se toca (decisión de
  // Claudio, 5-oct-2026): 423 y nada escrito. Si el bloqueo no se puede leer,
  // 500: nunca se toma como «no bloqueado».
  const { bloqueo, error: errorBloqueo } = await leerBloqueoAbierto(supabase, codigoCliente);
  if (errorBloqueo) {
    console.error('perfil-ia: fallo al leer cliente_bloqueos.');
    return Response.json(
      { error: 'No se pudo verificar si el cliente está bloqueado. No se guardó nada.' },
      { status: 500 }
    );
  }
  if (bloqueo) {
    return Response.json(
      { error: mensajeClienteBloqueado(bloqueo), codigo_error: 'cliente_bloqueado' },
      { status: 423 }
    );
  }

  const { data: perfil, error: errorLectura } = await supabase
    .from('perfil_riesgo')
    .select('respuestas_completas')
    .eq('codigo_cliente', codigoCliente)
    .maybeSingle();

  if (errorLectura) {
    return Response.json({ error: 'Error al leer el perfil de riesgo.' }, { status: 500 });
  }
  if (!perfil) {
    return Response.json(
      { error: 'Este cliente no tiene cuestionario de riesgo capturado.' },
      { status: 404 }
    );
  }
  if (!perfil.respuestas_completas) {
    return Response.json({ error: 'El cuestionario de riesgo está vacío.' }, { status: 422 });
  }

  const respuestas =
    typeof perfil.respuestas_completas === 'string'
      ? perfil.respuestas_completas
      : JSON.stringify(perfil.respuestas_completas, null, 2);

  // La llave se lee del entorno; nunca se escribe ni se registra en logs.
  const anthropic = new Anthropic();

  let narrativa = '';
  try {
    const respuesta = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: SISTEMA,
      messages: [{ role: 'user', content: construirPrompt(respuestas) }],
    });

    // Con thinking activo el primer bloque puede no ser el texto.
    const bloque = respuesta.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    narrativa = bloque?.text.trim() ?? '';
  } catch (e) {
    console.error(
      'Fallo al llamar a la API de Anthropic:',
      e instanceof Error ? e.message : 'error desconocido'
    );
    return Response.json({ error: 'No se pudo generar el perfil con IA.' }, { status: 502 });
  }

  if (!narrativa) {
    return Response.json({ error: 'La IA devolvió una respuesta vacía.' }, { status: 502 });
  }

  const { error: errorGuardado } = await supabase
    .from('perfil_riesgo')
    .update({ perfil_ia: narrativa })
    .eq('codigo_cliente', codigoCliente);

  if (errorGuardado) {
    // El texto se generó bien: lo devolvemos aunque no se haya podido guardar.
    return Response.json(
      { perfil_ia: narrativa, aviso: 'Se generó el perfil pero no se pudo guardar en la base.' },
      { status: 200 }
    );
  }

  return Response.json({ perfil_ia: narrativa });
}
