import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const COLUMNAS = [
  { key: 'nombre_completo', label: 'Nombre' },
  { key: 'rfc', label: 'RFC' },
  { key: 'curp', label: 'CURP' },
  { key: 'correo', label: 'Correo' },
  { key: 'celular', label: 'Celular' },
];

export default async function Tabla() {
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
