import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;

  const supabase = await createClient();

  let query = supabase
    .from('clientes')
    .select('codigo_cliente, nombre, apellido_paterno, apellido_materno, status, correo, cuenta_ibkr')
    .order('codigo_cliente');

  if (status) {
    query = query.eq('status', status);
  }

  const { data: clientes, error } = await query;

  if (error) {
    return <div className="p-8 text-red-600">Error: {error.message}</div>;
  }

  const filters = [
    { label: 'Todos', href: '/', value: undefined },
    { label: 'Vigentes', href: '/?status=vigente', value: 'vigente' },
    { label: 'Inactivos', href: '/?status=inactivo', value: 'inactivo' },
  ];

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <div className="flex items-baseline gap-4 mb-2">
        <h1 className="text-3xl font-semibold">Clientes Bioongo</h1>
        <Link href="/tabla" className="text-sm text-slate-400 hover:text-slate-700 transition-colors">
          Ver tabla de cotejo →
        </Link>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        {clientes?.length ?? 0} cliente{clientes?.length !== 1 ? 's' : ''}
      </p>

      <div className="flex gap-2 mb-6">
        {filters.map((f) => {
          const isActive = f.value === status;
          return (
            <Link
              key={f.href}
              href={f.href}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {clientes?.length === 0 && (
        <p className="text-slate-500">No hay clientes con ese filtro.</p>
      )}

      <ul className="flex flex-col gap-3">
        {clientes?.map((c) => {
          const nombreCompleto = [c.nombre, c.apellido_paterno, c.apellido_materno]
            .filter(Boolean)
            .join(' ');
          const esVigente = c.status === 'vigente';

          return (
            <Link key={c.codigo_cliente} href={`/cliente/${c.codigo_cliente}`}>
            <li className="border border-slate-200 rounded-lg p-4 transition-colors hover:border-slate-400 cursor-pointer">
              {nombreCompleto ? (
                <p className="font-semibold text-slate-900">{nombreCompleto}</p>
              ) : (
                <p className="font-semibold text-slate-400 italic">Sin nombre capturado</p>
              )}
              <p className="text-sm text-slate-500 mt-0.5">
                {c.codigo_cliente}
                {c.cuenta_ibkr ? ` · IBKR: ${c.cuenta_ibkr}` : ''}
              </p>
              <span
                className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium ${
                  esVigente
                    ? 'bg-green-100 text-green-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {c.status ?? 'sin status'}
              </span>
            </li>
            </Link>
          );
        })}
      </ul>
    </main>
  );
}
