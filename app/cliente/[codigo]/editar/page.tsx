'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

const CAMPOS = [
  { key: 'nombre', label: 'Nombre(s)' },
  { key: 'apellido_paterno', label: 'Apellido paterno' },
  { key: 'apellido_materno', label: 'Apellido materno' },
  { key: 'genero', label: 'Género' },
  { key: 'fecha_nacimiento', label: 'Fecha nacimiento (AAAA-MM-DD)' },
  { key: 'rfc', label: 'RFC' },
  { key: 'curp', label: 'CURP' },
  { key: 'estado_civil', label: 'Estado civil' },
  { key: 'correo', label: 'Correo' },
  { key: 'celular', label: 'Celular' },
  { key: 'grado_estudios', label: 'Grado de estudios' },
  { key: 'ocupacion', label: 'Ocupación' },
  { key: 'status', label: 'Status (vigente / inactivo)' },
];

export default function EditarCliente() {
  const { codigo } = useParams<{ codigo: string }>();
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    async function cargar() {
      const { data } = await supabase
        .from('clientes')
        .select('*')
        .eq('codigo_cliente', codigo)
        .single();
      if (data) {
        const limpio: Record<string, string> = {};
        CAMPOS.forEach((c) => { limpio[c.key] = data[c.key] ?? ''; });
        setForm(limpio);
      }
      setCargando(false);
    }
    cargar();
  }, [codigo]);

  async function guardar() {
    const datos: Record<string, string | null> = {};
    Object.keys(form).forEach((k) => { datos[k] = form[k] === '' ? null : form[k]; });

    const { error } = await supabase
      .from('clientes')
      .update(datos)
      .eq('codigo_cliente', codigo);

    if (error) {
      setMensaje('Error: ' + error.message);
    } else {
      router.push(`/cliente/${codigo}`);
    }
  }

  if (cargando) return <main className="p-8 max-w-xl mx-auto">Cargando…</main>;

  return (
    <main className="p-8 max-w-xl mx-auto">
      <Link href={`/cliente/${codigo}`} className="text-sm text-slate-500 hover:text-slate-800">← Cancelar</Link>
      <h1 className="text-2xl font-semibold mt-4 mb-6">Editar {codigo}</h1>

      <div className="flex flex-col gap-3">
        {CAMPOS.map((c) => (
          <div key={c.key} className="flex flex-col gap-1">
            <label className="text-sm text-slate-600">{c.label}</label>
            <input
              type="text"
              value={form[c.key] ?? ''}
              onChange={(e) => setForm({ ...form, [c.key]: e.target.value })}
              className="border border-slate-300 rounded px-3 py-2"
            />
          </div>
        ))}
        <button
          onClick={guardar}
          className="bg-slate-900 text-white rounded py-2 mt-2 hover:bg-slate-700"
        >
          Guardar cambios
        </button>
        {mensaje && <p className="text-sm text-red-600 mt-2">{mensaje}</p>}
      </div>
    </main>
  );
}
