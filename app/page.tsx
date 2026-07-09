import { supabase } from '@/lib/supabase';

export default async function Home() {
  const { data: clientes, error } = await supabase
    .from('clientes')
    .select('codigo_cliente, nombre, apellido_paterno, apellido_materno, status, correo');

  if (error) {
    return <div className="p-8 text-red-600">Error: {error.message}</div>;
  }

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-semibold mb-6">Clientes Bioongo</h1>
      {clientes?.length === 0 && (
        <p className="text-slate-500">Aún no hay clientes. Agrega el primero en /nuevo-cliente</p>
      )}
      <ul className="flex flex-col gap-3">
        {clientes?.map((c) => (
          <li key={c.codigo_cliente} className="border border-slate-300 rounded-lg p-4">
            <p className="font-medium">
              {c.nombre} {c.apellido_paterno} {c.apellido_materno}
            </p>
            <p className="text-sm text-slate-500">
              {c.codigo_cliente} · {c.status} · {c.correo}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}