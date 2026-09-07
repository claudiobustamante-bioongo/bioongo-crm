/**
 * Bitácora · segunda capa.
 * ---------------------------------------------------------------------------
 * La primera capa son los triggers de las siete tablas, que capturan todo
 * INSERT/UPDATE/DELETE con `origen = 'trigger'`. Esa capa responde qué cambió y
 * cuándo, pero no puede responder POR QUÉ: un trigger no sabe qué decisión
 * había detrás del UPDATE que lo disparó.
 *
 * Esta capa es para los eventos que sí tienen una decisión detrás. Se escribe
 * desde el código, con `origen = 'aplicacion'`, y su campo distintivo es
 * `motivo`. Las dos capas conviven sobre la misma fila: mismo `entidad` y mismo
 * `entidad_id` que usan los triggers, para que al leer la bitácora de un
 * registro aparezcan intercaladas la mecánica y la intención.
 *
 * REGLA DE ORO: registrar nunca tumba la operación principal. Si el cálculo se
 * guardó y la bitácora falla, el cálculo sigue guardado y la función devuelve
 * false. Un fallo de auditoría no puede convertirse en pérdida de trabajo del
 * Asesor. Lo que sí queda es rastro en el log del servidor.
 *
 * Ningún dato del cliente se escribe a logs, igual que en las rutas: el
 * `metadata` va a la base, nunca a la consola.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Vocabulario cerrado de acciones. Es deliberado que agregar una obligue a
 * tocar este tipo: una bitácora de cumplimiento con acciones inventadas al
 * vuelo en cada ruta deja de ser consultable.
 */
export type AccionBitacora =
  | 'calculo_ips'
  | 'generacion_portafolio'
  | 'ajuste_perfil_asesor';

export interface EventoBitacora {
  /** Tabla afectada. Debe coincidir con la que usan los triggers. */
  entidad: string;
  /** Llave del registro afectado, normalmente el uuid de la fila. */
  entidadId: string;
  accion: AccionBitacora;
  /** El porqué. Es la razón de ser de esta capa: nunca se deja vacío. */
  motivo: string;
  /** Correo de la sesión. Si no hay correo, el id del usuario. */
  usuario: string;
  /** Columna concreta, cuando el evento cambia una sola. */
  campo?: string | null;
  valorAnterior?: string | null;
  valorNuevo?: string | null;
  /** Resultado completo del cálculo, para poder reconstruirlo después. */
  metadata?: Record<string, unknown>;
}

/**
 * Registra un evento con `origen = 'aplicacion'`.
 *
 * Devuelve `true` si quedó asentado y `false` si no. Nunca lanza: el llamador
 * puede ignorar el valor de retorno sin riesgo de romper su flujo.
 */
export async function registrarEvento(
  supabase: SupabaseClient,
  evento: EventoBitacora,
): Promise<boolean> {
  try {
    const { error } = await supabase.from('bitacora').insert({
      entidad: evento.entidad,
      entidad_id: evento.entidadId,
      accion: evento.accion,
      campo: evento.campo ?? null,
      valor_anterior: evento.valorAnterior ?? null,
      valor_nuevo: evento.valorNuevo ?? null,
      motivo: evento.motivo,
      usuario: evento.usuario,
      origen: 'aplicacion',
      metadata: evento.metadata ?? null,
    });

    if (error) {
      // Se registran entidad, acción y el código de Postgres: suficiente para
      // diagnosticar (42501 sería RLS) sin volcar datos del cliente al log.
      console.error(
        `bitacora: no se pudo registrar ${evento.accion} sobre ${evento.entidad} ` +
          `(código ${error.code ?? 'desconocido'}).`,
      );
      return false;
    }

    return true;
  } catch {
    // Red caída, cliente mal construido, cualquier cosa. La operación principal
    // ya ocurrió y no se revierte por esto.
    console.error(
      `bitacora: excepción al registrar ${evento.accion} sobre ${evento.entidad}.`,
    );
    return false;
  }
}
