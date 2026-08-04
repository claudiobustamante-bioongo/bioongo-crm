import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function FichaCliente({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;

  const { data: cliente, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('codigo_cliente', codigo)
    .single();

  if (error || !cliente) {
    return (
      <main className="p-8 max-w-2xl mx-auto">
        <Link href="/" className="text-sm text-slate-500">← Volver</Link>
        <p className="mt-4 text-red-600">Cliente no encontrado.</p>
      </main>
    );
  }

  const nombre = [cliente.nombre, cliente.apellido_paterno, cliente.apellido_materno]
    .filter(Boolean).join(' ');

  const campos = [
    ['Código', cliente.codigo_cliente],
    ['Status', cliente.status],
    ['Cuenta IBKR', cliente.cuenta_ibkr],
    ['RFC', cliente.rfc],
    ['CURP', cliente.curp],
    ['Correo', cliente.correo],
    ['Celular', cliente.celular],
    ['Género', cliente.genero],
    ['Fecha nacimiento', cliente.fecha_nacimiento],
    ['Estado civil', cliente.estado_civil],
    ['Grado estudios', cliente.grado_estudios],
    ['Ocupación', cliente.ocupacion],
  ];

  return (
    <main className="p-8 max-w-2xl mx-auto">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← Volver a la lista</Link>

      <div className="flex justify-between items-start mt-4 mb-6">
        <h1 className="text-2xl font-semibold">
          {nombre || <span className="text-slate-400 italic">Sin nombre capturado</span>}
        </h1>
        <Link
          href={`/cliente/${codigo}/editar`}
          className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700"
        >
          Editar
        </Link>
      </div>

      <dl className="border border-slate-200 rounded-lg divide-y divide-slate-100">
        {campos.map(([label, valor]) => (
          <div key={label} className="flex px-4 py-3">
            <dt className="w-40 text-sm text-slate-500">{label}</dt>
            <dd className="text-sm text-slate-900">
              {valor || <span className="text-slate-300">—</span>}
            </dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
