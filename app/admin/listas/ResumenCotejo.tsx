/**
 * Resumen del estado de cotejo contra las listas vigentes.
 *
 * Responde de un vistazo la pregunta que un supervisor hace segundo —¿contra
 * qué se cotejó, cuándo, y qué salió?— sin obligar a leer la tabla del
 * historial renglón por renglón.
 *
 * DOS COSAS QUE ESTE BLOQUE NO PUEDE DEJAR DE DECIR:
 *
 * 1. Que el cotejo contra OFAC, SAT 69-B y ONU es DILIGENCIA ADICIONAL. Un
 *    resumen en verde diciendo «sin coincidencias» es exactamente la clase de
 *    pantalla que se confunde con cumplimiento cumplido. El apartado III.10
 *    solo se satisface con la Lista de Personas Bloqueadas y la de PEP
 *    nacionales, y eso lo dice el bloque rojo de arriba, que no se toca.
 *
 * 2. CUÁNDO se corrió. «Sin coincidencias» sin fecha no informa nada: la lista
 *    pudo cargarse hace seis meses y la cartera haber cambiado entera desde
 *    entonces. Por eso se muestra la fecha del último cotejo, su antigüedad en
 *    días, y —si la cartera creció— cuántos clientes NO han sido cotejados.
 */

export interface ListaCotejada {
  id: string;
  tipo: string;
  obligatoria: boolean;
  fechaLista: string;
  fechaCarga: string;
  registros: number;
  /**
   * Clientes cotejados EN SU MOMENTO, según la bitácora de la carga. No es el
   * tamaño actual de la cartera: el cotejo se corrió contra la de entonces, y
   * decir «36 clientes» cuando hoy hay 40 sería afirmar algo que no se hizo.
   */
  clientesCotejados: number | null;
  pendientes: number;
}

/** Nombre legible por tipo. Espeja `TipoLista` de `lib/listas.ts`. */
const NOMBRE_LISTA: Record<string, string> = {
  LPB: 'Lista de Personas Bloqueadas',
  PEP_NACIONAL: 'PEP nacionales',
  OFAC: 'OFAC',
  SAT_69B: 'SAT 69-B',
  ONU: 'ONU',
};

// Sin `toLocaleDateString` ni `toLocaleString`: el servidor y el navegador
// pueden resolver distinto el locale y romper la hidratación. Mismo criterio
// que `fechaLegible` en el resto de la página.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-07-31' → '31-jul-2026'. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${MESES[Number(m) - 1] ?? m}-${a}`;
}

/** 14761 → '14,761'. */
function miles(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Antigüedad en palabras. Es lo que convierte una fecha en una señal. */
function antiguedad(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${miles(dias)} días`;
}

/** ['A', 'B', 'C'] → 'A, B y C'. */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

export default function ResumenCotejo({
  listas,
  clientesActuales,
}: {
  listas: ListaCotejada[];
  clientesActuales: number;
}) {
  if (listas.length === 0) {
    return (
      <section className="mt-6">
        <h2 className="text-lg font-semibold mb-3">Estado del cotejo</h2>
        <p className="border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-600">
          No hay ninguna lista vigente. Todavía no se ha corrido ningún cotejo contra la
          cartera.
        </p>
      </section>
    );
  }

  const pendientesTotal = listas.reduce((s, l) => s + l.pendientes, 0);

  // El cotejo más ANTIGUO es el que manda para hablar de frescura: decir que el
  // último fue hoy, cuando otra lista se cotejó en marzo, es medio dato.
  const cotejoMasViejo = listas.reduce(
    (min, l) => (l.fechaCarga < min ? l.fechaCarga : min),
    listas[0].fechaCarga
  );

  // Mismo criterio para el alcance: el cotejo conjunto solo cubre a los
  // clientes que TODAS las listas alcanzaron.
  const alcances = listas
    .map((l) => l.clientesCotejados)
    .filter((n): n is number => typeof n === 'number');
  const alcance = alcances.length > 0 ? Math.min(...alcances) : null;
  const sinCotejar = alcance === null ? 0 : Math.max(0, clientesActuales - alcance);

  const adicionales = listas.filter((l) => !l.obligatoria);

  const partes = listas.map(
    (l) =>
      `${NOMBRE_LISTA[l.tipo] ?? l.tipo} (${miles(l.registros)} registros, ` +
      `lista al ${fechaCorta(l.fechaLista)})`
  );

  const desenlace =
    pendientesTotal === 0
      ? `sin coincidencias en los ${miles(alcance ?? clientesActuales)} clientes ` +
        (sinCotejar > 0 ? 'cotejados' : 'de la cartera')
      : `${miles(pendientesTotal)} coincidencia(s) pendiente(s) de revisión sobre ` +
        `${miles(alcance ?? clientesActuales)} clientes cotejados`;

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold mb-3">Estado del cotejo</h2>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left">
              <th className="px-3 py-2 font-medium text-slate-600">Lista</th>
              <th className="px-3 py-2 font-medium text-slate-600">Corte</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-right">Registros</th>
              <th className="px-3 py-2 font-medium text-slate-600 text-right">
                Clientes cotejados
              </th>
              <th className="px-3 py-2 font-medium text-slate-600 text-right">Pendientes</th>
            </tr>
          </thead>
          <tbody>
            {listas.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium text-slate-900">
                    {NOMBRE_LISTA[l.tipo] ?? l.tipo}
                  </span>
                  <span
                    className={`ml-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      l.obligatoria
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {l.obligatoria ? 'obligatoria' : 'diligencia adicional'}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-900">{fechaCorta(l.fechaLista)}</td>
                <td className="px-3 py-2 text-right text-slate-900">{miles(l.registros)}</td>
                <td className="px-3 py-2 text-right text-slate-900">
                  {l.clientesCotejados === null ? '—' : miles(l.clientesCotejados)}
                </td>
                {/* El cero se escribe, no se deja en blanco: un hueco se lee
                    como «no se midió», y aquí sí se midió. */}
                <td
                  className={`px-3 py-2 text-right font-medium ${
                    l.pendientes > 0 ? 'text-red-700' : 'text-slate-500'
                  }`}
                >
                  {miles(l.pendientes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* --- La línea de resultado ------------------------------------------- */}

      <p
        className={`mt-3 rounded-lg px-4 py-3 text-sm border ${
          pendientesTotal > 0
            ? 'border-red-300 bg-red-50 text-red-900'
            : 'border-slate-200 text-slate-700'
        }`}
      >
        Cotejo contra {enumerar(partes)}: {desenlace}.{' '}
        <strong>
          Último cotejo corrido el {fechaCorta(cotejoMasViejo)} ({antiguedad(cotejoMasViejo)}).
        </strong>
      </p>

      {/* --- Alcance vencido -------------------------------------------------- */}

      {sinCotejar > 0 && (
        <p className="mt-2 border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-900">
          La cartera tiene hoy {miles(clientesActuales)} clientes y el cotejo corrió sobre{' '}
          {miles(alcance ?? 0)}. Los {miles(sinCotejar)} restantes{' '}
          <strong>no se han cotejado</strong> contra estas listas: el cotejo ocurre al
          cargar, no de forma continua. Vuelve a cargar la lista para alcanzarlos.
        </p>
      )}

      {/* --- Lo que este cotejo NO es ----------------------------------------- */}

      {adicionales.length > 0 && (
        <p className="mt-2 border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-900">
          <strong>Esto es diligencia adicional, no el cumplimiento del apartado III.10.</strong>{' '}
          {enumerar(adicionales.map((l) => NOMBRE_LISTA[l.tipo] ?? l.tipo))}{' '}
          {adicionales.length === 1 ? 'no sustituye' : 'no sustituyen'} a la Lista de Personas
          Bloqueadas ni a la de PEP nacionales. El estado de esa obligación es el del bloque de
          arriba, y no cambia por lo que diga este resumen.
        </p>
      )}
    </section>
  );
}
