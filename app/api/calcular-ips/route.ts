/**
 * POST /api/calcular-ips
 *
 * Envoltura delgada. Toda la lógica —lecturas, mapeo a IPSInputs, motor,
 * guardado y bitácora— vive en lib/ips-runner.ts, que es también lo que
 * llamará el lote masivo. Aquí solo se valida la entrada, se resuelve la sesión
 * y se traduce el resultado a códigos HTTP. El comportamiento observable es
 * idéntico al anterior, y hay un test que lo fija: route.test.ts.
 *
 * El cálculo ACTUALIZA la fila de `perfil_riesgo` en sitio. Desde el
 * 23-sep-2026 la versión anterior no se pierde: el trigger
 * `trg_archivar_perfil_riesgo` la archiva en `perfil_riesgo_historico`.
 *
 * Ningún dato del cliente se escribe a logs: solo el código del error.
 */

import { createClient } from '@/lib/supabase-server';
import { calcularYGuardarIPS, type CodigoErrorIPS } from '@/lib/ips-runner';

const ESTATUS: Record<CodigoErrorIPS, number> = {
  no_existe: 404,
  // 423 Locked: el recurso existe y la petición es válida, pero está bloqueado
  // por una coincidencia confirmada en lista de sanciones. No se escribe nada.
  cliente_bloqueado: 423,
  sin_cuestionario: 404,
  // Ver el PENDIENTE «ErrorIPS tipado» en lib/ips-runner.ts: hoy todo fallo del
  // motor llega aquí como datos bloqueantes, y por eso sale como 400.
  datos_bloqueantes: 400,
  lectura: 500,
  guardado: 500,
  motor: 500,
};

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const resultado = await calcularYGuardarIPS(codigoCliente, {
    supabase,
    usuario: user.email ?? user.id,
  });

  if (!resultado.ok) {
    const status = ESTATUS[resultado.codigo_error ?? 'motor'] ?? 500;
    console.error(`calcular-ips: ${resultado.codigo_error}.`);
    return Response.json(
      {
        error: resultado.error,
        // Cuando el perfil se calculó pero no se pudo guardar, el llamador
        // recibe el cálculo. Perder el guardado no debe perder el trabajo.
        ...(resultado.payload ?? {}),
      },
      { status }
    );
  }

  return Response.json(resultado.payload);
}
