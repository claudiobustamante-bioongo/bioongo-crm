import { createClient } from '@/lib/supabase-server';
import Link from 'next/link';
import { EbrMasivo } from './EbrMasivo';
import { IpsMasivo } from './IpsMasivo';
import {
  ALERTA_SIN_CLASIFICACION,
  describirClasificacion,
  requiereAlertaClasificacion,
} from '@/lib/clasificacion';

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
    .select('codigo_cliente, status, nombre, apellido_paterno, apellido_materno, rfc, curp, correo, celular, clasificacion_inversionista')
    .order('codigo_cliente');

  if (error) return <div className="p-8 text-red-600">Error: {error.message}</div>;

  const filas = (clientes ?? []).map((c) => ({
    ...c,
    nombre_completo: [c.nombre, c.apellido_paterno, c.apellido_materno].filter(Boolean).join(' '),
  }));

  // Todo cliente debe tener carta: vigente o inactivo sin clasificación alerta.
  const sinClasificacion = filas.filter(requiereAlertaClasificacion);

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

      {sinClasificacion.length > 0 && (
        <section className="border-2 border-red-400 bg-red-50 rounded-lg px-4 py-3 mb-6">
          <p className="text-sm font-semibold text-red-900">
            {ALERTA_SIN_CLASIFICACION} · {sinClasificacion.length}{' '}
            {sinClasificacion.length === 1 ? 'cliente' : 'clientes'}
          </p>
          <p className="text-sm text-red-900 mt-1">
            {sinClasificacion.map((c, i) => (
              <span key={c.codigo_cliente}>
                {i > 0 && ', '}
                <Link href={`/cliente/${c.codigo_cliente}`} className="underline underline-offset-2">
                  {c.codigo_cliente}
                </Link>
              </span>
            ))}
          </p>
        </section>
      )}

      {/* --- Corridas masivas ------------------------------------------------- */}

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-1">Corridas masivas</h2>
        <p className="text-sm text-slate-500 mb-3">
          Reclasifican expedientes sobre los {filas.length} clientes de arriba. Las dos exigen
          confirmación escrita y dejan un lote identificado en bitácora.
        </p>

        <div className="grid gap-4 items-start lg:grid-cols-2">
          <EbrMasivo />
          <IpsMasivo />
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
              <th className="px-3 py-2 font-medium text-slate-600">Clasificación (R03)</th>
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
                  <td className="px-3 py-2">
                    {requiereAlertaClasificacion(fila) ? (
                      <span className="text-xs px-2 py-0.5 rounded font-medium bg-red-100 text-red-700">
                        {ALERTA_SIN_CLASIFICACION}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">
                        {fila.clasificacion_inversionista
                          ? describirClasificacion(fila).etiqueta
                          : '—'}
                      </span>
                    )}
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
