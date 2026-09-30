'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { hoyCDMX } from '@/lib/baja';

/**
 * Flujo propio de la baja: pide fecha y motivo, los dos obligatorios, y deja
 * asiento en bitácora (lo hace /api/dar-baja). No borra nada: el expediente se
 * conserva por PLD y deja de entrar al alcance «todos» de los masivos.
 */
export default function DarDeBaja() {
  const { codigo } = useParams<{ codigo: string }>();
  const router = useRouter();
  const [fecha, setFecha] = useState(() => hoyCDMX());
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const completo = fecha.trim() !== '' && motivo.trim() !== '';

  async function registrar() {
    if (!completo) return;
    const ok = window.confirm(
      `¿Registrar la baja de ${codigo}? Desde la aplicación no se puede revertir.`,
    );
    if (!ok) return;

    setEnviando(true);
    setMensaje('');
    const res = await fetch('/api/dar-baja', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo_cliente: codigo, fecha_baja: fecha, motivo_baja: motivo }),
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
      <Link href={`/cliente/${codigo}/editar`} className="text-sm text-slate-500 hover:text-slate-800">← Cancelar</Link>
      <h1 className="text-2xl font-semibold mt-4 mb-2">Dar de baja {codigo}</h1>
      <p className="text-sm text-slate-600 mb-6">
        La baja no borra el expediente: se conserva por obligación PLD. El cliente deja de
        entrar al alcance «todos» del EBR y del IPS masivos.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="fecha_baja" className="text-sm text-slate-600">Fecha de baja</label>
          <input
            id="fecha_baja"
            type="date"
            required
            max={hoyCDMX()}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2"
          />
          <p className="text-xs text-slate-500">
            Es la fecha en que se registra la baja en el expediente, no necesariamente la del
            cierre de la cuenta. Si el cierre tiene otra fecha, o no está documentada, dilo en
            el motivo.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="motivo_baja" className="text-sm text-slate-600">Motivo de baja</label>
          <textarea
            id="motivo_baja"
            required
            rows={4}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2"
          />
        </div>
        <button
          onClick={registrar}
          disabled={!completo || enviando}
          className="border border-red-400 text-red-700 bg-white rounded py-2 hover:bg-red-50 disabled:opacity-50"
        >
          {enviando ? 'Registrando…' : 'Registrar baja'}
        </button>
        {mensaje && <p className="text-sm text-red-600 mt-2">{mensaje}</p>}
      </div>
    </main>
  );
}
