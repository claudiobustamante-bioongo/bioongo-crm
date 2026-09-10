import { createClient } from '@/lib/supabase-server';
import Link from 'next/link';
import { EbrMasivo } from './EbrMasivo';

/**
 * Cotejo de clientes · la cartera completa, y las corridas masivas que la
 * reclasifican.
 *
 * Las corridas viven AQUÍ y no en una pantalla de administración aparte: quien
 * autoriza una reclasificación de toda la cartera tiene que estar viendo a
 * quién va a alcanzar. El panel de `/admin/ebr` se mudó a esta página y aquella
 * ruta quedó como redirect.
 *
 * LA PUERTA ESCRITA NO ES UX. Una corrida masiva reclasifica expedientes de
 * cumplimiento y no puede dispararse con un click: hay que escribir la palabra
 * de confirmación, y la ruta la vuelve a exigir en el servidor (428 sin ella).
 * Un agente, un doble click o un fetch perdido no alcanzan.
 */

export const dynamic = 'force-dynamic';

const COLUMNAS = [
  { key: 'nombre_completo', label: 'Nombre' },
  { key: 'rfc', label: 'RFC' },
  { key: 'curp', label: 'CURP' },
  { key: 'correo', label: 'Correo' },
  { key: 'celular', label: 'Celular' },
];

export default async function Tabla() {
  const supabase = await createClient();

  const { data: clientes, error } = await supabase
    .from('clientes')
    .select('codigo_cliente, status, nombre, apellido_paterno, apellido_materno, rfc, curp, correo, celular')
    .order('codigo_cliente');

  if (error) return <div className="p-8 text-red-600">Error: {error.message}</div>;

  const filas = (clientes ?? []).map((c) => ({
    ...c,
    nombre_completo: [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' '),
  }));

  const totalCampos = COLUMNAS.length;
  const completitud = (fila: Record<string, unknown>) =>
    COLUMNAS.filter((col) => fila[col.key]).length;

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Cotejo de clientes</h1>
          <p className="text-sm text-slate-500">{filas.length} clientes · celdas en rojo = dato faltante</p>
        </div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← Volver a tarjetas</Link>
      </div>

      {/* --- Corridas masivas ------------------------------------------------- */}

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-1">Corridas masivas</h2>
        <p className="text-sm text-slate-500 mb-3">
          Reclasifican expedientes sobre los {filas.length} clientes de arriba. Las dos exigen
          confirmación escrita y dejan un lote identificado en bitácora.
        </p>

        <div className="grid gap-4 items-start lg:grid-cols-2">
          <EbrMasivo />
          <IpsMasivoBloqueado />
        </div>
      </section>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left">
              <th className="px-3 py-2 font-medium text-slate-600">Código</th>
              <th className="px-3 py-2 font-medium text-slate-600">Status</th>
              {COLUMNAS.map((col) => (
                <th key={col.key} className="px-3 py-2 font-medium text-slate-600">{col.label}</th>
              ))}
              <th className="px-3 py-2 font-medium text-slate-600">Completo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => {
              const n = completitud(fila);
              return (
                <tr key={fila.codigo_cliente} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/cliente/${fila.codigo_cliente}`} className="text-slate-900 hover:underline font-medium">
                      {fila.codigo_cliente}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                      fila.status === 'vigente'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {fila.status ?? '—'}
                    </span>
                  </td>
                  {COLUMNAS.map((col) => {
                    const valor = fila[col.key as keyof typeof fila];
                    return (
                      <td key={col.key} className={`px-3 py-2 ${valor ? 'text-slate-700' : 'bg-red-50'}`}>
                        {valor || <span className="text-red-400">falta</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      n === totalCampos ? 'bg-green-100 text-green-700' :
                      n === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {n}/{totalCampos}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/**
 * IPS masivo · el hueco donde va a ir, con el motivo escrito de por qué no está.
 *
 * NO es un botón deshabilitado por cortesía. `perfil_riesgo` tiene restricción
 * única en `codigo_cliente` y `/api/calcular-ips` actualiza la fila en sitio:
 * una corrida masiva SOBRESCRIBIRÍA los 28 perfiles vigentes y no habría fila
 * anterior a la que volver. `ebr_evaluaciones` no tiene ese problema porque es
 * histórica —el lote agrega renglones—, y esa es toda la diferencia.
 *
 * Un botón que no se ve dejaría el hueco sin explicar y alguien lo construiría
 * sin enterarse del problema. Uno que se ve y dice por qué está trabado es
 * documentación en el único lugar donde se va a leer.
 */
function IpsMasivoBloqueado() {
  return (
    <section className="rounded-lg border border-dashed border-neutral-300 p-4 dark:border-neutral-700">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-neutral-500">Cálculo IPS masivo</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Correría el motor IPS sobre la cartera y recalcularía el perfil de inversión de
          cada cliente.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white opacity-40"
        >
          Calcular cartera
        </button>
        <span className="text-xs font-medium uppercase tracking-wide text-amber-700">
          Bloqueado
        </span>
      </div>

      <p className="mt-3 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/30">
        <strong>No se construye hasta historificar `perfil_riesgo`.</strong> La tabla tiene
        restricción única por cliente y el cálculo actualiza la fila en sitio: una corrida
        masiva sobrescribiría los 28 perfiles vigentes sin dejar versión anterior. El EBR sí
        corre porque su tabla es histórica.
      </p>
    </section>
  );
}
