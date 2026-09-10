/**
 * POST /api/evaluar-ebr
 *
 * Envoltura delgada. Toda la lógica —lecturas, motor, guardado, bitácora—
 * vive en lib/ebr-runner.ts, que es también lo que llama el lote masivo.
 * Aquí solo se valida la entrada, se resuelve la sesión y se traduce el
 * resultado a códigos HTTP. El comportamiento observable es idéntico al
 * anterior.
 *
 * HISTÓRICO: cada llamada INSERTA una fila nueva en `ebr_evaluaciones`.
 * Nunca actualiza la anterior. El expediente tiene que poder reconstruirse
 * como estaba.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */

import { createClient } from '@/lib/supabase-server';
import { evaluarYGuardarEBR, type CodigoErrorEBR } from '@/lib/ebr-runner';

const ESTATUS: Record<CodigoErrorEBR, number> = {
  no_existe: 404,
  expediente_incompleto: 400,
  lectura: 500,
  motor: 500,
  guardado: 500,
};

export async function POST(request: Request) {
  let codigoCliente: unknown;
  try {
    const body = await request.json();
    codigoCliente = body?.codigo_cliente;
  } catch {
    return Response.json(
      { error: 'El cuerpo de la petición no es JSON válido.' },
      { status: 400 },
    );
  }

  if (typeof codigoCliente !== 'string' || !codigoCliente.trim()) {
    return Response.json({ error: 'Falta codigo_cliente.' }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const resultado = await evaluarYGuardarEBR(codigoCliente, {
    supabase,
    usuario: user.email ?? user.id,
  });

  if (!resultado.ok) {
    const status = ESTATUS[resultado.codigo_error ?? 'motor'] ?? 500;
    console.error(`evaluar-ebr: ${resultado.codigo_error}.`);
    return Response.json(
      {
        error: resultado.error,
        // Cuando la evaluación se calculó pero no se pudo guardar, el llamador
        // recibe el cálculo. Perder el guardado no debe perder el trabajo.
        ...(resultado.payload ?? {}),
      },
      { status },
    );
  }

  return Response.json(resultado.payload);
}
