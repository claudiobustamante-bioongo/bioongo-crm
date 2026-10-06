'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DETERMINABLES_POR_ASESOR,
  NOMBRE_CLASIFICACION,
  validarDeterminacion,
  type ClasificacionDeterminable,
} from '@/lib/clasificacion';

/**
 * Determinación de la clasificación del inversionista (R03, campo 6) por el
 * asesor: 201, 202 o 204, con nota obligatoria. La registra
 * /api/determinar-clasificacion con el usuario de la sesión y asiento en
 * bitácora.
 *
 * 203 no se ofrece: Sofisticado solo viene de la carta firmada.
 */
export default function DeterminarClasificacion() {
  const { codigo } = useParams<{ codigo: string }>();
  const router = useRouter();
  const [clasificacion, setClasificacion] = useState<ClasificacionDeterminable | ''>('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  async function registrar() {
    const v = validarDeterminacion({ clasificacion, nota });
    if (!v.ok) {
      setMensaje(v.error);
      return;
    }

    setEnviando(true);
    setMensaje('');
    const res = await fetch('/api/determinar-clasificacion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo_cliente: codigo, clasificacion: v.clasificacion, nota: v.nota }),
    });
    const cuerpo = await res.json().catch(() => ({}));
    setEnviando(false);

    if (!res.ok) {
      setMensaje(cuerpo.error ?? `Error ${res.status}`);
      return;
    }
    router.push(`/cliente/${codigo}`);
  }

  return (
    <main className="p-8 max-w-xl mx-auto">
      <Link href={`/cliente/${codigo}`} className="text-sm text-slate-500 hover:text-slate-800">← Cancelar</Link>
      <h1 className="text-2xl font-semibold mt-4 mb-2">Clasificación de {codigo}</h1>
      <p className="text-sm text-slate-600 mb-6">
        Clasificación del inversionista para el R03 J-0315, campo 6. Queda registrada como
        determinación del asesor, con tu usuario, la fecha de hoy y la nota.{' '}
        <strong>Sofisticado (203) no se determina aquí:</strong> solo viene de la carta del
        Anexo 1 Apartado A firmada por el cliente.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="clasificacion" className="text-sm text-slate-600">Clasificación</label>
          <select
            id="clasificacion"
            value={clasificacion}
            onChange={(e) => setClasificacion(e.target.value as ClasificacionDeterminable | '')}
            className="border border-slate-300 rounded px-3 py-2 bg-white"
          >
            <option value="">— Elige —</option>
            {DETERMINABLES_POR_ASESOR.map((c) => (
              <option key={c} value={c}>
                {c} · {NOMBRE_CLASIFICACION[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="nota" className="text-sm text-slate-600">
            Nota <span className="text-red-600">(obligatoria)</span>
          </label>
          <textarea
            id="nota"
            rows={4}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Por qué el cliente tiene esta clasificación y con qué evidencia."
            className="border border-slate-300 rounded px-3 py-2"
          />
        </div>
        <button
          onClick={registrar}
          disabled={enviando}
          className="bg-slate-900 text-white rounded py-2 hover:bg-slate-700 disabled:opacity-50"
        >
          {enviando ? 'Registrando…' : 'Registrar clasificación'}
        </button>
        {mensaje && <p className="text-sm text-red-600 mt-2">{mensaje}</p>}
      </div>
    </main>
  );
}
