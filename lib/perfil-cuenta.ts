/**
 * [semaforo] Perfil que aplica a una CUENTA (M5). Pura: sin base ni red.
 * ---------------------------------------------------------------------------
 * - Individual: el perfil de su titular (persona → codigo_ips → perfil_riesgo).
 * - Conjunta: el MÁS CONSERVADOR de sus titulares; si falta el de uno, SIN_PERFIL
 *   con el faltante (memoria del 14-oct-2026: conjuntas sin excepción).
 * - IPS fijado (cuentas_ibkr.codigo_ips_fijado): la cuenta usa ese perfil y no
 *   combina el de sus titulares. Es un DATO con motivo y fecha, no un caso
 *   especial en el código (primer uso: CSPMU1062, decisión del 12-nov-2026).
 * - El perfil manda el ajustado por el Asesor sobre el calculado.
 * - Vigencia (decisión del 16-nov-2026, opción b): se cuenta desde fecha_calculo
 *   (cuando el motor calculó el IPS vigente). Vencido → SIN_PERFIL.
 * - «Actualización de IPS pendiente» es un indicador APARTE que no cambia el
 *   color: cuestionario (fecha_evaluacion) de más de vigencia_ips_anios, o sin
 *   ips_firmado archivado.
 */

export const PERFILES_DE_MAS_A_MENOS_CONSERVADOR = ['Libre de Riesgo', 'Bajo', 'Moderado', 'Alto'] as const;
export type Perfil = (typeof PERFILES_DE_MAS_A_MENOS_CONSERVADOR)[number];

export interface PerfilPersona {
  codigo: string;
  /** coalesce(perfil_ajustado, resultado_perfil). */
  perfil: string | null;
  fase: string | null;
  /** AAAA-MM-DD: cuándo calculó el motor el IPS vigente. */
  fecha_calculo: string | null;
  /** AAAA-MM-DD: fecha del cuestionario (fecha_evaluacion). */
  fecha_cuestionario: string | null;
  ips_firmado: boolean;
}

export interface Titular {
  rol: 'titular' | 'cotitular';
  /** personas.codigo_ips; null si la persona no tiene IPS. */
  codigo_ips: string | null;
  /** personas.codigo_ficha, para nombrar la fuente. */
  codigo_ficha: string;
}

export interface CuentaParaPerfil {
  cuenta_ibkr: string;
  tipo: 'individual' | 'conjunta';
  titulares: readonly Titular[];
  codigo_ips_fijado: string | null;
}

export interface FaseConOrigen {
  fase: string;
  origen: string;
}

export type PerfilCuenta =
  | {
      ok: true;
      perfil: Perfil;
      fases: FaseConOrigen[];
      /** La fecha_calculo más vieja de los IPS usados. */
      fecha_ips: string;
      origen: 'individual' | 'conjunta' | 'fijado';
      fuentes: string[];
      ips_pendiente: string[];
    }
  | { ok: false; motivo: string; faltantes: string[] };

const esPerfil = (v: string | null): v is Perfil =>
  v !== null && (PERFILES_DE_MAS_A_MENOS_CONSERVADOR as readonly string[]).includes(v);

function sumarAnios(iso: string, anios: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(a + anios, m - 1, d));
  return f.toISOString().slice(0, 10);
}

export function resolverPerfilCuenta(
  cuenta: CuentaParaPerfil,
  perfiles: ReadonlyMap<string, PerfilPersona>,
  fechaFoto: string,
  vigenciaAnios: number,
): PerfilCuenta {
  let codigos: string[];
  let origen: 'individual' | 'conjunta' | 'fijado';
  if (cuenta.codigo_ips_fijado) {
    codigos = [cuenta.codigo_ips_fijado];
    origen = 'fijado';
  } else {
    const usados = cuenta.tipo === 'conjunta' ? cuenta.titulares : cuenta.titulares.filter((t) => t.rol === 'titular');
    if (usados.length === 0) return { ok: false, motivo: 'la cuenta no tiene titulares registrados', faltantes: [] };
    const sinIps = usados.filter((t) => !t.codigo_ips).map((t) => t.codigo_ficha);
    if (sinIps.length) return { ok: false, motivo: 'titular sin IPS', faltantes: sinIps };
    codigos = usados.map((t) => t.codigo_ips as string);
    origen = cuenta.tipo === 'conjunta' ? 'conjunta' : 'individual';
  }

  const leidos = codigos.map((c) => ({ c, p: perfiles.get(c) }));
  const faltantes = leidos.filter(({ p }) => !p || !esPerfil(p.perfil) || !p.fase || !p.fecha_calculo).map(({ c }) => c);
  if (faltantes.length) return { ok: false, motivo: 'IPS sin perfil, fase o fecha de cálculo', faltantes };
  const ps = leidos.map(({ p }) => p as PerfilPersona);

  const perfil = ps
    .map((p) => p.perfil as Perfil)
    .sort((a, b) => PERFILES_DE_MAS_A_MENOS_CONSERVADOR.indexOf(a) - PERFILES_DE_MAS_A_MENOS_CONSERVADOR.indexOf(b))[0];
  const fechaIps = ps.map((p) => p.fecha_calculo as string).sort()[0];
  if (sumarAnios(fechaIps, vigenciaAnios) < fechaFoto) {
    return { ok: false, motivo: `IPS vencido (calculado el ${fechaIps}, vigencia ${vigenciaAnios} años)`, faltantes: [] };
  }

  const ipsPendiente: string[] = [];
  for (const p of ps) {
    if (!p.fecha_cuestionario || sumarAnios(p.fecha_cuestionario, vigenciaAnios) < fechaFoto) {
      ipsPendiente.push(`${p.codigo}: cuestionario de ${p.fecha_cuestionario ?? 'fecha desconocida'}`);
    }
    if (!p.ips_firmado) ipsPendiente.push(`${p.codigo}: sin ips_firmado archivado`);
  }

  return {
    ok: true,
    perfil,
    fases: ps.map((p) => ({ fase: p.fase as string, origen: p.codigo })),
    fecha_ips: fechaIps,
    origen,
    fuentes: ps.map((p) => `${p.codigo}:${p.perfil}`),
    ips_pendiente: ipsPendiente,
  };
}
