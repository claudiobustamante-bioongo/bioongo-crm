/**
 * Firma de cumplimiento · validación de entrada y traducción de errores.
 * ---------------------------------------------------------------------------
 * Lógica pura: no toca Supabase ni la red. La comparten
 * /api/resolver-coincidencia y /api/levantar-bloqueo.
 *
 * QUIÉN FIRMA NO SE RECIBE. El firmante lo toma la base, dentro de
 * fn_resolver_coincidencia y fn_levantar_bloqueo, del JWT de la sesión. Por eso
 * aquí no hay campo `firmante`: si el cuerpo trae uno, se ignora. Lo que sí se
 * recibe es lo que la persona DECLARA: su rol, su declaración y, al levantar un
 * bloqueo con rol de asesor, la autorización del Oficial.
 *
 * EL ROL SE DECLARA, NO SE VERIFICA, hasta la Fase G: hoy cualquier sesión
 * puede declararse oficial_cumplimiento. Consta también en el COMMENT de
 * firmas_cumplimiento.rol (migraciones/2026-10-05-bloqueo-y-firma.sql).
 *
 * Las mismas reglas las impone la base (CHECK y validación en las funciones).
 * Validarlas aquí no es redundancia decorativa: devuelve un 400 con un mensaje
 * claro sin gastar una llamada, y la base queda como la guarda que no se puede
 * saltar.
 */

/** Espeja el CHECK firmas_rol_valido. */
export const ROLES_FIRMA = ['asesor', 'oficial_cumplimiento'] as const;
export type RolFirma = (typeof ROLES_FIRMA)[number];

export const NOMBRE_ROL: Record<RolFirma, string> = {
  asesor: 'Asesor',
  oficial_cumplimiento: 'Oficial de Cumplimiento',
};

export function esRolFirma(valor: unknown): valor is RolFirma {
  return typeof valor === 'string' && (ROLES_FIRMA as readonly string[]).includes(valor);
}

export interface FirmaDeclarada {
  rol: RolFirma;
  declaracion: string;
  /** Solo en el levantamiento. Null si no aplica o vino vacía. */
  autorizacion_oficial: string | null;
}

export type ResultadoFirma = { ok: true; firma: FirmaDeclarada } | { ok: false; error: string };

const textoLimpio = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '');

/**
 * Valida la parte declarada de una firma.
 *
 * `levantamiento: true` agrega la regla del 5-oct-2026: levantar un bloqueo por
 * sanciones es decisión del Oficial de Cumplimiento; si firma el asesor, tiene
 * que declarar quién del Oficial lo autorizó, cuándo y por qué medio. Fuera del
 * levantamiento la autorización no se acepta: la base la rechazaría por CHECK.
 */
export function validarFirma(
  cuerpo: Record<string, unknown> | null | undefined,
  { levantamiento = false }: { levantamiento?: boolean } = {},
): ResultadoFirma {
  const rol = cuerpo?.rol;
  if (!esRolFirma(rol)) {
    return {
      ok: false,
      error:
        "Falta la firma: `rol` debe ser 'asesor' u 'oficial_cumplimiento'. El rol se declara " +
        'y queda asentado con la firma.',
    };
  }

  const declaracion = textoLimpio(cuerpo?.declaracion);
  if (!declaracion) {
    return {
      ok: false,
      error:
        'Falta la firma: la `declaracion` es obligatoria. Es lo que quien firma asume como ' +
        'propio ante el supervisor.',
    };
  }

  const autorizacion = textoLimpio(cuerpo?.autorizacion_oficial);

  if (!levantamiento) {
    if (autorizacion) {
      return {
        ok: false,
        error: '`autorizacion_oficial` solo aplica al levantamiento de un bloqueo.',
      };
    }
    return { ok: true, firma: { rol, declaracion, autorizacion_oficial: null } };
  }

  if (rol === 'asesor' && !autorizacion) {
    return {
      ok: false,
      error:
        'Levantar un bloqueo con rol de asesor exige `autorizacion_oficial`: quién del ' +
        'Oficial de Cumplimiento lo autorizó, cuándo y por qué medio. Levantar un bloqueo ' +
        'por sanciones es decisión del Oficial.',
    };
  }

  return { ok: true, firma: { rol, declaracion, autorizacion_oficial: autorizacion || null } };
}

/**
 * SQLSTATE propios de las funciones de firma → código HTTP.
 *
 * Los define migraciones/2026-10-05-bloqueo-y-firma.sql. Todo lo que no esté
 * aquí es un fallo del sistema y la ruta responde 500; estos cuatro son
 * decisiones de la base sobre la petición y nunca deben salir como 500.
 */
export const ESTATUS_ERROR_FIRMA: Readonly<Record<string, number>> = {
  BL400: 400,
  BL401: 401,
  BL404: 404,
  BL409: 409,
};

export function estatusErrorFirma(codigo: unknown): number | null {
  return typeof codigo === 'string' && codigo in ESTATUS_ERROR_FIRMA
    ? ESTATUS_ERROR_FIRMA[codigo]
    : null;
}
