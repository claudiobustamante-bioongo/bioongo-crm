import { createClient } from '@/lib/supabase-server';
import Link from 'next/link';
import PerfilIA from './PerfilIA';
import CalcularIPS, { type IPSGuardado } from './CalcularIPS';
import GenerarPortafolio from './GenerarPortafolio';
import EvaluarEBR from './EvaluarEBR';
import type { EntradaBitacora } from '@/lib/ips-engine';
import { evaluarRevisionAnual, formatearFecha } from '@/lib/revision-anual';

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
      'perfil_ia, fase, tolerancia_puntos, tolerancia_nivel, capacidad_puntos, capacidad_nivel, puntuacion_ponderada, resultado_perfil, bitacora_calculo, fecha_calculo, perfil_ajustado, comentario_asesor, ajustado_por, fecha_ajuste'
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
        perfilAjustado: perfilRiesgo.perfil_ajustado,
        comentarioAsesor: perfilRiesgo.comentario_asesor,
        ajustadoPor: perfilRiesgo.ajustado_por,
        fechaAjuste: perfilRiesgo.fecha_ajuste,
      }
    : null;

  // La cuenta conjunta es una relación entre cuentas, no una fusión de titulares:
  // el expediente KYC/PLD de cada uno vive en su propio registro de `clientes`.
  // Aquí solo se lee lo mínimo para nombrar y enlazar al cotitular.
  //
  // No se trae `status` a propósito: en este modelo el status describe la cuenta
  // IBKR, no a la persona. Un titular puede tener su cuenta individual cerrada y
  // seguir operando la conjunta, así que marcarlo "inactivo" aquí sería falso.
  const { data: cotitular } = cliente.es_conjunta && cliente.codigo_cotitular
    ? await supabase
        .from('clientes')
        .select('codigo_cliente, nombre, apellido_paterno, apellido_materno, cuenta_ibkr')
        .eq('codigo_cliente', cliente.codigo_cotitular)
        .maybeSingle()
    : { data: null };

  const nombreCotitular = cotitular
    ? [cotitular.nombre, cotitular.apellido_paterno, cotitular.apellido_materno]
        .filter(Boolean).join(' ')
    : '';

  const nombre = [cliente.nombre, cliente.apellido_paterno, cliente.apellido_materno]
    .filter(Boolean).join(' ');

  const revision = evaluarRevisionAnual(cliente);
  const cartaFirmada = Boolean(cliente.carta_sofisticado_firmada);

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
        <div>
          <h1 className="text-2xl font-semibold">
            {nombre || <span className="text-slate-400 italic">Sin nombre capturado</span>}
          </h1>

          {cliente.es_conjunta && (
            <p className="flex flex-wrap items-center gap-2 mt-1.5 text-sm text-slate-600">
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                Cuenta conjunta
              </span>
              {cotitular ? (
                <span>
                  Cotitular:{' '}
                  <Link
                    href={`/cliente/${cotitular.codigo_cliente}`}
                    className="text-slate-900 underline underline-offset-2 hover:text-slate-600"
                  >
                    {nombreCotitular || 'Sin nombre capturado'}
                  </Link>{' '}
                  ({cotitular.codigo_cliente}
                  {cotitular.cuenta_ibkr ? ` · IBKR: ${cotitular.cuenta_ibkr}` : ''})
                </span>
              ) : cliente.codigo_cotitular ? (
                <span className="text-amber-700">
                  Cotitular {cliente.codigo_cotitular} no encontrado
                </span>
              ) : (
                <span className="text-amber-700">Sin cotitular capturado</span>
              )}
            </p>
          )}
        </div>

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

      <section className="mt-8">
        <h2 className="text-lg font-semibold mb-3">Cumplimiento</h2>

        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          <div className="flex px-4 py-3">
            <span className="w-48 text-sm text-slate-500">Fecha de aniversario</span>
            <span className="text-sm text-slate-900">
              {formatearFecha(cliente.fecha_aniversario) ?? (
                <span className="text-slate-300">—</span>
              )}
            </span>
          </div>

          <div className="flex px-4 py-3">
            <span className="w-48 text-sm text-slate-500">Última revisión registrada</span>
            <span className="text-sm text-slate-900">
              {formatearFecha(cliente.fecha_ultima_revision) ?? (
                <span className="text-slate-400 italic">Sin registro previo</span>
              )}
            </span>
          </div>

          <div className="px-4 py-3">
            <div className="flex">
              <span className="w-48 text-sm text-slate-500">Estado de la revisión</span>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${revision.clases}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${revision.punto}`} />
                {revision.etiqueta}
              </span>
            </div>
            {revision.detalle && (
              <p className="text-sm text-slate-600 mt-1.5 ml-48">{revision.detalle}</p>
            )}
            {revision.nota && (
              <p className="text-sm text-slate-500 mt-1.5 ml-48">{revision.nota}</p>
            )}
          </div>

          <div className="flex px-4 py-3">
            <span className="w-48 text-sm text-slate-500">Próxima revisión estimada</span>
            <span className="text-sm text-slate-900">
              {formatearFecha(revision.proximaRevision) ?? (
                <span className="text-slate-400 italic">Sin fecha de aniversario capturada</span>
              )}
            </span>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-slate-700 mt-6 mb-2">
          Carta de cliente sofisticado
        </h3>

        <div className="border border-slate-200 rounded-lg px-4 py-3">
          {cartaFirmada ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                Carta en expediente
              </span>
              {cliente.carta_sofisticado_url ? (
                <a
                  href={cliente.carta_sofisticado_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-slate-900 underline underline-offset-2 hover:text-slate-600"
                >
                  Ver carta ↗
                </a>
              ) : (
                <span className="text-sm text-amber-700">
                  Marcada como firmada, pero sin liga al documento.
                </span>
              )}
            </div>
          ) : (
            <div>
              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                Sin carta
              </span>
              <p className="text-sm text-slate-600 mt-2">
                Sin la carta del Anexo 1 Apartado A el cliente es categoría 204, sin
                importar su patrimonio. La carta es constitutiva.
              </p>
            </div>
          )}
        </div>
      </section>

      <PerfilIA codigo={codigo} inicial={perfilRiesgo?.perfil_ia ?? null} />
      <CalcularIPS codigo={codigo} inicial={ipsGuardado} />
      <EvaluarEBR codigo={codigo} />
      <GenerarPortafolio codigo={codigo} />
    </main>
  );
}
