/**
 * Bloqueo del cliente por coincidencia confirmada en lista de sanciones.
 * ---------------------------------------------------------------------------
 * La tabla es `cliente_bloqueos` (migraciones/2026-10-05-bloqueo-y-firma.sql).
 * La abre fn_resolver_coincidencia al confirmar en LPB, OFAC u ONU y la cierra
 * fn_levantar_bloqueo con firma; la aplicación solo la LEE. Un cliente tiene a
 * lo más un bloqueo abierto (índice único parcial).
 *
 * Mientras esté abierto: el IPS y el portafolio no se generan; el EBR sí corre
 * (y sale ALTO con alerta crítica por la coincidencia confirmada).
 *
 * El sistema NUNCA presenta el reporte de 24 horas. El plazo que se calcula
 * aquí es para que quien decide lo vea, no para que el sistema actúe.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Bloqueo abierto, con lo mínimo para nombrarlo y explicarlo. */
export interface BloqueoAbierto {
  id: string;
  codigo_cliente: string;
  motivo: string;
  bloqueado_en: string;
  bloqueado_por: string;
  coincidencia_id: string;
}

/**
 * El bloqueo abierto del cliente, o null.
 *
 * Un error de lectura NO se trata como «no está bloqueado»: el llamador recibe
 * `error` y debe negarse, porque operar con un cliente cuyo bloqueo no se pudo
 * leer es justo lo que esta tabla existe para impedir.
 */
export async function leerBloqueoAbierto(
  supabase: SupabaseClient,
  codigoCliente: string,
): Promise<{ bloqueo: BloqueoAbierto | null; error: boolean }> {
  const { data, error } = await supabase
    .from('cliente_bloqueos')
    .select('id, codigo_cliente, motivo, bloqueado_en, bloqueado_por, coincidencia_id')
    .eq('codigo_cliente', codigoCliente)
    .is('levantado_en', null)
    .maybeSingle();

  if (error) return { bloqueo: null, error: true };
  return { bloqueo: (data as BloqueoAbierto | null) ?? null, error: false };
}

/** Mensaje único para las rutas que se niegan a operar con un bloqueado. */
export function mensajeClienteBloqueado(b: Pick<BloqueoAbierto, 'bloqueado_en'>): string {
  return (
    `El cliente está BLOQUEADO desde ${fechaHoraCDMX(b.bloqueado_en)} (hora de CDMX) por ` +
    'coincidencia confirmada en lista de sanciones. No se opera con él hasta que el bloqueo ' +
    'se levante con firma desde su ficha.'
  );
}

const HORAS_REPORTE = 24;

/** Cuándo vencen las 24 horas del reporte, contadas desde el bloqueo. ISO UTC. */
export function venceReporte24h(bloqueadoEn: string): string {
  return new Date(Date.parse(bloqueadoEn) + HORAS_REPORTE * 3600 * 1000).toISOString();
}

/**
 * Fecha y hora en la Ciudad de México, `AAAA-MM-DD HH:MM`.
 *
 * Se arma con `formatToParts` y no con el texto del locale para que la salida
 * no dependa de cómo cada ICU puntúe la fecha. Para usarse en el servidor: el
 * componente recibe la cadena ya formateada y no hay riesgo de hidratación.
 */
export function fechaHoraCDMX(iso: string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = (t: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === t)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}`;
}

/**
 * Un bloqueo abierto tal como lo pintan la bandeja y la ficha: con su coincidencia y su
 * lista, y con las fechas ya en hora de CDMX (se formatean en el servidor).
 */
export interface BloqueoEnBandeja {
  id: string;
  codigo_cliente: string;
  motivo: string;
  bloqueado_por: string;
  bloqueado_en_cdmx: string;
  vence_reporte_cdmx: string;
  lista_tipo: string | null;
  tipo_match: string | null;
  valor_cliente: string | null;
  valor_lista: string | null;
}

/** Lo que se pide a `cliente_bloqueos` para la bandeja y la ficha. */
export const SELECT_BLOQUEO_CON_COINCIDENCIA = `id, codigo_cliente, motivo, bloqueado_en, bloqueado_por, coincidencia_id,
  coincidencia:listas_coincidencias ( tipo_match, valor_cliente, valor_lista,
    lista:listas_control ( tipo, fecha_lista, fuente ) )`;

/** PostgREST entrega objeto en muchos-a-uno, pero se tolera arreglo. */
function uno(valor: unknown): Record<string, unknown> | null {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

const textoONull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function aBloqueoEnBandeja(fila: Record<string, unknown>): BloqueoEnBandeja {
  const coincidencia = uno(fila.coincidencia);
  const lista = uno(coincidencia?.lista);
  const bloqueadoEn = String(fila.bloqueado_en);
  return {
    id: String(fila.id),
    codigo_cliente: String(fila.codigo_cliente),
    motivo: String(fila.motivo ?? ''),
    bloqueado_por: String(fila.bloqueado_por ?? ''),
    bloqueado_en_cdmx: fechaHoraCDMX(bloqueadoEn),
    vence_reporte_cdmx: fechaHoraCDMX(venceReporte24h(bloqueadoEn)),
    lista_tipo: textoONull(lista?.tipo),
    tipo_match: textoONull(coincidencia?.tipo_match),
    valor_cliente: textoONull(coincidencia?.valor_cliente),
    valor_lista: textoONull(coincidencia?.valor_lista),
  };
}
