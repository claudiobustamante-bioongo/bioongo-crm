'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { validarFirma } from '@/lib/firma';
import CamposFirma, { FIRMA_VACIA, type ValorFirma } from '@/app/_componentes/CamposFirma';

/**
 * Levantar el bloqueo de un cliente, con firma.
 *
 * Pide motivo, rol y declaración; si el rol es asesor, también la autorización
 * del Oficial de Cumplimiento (regla del 5-oct-2026, que la base impone por
 * CHECK). Al terminar no guarda nada en React: refresca la ficha y la banda
 * desaparece porque la base ya no tiene el bloqueo abierto.
 */
export default function LevantarBloqueo({ bloqueoId }: { bloqueoId: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [firma, setFirma] = useState<ValorFirma>(FIRMA_VACIA);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  async function levantar() {
    if (!motivo.trim()) {
      setError('El motivo es obligatorio: por qué ya no procede el bloqueo, con la evidencia.');
      return;
    }
    const v = validarFirma(firma, { levantamiento: true });
    if (!v.ok) {
      setError(v.error);
      return;
    }

    setOcupado(true);
    setError('');
    try {
      const res = await fetch('/api/levantar-bloqueo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bloqueo_id: bloqueoId,
          motivo: motivo.trim(),
          rol: v.firma.rol,
          declaracion: v.firma.declaracion,
          autorizacion_oficial: v.firma.autorizacion_oficial,
        }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setError('Tu sesión expiró. Vuelve a entrar y reintenta.');
        return;
      }
      const datos = await res.json();
      if (!res.ok) {
        setError(datos.error ?? 'No se pudo levantar el bloqueo.');
        return;
      }
      router.refresh();
    } catch {
      setError('No se pudo contactar al servidor.');
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="mt-3 border border-red-700 text-red-800 bg-white px-4 py-2 rounded text-sm hover:bg-red-100"
      >
        Levantar bloqueo…
      </button>
    );
  }

  return (
    <div className="mt-3 border border-red-200 bg-white rounded px-3 py-3">
      <label className="block text-sm text-slate-600 mb-1" htmlFor={`motivo-levantar-${bloqueoId}`}>
        Motivo del levantamiento <span className="text-red-600">(obligatorio)</span>
      </label>
      <textarea
        id={`motivo-levantar-${bloqueoId}`}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        disabled={ocupado}
        rows={2}
        placeholder="Por qué ya no procede el bloqueo y con qué evidencia (p. ej., homonimia acreditada)."
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white disabled:opacity-50"
      />

      <CamposFirma
        id={`levantar-${bloqueoId}`}
        valor={firma}
        onChange={setFirma}
        deshabilitado={ocupado}
        levantamiento
      />

      <div className="flex flex-wrap gap-2 mt-3">
        <button
          onClick={levantar}
          disabled={ocupado}
          className="bg-red-700 text-white px-4 py-2 rounded text-sm hover:bg-red-800 disabled:opacity-50"
        >
          {ocupado ? 'Levantando…' : 'Firmar y levantar el bloqueo'}
        </button>
        <button
          onClick={() => setAbierto(false)}
          disabled={ocupado}
          className="border border-slate-300 bg-white px-4 py-2 rounded text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
