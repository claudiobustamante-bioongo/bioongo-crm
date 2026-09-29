/**
 * [expediente] POST /api/ips-masivo
 *
 * Recalcula el perfil IPS de la cartera en secuencia y responde con un stream
 * NDJSON (una línea de JSON por evento). No espera a terminar para responder:
 * la UI ve el avance en vivo y el navegador no corta por timeout.
 *
 * Puerta de cumplimiento: el body debe traer `confirmacion: "CALCULAR"` escrito
 * a mano. La palabra es DISTINTA del `EVALUAR` del EBR a propósito — son dos
 * corridas con consecuencias distintas y una no debe poder dispararse creyendo
 * que se dispara la otra. No es cortesía de UX: es la restricción que evita que
 * un agente, un fetch perdido o un doble click recalculen 36 expedientes.
 *
 * ESTE LOTE SOBRESCRIBE. A diferencia del EBR, que agrega filas a una tabla
 * histórica, el IPS actualiza `perfil_riesgo` en sitio. Lo que hace que la
 * corrida sea reversible es el trigger `trg_archivar_perfil_riesgo`, que desde
 * el 23-sep-2026 archiva la versión anterior en `perfil_riesgo_historico` antes
 * de cada UPDATE. Sin ese trigger esta ruta no debería existir.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { correrLote } from '@/lib/ebr-lote';
import { PERFILES, type PerfilRiesgo } from '@/lib/ips-catalogo';
import {
  calcularYGuardarIPS,
  type EventoIPS,
  type ResumenIPS,
} from '@/lib/ips-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 36 clientes en secuencia. Súbelo si la cartera crece. */
export const maxDuration = 300;

type Alcance = 'todos' | 'vigentes' | 'seleccion';

type Body = {
  confirmacion?: string;
  alcance?: Alcance;
  codigos?: string[];
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;

  // --- Puerta de cumplimiento -------------------------------------------
  // Antes de leer la sesión y antes de tocar la base: sin la palabra escrita
  // esta ruta no lee ni escribe nada.
  if (body.confirmacion !== 'CALCULAR') {
    return Response.json(
      {
        error:
          'Confirmación requerida. Escribe CALCULAR para autorizar el recálculo masivo del perfil IPS.',
      },
      { status: 428 }, // Precondition Required
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: errUser,
  } = await supabase.auth.getUser();
  if (errUser || !user) {
    return Response.json({ error: 'No autenticado' }, { status: 401 });
  }

  // --- Selección de la cartera ------------------------------------------
  const alcance: Alcance = body.alcance ?? 'todos';
  let codigos: string[];

  if (alcance === 'seleccion') {
    codigos = (body.codigos ?? []).filter(
      (c): c is string => typeof c === 'string' && c.length > 0,
    );
    if (codigos.length === 0) {
      return Response.json(
        { error: 'Alcance "seleccion" sin códigos' },
        { status: 400 },
      );
    }
  } else {
    // Por defecto, TODOS. Un lote selectivo necesitaría un campo «última
    // corrección de datos» que no existe, así que se reevalúa a todos y los que
    // no tienen cuestionario salen declarados como tales en el resumen.
    let q = supabase.from('clientes').select('codigo_cliente');
    if (alcance === 'vigentes') q = q.eq('status', 'vigente');

    const { data, error } = await q.order('codigo_cliente');
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    codigos = (data ?? []).map((r) => r.codigo_cliente as string);
  }

  if (codigos.length === 0) {
    return Response.json({ error: 'No hay clientes que calcular' }, { status: 400 });
  }

  // --- Lote --------------------------------------------------------------
  const lote_id = `ips-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const usuario = user.email ?? user.id;

  const encoder = new TextEncoder();
  const linea = (e: EventoIPS) => encoder.encode(JSON.stringify(e) + '\n');

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Lo que el orquestador [core] no puede saber, porque es del expediente
      // IPS: quién traía ajuste manual y cómo se agrupan los fallos.
      const ajuste_manual: string[] = [];
      const por_codigo_error: Record<string, string[]> = {};

      try {
        const iterador = correrLote<PerfilRiesgo>(
          codigos,
          (codigo) => calcularYGuardarIPS(codigo, { supabase, usuario, lote_id }),
          {
            lote_id,
            grados: PERFILES,
            timeout_ms: 20_000,
            pausa_ms: 0,
            signal: req.signal,
          },
        );

        for await (const evento of iterador) {
          if (evento.tipo === 'avance') {
            const r = evento.resultado;
            if (r.ok && r.ajuste_manual) ajuste_manual.push(r.codigo_cliente);
            if (!r.ok) {
              const codigo_error = r.codigo_error ?? 'motor';
              (por_codigo_error[codigo_error] ??= []).push(r.codigo_cliente);
            }
            controller.enqueue(linea(evento as EventoIPS));
            continue;
          }

          if (evento.tipo === 'resumen') {
            const resumen: ResumenIPS = {
              ...evento.resumen,
              ajuste_manual,
              por_codigo_error,
            };
            controller.enqueue(linea({ tipo: 'resumen', lote_id, resumen }));
            continue;
          }

          controller.enqueue(linea(evento as EventoIPS));
        }
      } catch (e) {
        // Fallo del lote completo (conexión caída), no de un cliente.
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              tipo: 'fatal',
              lote_id,
              error: e instanceof Error ? e.message : String(e),
            }) + '\n',
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no', // evita que un proxy retenga el stream
    },
  });
}
