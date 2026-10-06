/**
 * [expediente] Clasificación del inversionista · R03 J-0315, campo 6.
 * ---------------------------------------------------------------------------
 * Catálogo de la CNBV: 201 Institucional · 202 Calificado · 203 Sofisticado ·
 * 204 Ninguno. Vive en `clientes.clasificacion_inversionista`, con su fuente,
 * fecha y nota (migraciones/2026-10-06-clasificacion-inversionista.sql).
 *
 * ESPEJO DE LOS CHECK de esa migración; un test (clasificacion.test.ts) los
 * lee de la migración archivada y falla si difieren:
 *   - clientes_clasificacion_valida: los cuatro códigos.
 *   - clientes_clasificacion_procedencia: las dos fuentes.
 *   - clientes_clasificacion_203_solo_por_carta: 203 solo por carta firmada.
 *
 * PRINCIPIO: el sistema LEE la clasificación; nunca la asume. NULL significa
 * «no determinada», que NO es 204.
 *
 * REGLA (decisión de Claudio, 6-oct-2026): todo cliente debe tener carta. Un
 * vigente o inactivo sin clasificación es alerta roja. Bajas y leads no
 * alertan.
 *
 * Pura: sin Supabase ni red.
 */

export const CODIGOS_CLASIFICACION = ['201', '202', '203', '204'] as const;
export type CodigoClasificacion = (typeof CODIGOS_CLASIFICACION)[number];

export const NOMBRE_CLASIFICACION: Record<CodigoClasificacion, string> = {
  '201': 'Institucional',
  '202': 'Calificado',
  '203': 'Sofisticado',
  '204': 'Ninguno',
};

/**
 * Lo que el asesor puede determinar. 203 NO está: Sofisticado solo viene de la
 * carta del Anexo 1 Apartado A (CHECK clientes_clasificacion_203_solo_por_carta).
 */
export const DETERMINABLES_POR_ASESOR = ['201', '202', '204'] as const satisfies readonly CodigoClasificacion[];
export type ClasificacionDeterminable = (typeof DETERMINABLES_POR_ASESOR)[number];

export const FUENTES_CLASIFICACION = ['carta_firmada', 'determinacion_asesor'] as const;
export type FuenteClasificacion = (typeof FUENTES_CLASIFICACION)[number];

export const NOMBRE_FUENTE: Record<FuenteClasificacion, string> = {
  carta_firmada: 'Carta firmada (Anexo 1 Apartado A)',
  determinacion_asesor: 'Determinación del asesor',
};

export const ALERTA_SIN_CLASIFICACION = 'Falta carta de clasificación: atender';

/** Status que exigen clasificación. Bajas y leads no alertan. */
const STATUS_QUE_ALERTAN = new Set(['vigente', 'inactivo']);

export function esCodigoClasificacion(v: unknown): v is CodigoClasificacion {
  return typeof v === 'string' && (CODIGOS_CLASIFICACION as readonly string[]).includes(v);
}

/** Vigente o inactivo, y sin clasificación. */
export function requiereAlertaClasificacion(c: {
  status?: string | null;
  clasificacion_inversionista?: string | null;
}): boolean {
  return STATUS_QUE_ALERTAN.has(c.status ?? '') && !c.clasificacion_inversionista;
}

export interface ClasificacionLegible {
  determinada: boolean;
  /** «203 · Sofisticado», o «No determinada». */
  etiqueta: string;
  fuente: string | null;
  fecha: string | null;
  nota: string | null;
}

/**
 * Lo que la ficha muestra. Un valor fuera del catálogo se pinta tal cual —el
 * CHECK lo impide, pero si apareciera no debe disfrazarse de otro—.
 */
export function describirClasificacion(c: {
  clasificacion_inversionista?: string | null;
  clasificacion_fuente?: string | null;
  clasificacion_fecha?: string | null;
  clasificacion_nota?: string | null;
}): ClasificacionLegible {
  const codigo = c.clasificacion_inversionista;
  if (!codigo) {
    return { determinada: false, etiqueta: 'No determinada', fuente: null, fecha: null, nota: null };
  }
  const fuente = c.clasificacion_fuente ?? null;
  return {
    determinada: true,
    etiqueta: esCodigoClasificacion(codigo) ? `${codigo} · ${NOMBRE_CLASIFICACION[codigo]}` : codigo,
    fuente: fuente ? (NOMBRE_FUENTE[fuente as FuenteClasificacion] ?? fuente) : null,
    fecha: c.clasificacion_fecha ?? null,
    nota: c.clasificacion_nota ?? null,
  };
}

export type DeterminacionValida = { ok: true; clasificacion: ClasificacionDeterminable; nota: string };
export type DeterminacionInvalida = { ok: false; error: string };

/** Valida lo que manda /cliente/[codigo]/clasificacion. */
export function validarDeterminacion(entrada: {
  clasificacion?: unknown;
  nota?: unknown;
}): DeterminacionValida | DeterminacionInvalida {
  const clasificacion = entrada.clasificacion;
  if (clasificacion === '203') {
    return {
      ok: false,
      error:
        '203 (Sofisticado) no se determina: solo viene de la carta del Anexo 1 Apartado A ' +
        'firmada por el cliente.',
    };
  }
  if (
    typeof clasificacion !== 'string' ||
    !(DETERMINABLES_POR_ASESOR as readonly string[]).includes(clasificacion)
  ) {
    return { ok: false, error: 'La clasificación debe ser 201, 202 o 204.' };
  }
  const nota = typeof entrada.nota === 'string' ? entrada.nota.trim() : '';
  if (!nota) {
    return {
      ok: false,
      error: 'La nota es obligatoria: por qué el cliente tiene esa clasificación y con qué evidencia.',
    };
  }
  return { ok: true, clasificacion: clasificacion as ClasificacionDeterminable, nota };
}
