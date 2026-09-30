/**
 * [expediente] POST /api/ebr-masivo
 *
 * Corre el EBR sobre la cartera en secuencia y responde con un stream NDJSON
 * (una línea de JSON por evento). No espera a terminar para responder: la UI
 * ve el avance en vivo y el navegador no corta por timeout.
 *
 * Puerta de cumplimiento (Canon ENSO — legal y compliance nunca ejecutan
 * sin Claudio): el body debe traer `confirmacion: "EVALUAR"` escrito a mano.
 * No es cortesía de UX, es la restricción que evita que un agente, un fetch
 * perdido o un doble click reclasifiquen 36 expedientes.
 *
 * AJUSTE DE IMPORT (no es lógica, es una ruta): la línea de `createClient`
 * de abajo debe apuntar a tu helper de Supabase del lado servidor.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { correrLoteEBR, type EventoLote, type ResumenLote } from '@/lib/ebr-lote';
import { evaluarYGuardarEBR } from '@/lib/ebr-runner';
import {
  partirCartera,
  type AlcanceMasivo,
  type ConExcluidos,
  type FilaCartera,
} from '@/lib/cartera';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 36 clientes en secuencia. Súbelo si la cartera crece. */
export const maxDuration = 300;

/** El evento del orquestador, con el resumen completado por esta ruta. */
type EventoMasivo =
  | Exclude<EventoLote, { tipo: 'resumen' }>
  | { tipo: 'resumen'; lote_id: string; resumen: ResumenLote & ConExcluidos };

type Body = {
  confirmacion?: string;
  alcance?: AlcanceMasivo;
  codigos?: string[];
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Body;

  // --- Puerta de cumplimiento -------------------------------------------
  if (body.confirmacion !== 'EVALUAR') {
    return Response.json(
      {
        error:
          'Confirmación requerida. Escribe EVALUAR para autorizar la corrida masiva.',
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
  const alcance: AlcanceMasivo = body.alcance ?? 'todos';
  let codigos: string[];
  let excluidos_baja: string[] = [];

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
    // Por defecto, TODOS. Un inactivo con grado ALTO viejo sigue siendo un
    // expediente tuyo; el mismo criterio que aplicaste al cotejo de listas.
    // Las BAJAS no: cuenta cerrada, se excluyen y el resumen las lista.
    let q = supabase.from('clientes').select('codigo_cliente, status');
    if (alcance === 'vigentes') q = q.eq('status', 'vigente');

    const { data, error } = await q.order('codigo_cliente');
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    ({ codigos, excluidos_baja } = partirCartera((data ?? []) as FilaCartera[]));
  }

  if (codigos.length === 0) {
    return Response.json({ error: 'No hay clientes que evaluar' }, { status: 400 });
  }

  // --- Lote --------------------------------------------------------------
  const lote_id = `ebr-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const usuario = user.email ?? user.id;

  const encoder = new TextEncoder();
  const linea = (e: EventoMasivo) => encoder.encode(JSON.stringify(e) + '\n');

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const iterador = correrLoteEBR(
          codigos,
          (codigo) => evaluarYGuardarEBR(codigo, { supabase, usuario, lote_id }),
          { lote_id, timeout_ms: 20_000, pausa_ms: 0, signal: req.signal },
        );

        for await (const evento of iterador) {
          // El orquestador [core] no sabe de bajas; el resumen se completa aquí.
          controller.enqueue(
            linea(
              evento.tipo === 'resumen'
                ? { ...evento, resumen: { ...evento.resumen, excluidos_baja } }
                : evento,
            ),
          );
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
