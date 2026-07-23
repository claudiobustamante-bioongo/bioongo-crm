'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function NuevoCliente() {
  const [form, setForm] = useState({
    codigo_cliente: '',
    nombre: '',
    apellido_paterno: '',
    apellido_materno: '',
    correo: '',
    celular: '',
    rfc: '',
  });
  const [mensaje, setMensaje] = useState('');

  function actualizar(campo: string, valor: string) {
    setForm({ ...form, [campo]: valor });
  }

  async function guardar() {
    const { error } = await supabase.from('clientes').insert(form);
    if (error) {
      setMensaje('Error: ' + error.message);
    } else {
      setMensaje('Cliente guardado ✓');
      setForm({
        codigo_cliente: '', nombre: '', apellido_paterno: '',
        apellido_materno: '', correo: '', celular: '', rfc: '',
      });
    }
  }

  const campos = [
    { key: 'codigo_cliente', label: 'Código de cliente' },
    { key: 'nombre', label: 'Nombre(s)' },
    { key: 'apellido_paterno', label: 'Apellido paterno' },
    { key: 'apellido_materno', label: 'Apellido materno' },
    { key: 'correo', label: 'Correo' },
    { key: 'celular', label: 'Celular' },
    { key: 'rfc', label: 'RFC' },
  ];

  return (
    <main className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Nuevo cliente</h1>
      <div className="flex flex-col gap-3">
        {campos.map((c) => (
          <div key={c.key} className="flex flex-col gap-1">
            <label className="text-sm text-slate-600">{c.label}</label>
            <input
              type="text"
              value={form[c.key as keyof typeof form]}
              onChange={(e) => actualizar(c.key, e.target.value)}
              className="border border-slate-300 rounded px-3 py-2"
            />
          </div>
        ))}
        <button
          onClick={guardar}
          className="bg-slate-900 text-white rounded py-2 mt-2 hover:bg-slate-700"
        >
          Guardar cliente
        </button>
        {mensaje && <p className="text-sm mt-2">{mensaje}</p>}
      </div>
    </main>
  );
}