import { createClient } from '@/lib/supabase-server';
import Link from 'next/link';
import PerfilIA from './PerfilIA';
import CalcularIPS, { type IPSGuardado } from './CalcularIPS';
import type { EntradaBitacora } from '@/lib/ips-engine';

/** Los `numeric` de Postgres pueden llegar como texto. */
function aNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

export const dynamic = 'force-dynamic';

export default async function FichaCliente({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;

  const supabase = await createClient();

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

  // Se ordena igual que /api/calcular-ips para que la página muestre la misma
  // evaluación que el endpoint escribe. DESC pone los NULL primero: se invierte.
  const { data: perfilRiesgo } = await supabase
    .from('perfil_riesgo')
    .select(
      'perfil_ia, fase, tolerancia_puntos, tolerancia_nivel, capacidad_puntos, capacidad_nivel, puntuacion_ponderada, resultado_perfil, bitacora_calculo, fecha_calculo'
    )
    .eq('codigo_cliente', codigo)
    .order('fecha_evaluacion', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const ipsGuardado: IPSGuardado | null = perfilRiesgo
    ? {
        fase: perfilRiesgo.fase,
        toleranciaPuntos: aNumero(perfilRiesgo.tolerancia_puntos),
        toleranciaNivel: aNumero(perfilRiesgo.tolerancia_nivel),
        capacidadPuntos: aNumero(perfilRiesgo.capacidad_puntos),
        capacidadNivel: aNumero(perfilRiesgo.capacidad_nivel),
        puntuacionPonderada: aNumero(perfilRiesgo.puntuacion_ponderada),
        resultadoPerfil: perfilRiesgo.resultado_perfil,
        bitacora: Array.isArray(perfilRiesgo.bitacora_calculo)
          ? (perfilRiesgo.bitacora_calculo as unknown as EntradaBitacora[])
          : null,
        fechaCalculo: perfilRiesgo.fecha_calculo,
      }
    : null;

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

      <PerfilIA codigo={codigo} inicial={perfilRiesgo?.perfil_ia ?? null} />
      <CalcularIPS codigo={codigo} inicial={ipsGuardado} />
    </main>
  );
}
