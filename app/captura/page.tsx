'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

const VACIO = { nombre: '', correo: '', celular: '' };

function generarCodigo() {
  const n = Math.floor(Math.random() * 100000);
  return 'LEAD-' + String(n).padStart(5, '0');
}

export default function Captura() {
  const [form, setForm] = useState(VACIO);
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);

  const supabase = createClient();

  function actualizar(campo: string, valor: string) {
    setForm({ ...form, [campo]: valor });
  }

  async function enviar() {
    if (!form.nombre.trim() || !form.correo.trim() || !form.celular.trim()) {
      setMensaje('Completa los tres campos.');
      return;
    }

    setGuardando(true);
    setMensaje('');

    // Reintenta con otro código si el aleatorio ya existía
    let error = null;
    for (let intento = 0; intento < 3; intento++) {
      const res = await supabase.from('clientes').insert({
        codigo_cliente: generarCodigo(),
        nombre: form.nombre.trim(),
        correo: form.correo.trim(),
        celular: form.celular.trim(),
        status: 'lead_nuevo',
      });
      error = res.error;
      if (!error || error.code !== '23505') break;
    }

    setGuardando(false);

    if (error) {
      setMensaje('Error: ' + error.message);
    } else {
      setMensaje('¡Gracias! Recibimos tus datos ✓');
      setForm(VACIO);
    }
  }

  const campos = [
    { key: 'nombre', label: 'Nombre completo', type: 'text' },
    { key: 'correo', label: 'Correo', type: 'email' },
    { key: 'celular', label: 'Celular', type: 'tel' },
  ];

  return (
    <main className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Déjanos tus datos</h1>
      <p className="text-sm text-slate-600 mb-6">
        Un asesor de Bioongo te contactará.
      </p>
      <div className="flex flex-col gap-3">
        {campos.map((c) => (
          <div key={c.key} className="flex flex-col gap-1">
            <label className="text-sm text-slate-600">{c.label}</label>
            <input
              type={c.type}
              value={form[c.key as keyof typeof form]}
              onChange={(e) => actualizar(c.key, e.target.value)}
              className="border border-slate-300 rounded px-3 py-2"
            />
          </div>
        ))}
        <button
          onClick={enviar}
          disabled={guardando}
          className="bg-slate-900 text-white rounded py-2 mt-2 hover:bg-slate-700 disabled:opacity-50"
        >
          {guardando ? 'Enviando…' : 'Enviar'}
        </button>
        {mensaje && <p className="text-sm mt-2">{mensaje}</p>}
      </div>
    </main>
  );
}
