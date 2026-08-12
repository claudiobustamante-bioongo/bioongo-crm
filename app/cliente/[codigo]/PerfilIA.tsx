'use client';
import { useState } from 'react';

export default function PerfilIA({
  codigo,
  inicial,
}: {
  codigo: string;
  inicial: string | null;
}) {
  const [perfil, setPerfil] = useState(inicial ?? '');
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  async function generar() {
    setCargando(true);
    setMensaje('');

    try {
      const res = await fetch('/api/perfil-ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo_cliente: codigo }),
      });
      const datos = await res.json();

      if (!res.ok) {
        setMensaje(datos.error ?? 'No se pudo generar el perfil.');
      } else {
        setPerfil(datos.perfil_ia);
        if (datos.aviso) setMensaje(datos.aviso);
      }
    } catch {
      setMensaje('No se pudo contactar al servidor. Revisa tu sesión y vuelve a intentar.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">Perfil de riesgo (IA)</h2>
        <button
          onClick={generar}
          disabled={cargando}
          className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          {cargando ? 'Generando…' : perfil ? 'Regenerar con IA' : 'Generar perfil con IA'}
        </button>
      </div>

      {perfil ? (
        <p className="border border-slate-200 rounded-lg p-4 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
          {perfil}
        </p>
      ) : (
        <p className="text-sm text-slate-400 italic">Aún no se ha generado un perfil narrativo.</p>
      )}

      {mensaje && <p className="text-sm text-red-600 mt-2">{mensaje}</p>}
    </section>
  );
}
