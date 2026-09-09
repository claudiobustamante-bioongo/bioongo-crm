import { createClient } from '@/lib/supabase-server';
import Link from 'next/link';
import CargarLista from './CargarLista';
import BandejaCoincidencias, { type CoincidenciaPendiente } from './BandejaCoincidencias';
import ResumenCotejo, { type ListaCotejada } from './ResumenCotejo';
import {
  TIPOS_LISTA,
  TIPOS_OBLIGATORIOS,
  TOPE_BODY_LISTA,
  esObligatoria,
} from '@/lib/listas';

/**
 * Listas de control PLD/FT · carga, historial y bandeja de coincidencias.
 *
 * Manual de Cumplimiento, apartado III.10. La página existe porque el cotejo
 * contra listas lo hace una persona, no un proceso: el motor detecta
 * coincidencias exactas y un humano decide si son la persona o un homónimo.
 *
 * El resumen de arriba responde la única pregunta que un supervisor hace
 * primero —¿está cubierta la obligación?— y la responde con lo que hay, no con
 * lo que se cargó alguna vez: solo cuenta una lista VIGENTE de cada tipo
 * obligatorio.
 */

export const dynamic = 'force-dynamic';

/** Cuántas pendientes se traen. Más que esto, la bandeja deja de ser revisable. */
const TOPE_BANDEJA = 200;

/** Fecha ISO a texto estable: sin locale, para no romper la hidratación. */
function fechaLegible(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

interface FilaLista {
  id: string;
  tipo: string;
  obligatoria: boolean;
  fuente: string;
  fecha_lista: string;
  fecha_carga: string;
  cargada_por: string | null;
  registros: number;
  archivo_nombre: string | null;
  vigente: boolean;
  observaciones: string | null;
}

export default async function AdminListas() {
  const supabase = await createClient();

  const { data: listas, error: errorListas } = await supabase
    .from('listas_control')
    .select(
      'id, tipo, obligatoria, fuente, fecha_lista, fecha_carga, cargada_por, registros, archivo_nombre, vigente, observaciones'
    )
    .order('fecha_carga', { ascending: false });

  // Las coincidencias traen embebidos el cliente, la lista y el registro: la
  // bandeja tiene que poder juzgarse sin abrir cuatro pestañas. Quien revisa
  // necesita ver, en el mismo renglón, qué valor del expediente coincidió con
  // qué valor de la lista.
  const { data: pendientes, error: errorPendientes } = await supabase
    .from('listas_coincidencias')
    .select(
      `id, codigo_cliente, tipo_match, valor_cliente, valor_lista, detectada_en,
       lista:listas_control ( id, tipo, obligatoria, fuente, fecha_lista, vigente ),
       registro:listas_registros ( nombre, alias, programa, pais, observaciones ),
       cliente:clientes ( nombre, apellido_paterno, apellido_materno, status )`
    )
    .eq('estado', 'pendiente')
    .order('detectada_en', { ascending: false })
    .limit(TOPE_BANDEJA);

  const { count: totalPendientes } = await supabase
    .from('listas_coincidencias')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'pendiente');

  const { count: totalResueltas } = await supabase
    .from('listas_coincidencias')
    .select('id', { count: 'exact', head: true })
    .neq('estado', 'pendiente');

  const filas = (listas ?? []) as FilaLista[];

  // Una lista por tipo obligatorio, y tiene que estar vigente. Una LPB cargada
  // el año pasado y ya retirada no cubre nada.
  const vigentePorTipo = new Map<string, FilaLista>();
  for (const l of filas) {
    if (l.vigente && !vigentePorTipo.has(l.tipo)) vigentePorTipo.set(l.tipo, l);
  }

  // --- Datos del resumen de cotejo ----------------------------------------

  const vigentes = [...vigentePorTipo.values()];

  const { count: clientesActuales } = await supabase
    .from('clientes')
    .select('codigo_cliente', { count: 'exact', head: true });

  // Cuántos clientes alcanzó CADA cotejo. `listas_control` no lo guarda: el
  // único registro es el `metadata` del evento de carga en la bitácora. Se lee
  // de ahí y no se sustituye por el tamaño actual de la cartera, que respondería
  // otra pregunta.
  const { data: eventosCarga } =
    vigentes.length > 0
      ? await supabase
          .from('bitacora')
          .select('entidad_id, metadata')
          .eq('entidad', 'listas_control')
          .eq('accion', 'carga_lista_control')
          .in(
            'entidad_id',
            vigentes.map((l) => l.id)
          )
          .order('created_at', { ascending: false })
      : { data: [] };

  const cotejadosPorLista = new Map<string, number>();
  for (const e of eventosCarga ?? []) {
    // Ordenado por fecha descendente: el primero de cada lista es el vigente.
    if (cotejadosPorLista.has(e.entidad_id)) continue;
    const n = Number((e.metadata as Record<string, unknown> | null)?.clientes_cotejados);
    if (Number.isFinite(n)) cotejadosPorLista.set(e.entidad_id, n);
  }

  // Un conteo exacto por lista. Son cinco tipos como máximo, así que el puñado
  // de consultas cuesta menos que traerse las coincidencias para contarlas —y
  // no se topa con el tope de la bandeja, que daría un número corto.
  const pendientesPorLista = new Map<string, number>();
  await Promise.all(
    vigentes.map(async (l) => {
      const { count } = await supabase
        .from('listas_coincidencias')
        .select('id', { count: 'exact', head: true })
        .eq('lista_id', l.id)
        .eq('estado', 'pendiente');
      pendientesPorLista.set(l.id, count ?? 0);
    })
  );

  const listasCotejadas: ListaCotejada[] = vigentes
    .map((l) => ({
      id: l.id,
      tipo: l.tipo,
      obligatoria: l.obligatoria,
      fechaLista: l.fecha_lista,
      fechaCarga: l.fecha_carga,
      registros: l.registros,
      clientesCotejados: cotejadosPorLista.get(l.id) ?? null,
      pendientes: pendientesPorLista.get(l.id) ?? 0,
    }))
    // Las obligatorias primero: es el orden en que importan.
    .sort((a, b) => Number(b.obligatoria) - Number(a.obligatoria) || a.tipo.localeCompare(b.tipo));

  const tipos = TIPOS_LISTA.map((tipo) => ({ tipo, obligatoria: esObligatoria(tipo) }));

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">
        ← Volver al inicio
      </Link>

      <h1 className="text-2xl font-semibold mt-4">Listas de control PLD/FT</h1>
      <p className="text-sm text-slate-500 mt-1">
        Cotejo contra listas de control · Manual de Cumplimiento, apartado III.10
      </p>

      {/* --- Estado de la obligación ---------------------------------------- */}

      <section className="mt-6">
        <h2 className="text-lg font-semibold mb-3">Obligación del apartado III.10</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {TIPOS_OBLIGATORIOS.map((tipo) => {
            const vigente = vigentePorTipo.get(tipo);
            return (
              <div
                key={tipo}
                className={`border rounded-lg px-4 py-3 ${
                  vigente ? 'border-slate-200' : 'border-red-300 bg-red-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{tipo}</span>
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      vigente ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {vigente ? 'Lista vigente' : 'Sin lista vigente'}
                  </span>
                </div>
                {vigente ? (
                  <p className="text-sm text-slate-600 mt-1.5">
                    Corte {vigente.fecha_lista} · {vigente.registros} registros · fuente{' '}
                    {vigente.fuente}
                  </p>
                ) : (
                  <p className="text-sm text-red-900 mt-1.5">
                    La obligación no está cubierta. Ninguna otra lista la sustituye: OFAC,
                    SAT 69-B y ONU son diligencia adicional.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* --- Estado del cotejo ------------------------------------------------ */}

      <ResumenCotejo listas={listasCotejadas} clientesActuales={clientesActuales ?? 0} />

      {/* --- Carga ----------------------------------------------------------- */}

      <CargarLista tipos={tipos} topeBytes={TOPE_BODY_LISTA} />

      {/* --- Historial -------------------------------------------------------- */}

      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3">Historial de cargas</h2>

        {errorListas && (
          <p className="text-sm text-red-600 mb-3">No se pudo leer el historial de cargas.</p>
        )}

        {filas.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Todavía no se ha cargado ninguna lista.</p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left">
                  <th className="px-3 py-2 font-medium text-slate-600">Tipo</th>
                  <th className="px-3 py-2 font-medium text-slate-600">Corte</th>
                  <th className="px-3 py-2 font-medium text-slate-600">Cargada</th>
                  <th className="px-3 py-2 font-medium text-slate-600 text-right">Registros</th>
                  <th className="px-3 py-2 font-medium text-slate-600">Fuente</th>
                  <th className="px-3 py-2 font-medium text-slate-600">Por</th>
                  <th className="px-3 py-2 font-medium text-slate-600">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-900">{l.tipo}</span>
                      {l.obligatoria && (
                        <span className="ml-2 inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                          obligatoria
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-900">{l.fecha_lista}</td>
                    <td className="px-3 py-2 text-slate-600">{fechaLegible(l.fecha_carga)}</td>
                    <td className="px-3 py-2 text-right text-slate-900">{l.registros}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {l.fuente}
                      {l.archivo_nombre && (
                        <span className="text-slate-400"> · {l.archivo_nombre}</span>
                      )}
                      {/* Una carga que quedó a medias lo dice aquí y no en un log:
                          es la fila que alguien podría tomar por buena. */}
                      {l.observaciones?.startsWith('[CARGA INCOMPLETA]') && (
                        <span className="block text-red-700 mt-0.5">{l.observaciones}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{l.cargada_por ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          l.vigente
                            ? 'bg-green-100 text-green-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {l.vigente ? 'vigente' : 'retirada'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-slate-500 mt-2">
          Las cargas anteriores no se borran: pierden la vigencia y se conservan para poder
          reconstruir contra qué versión de la lista se cotejó en cada fecha.
        </p>
      </section>

      {/* --- Bandeja ---------------------------------------------------------- */}

      <BandejaCoincidencias
        pendientes={(pendientes ?? []) as unknown as CoincidenciaPendiente[]}
        totalPendientes={totalPendientes ?? 0}
        totalResueltas={totalResueltas ?? 0}
        tope={TOPE_BANDEJA}
        error={errorPendientes ? 'No se pudo leer la bandeja de coincidencias.' : ''}
      />
    </main>
  );
}
