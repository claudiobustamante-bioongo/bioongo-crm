'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function NuevoCliente() {
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');

  async function guardar() {
    const { error } = await supabase
      .from('clientes')
      .insert({ codigo_cliente: codigo, nombre_completo: nombre });

    if (error) {
      alert('Error: ' + error.message);
    } else {
      alert('Cliente guardado');
      setCodigo('');
      setNombre('');
    }
  }

  return (
    <main className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Nuevo cliente</h1>
      <div className="flex flex-col gap-4">
        <input
          type="text"
          placeholder="Código (ej. CABZ-003)"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          className="border border-slate-300 rounded px-4 py-2"
        />
        <input
          type="text"
          placeholder="Nombre completo"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="border border-slate-300 rounded px-4 py-2"
        />
        <button
          onClick={guardar}
          className="bg-slate-900 text-white rounded py-2 hover:bg-slate-700"
        >
          Guardar cliente
        </button>
      </div>
    </main>
  );
}