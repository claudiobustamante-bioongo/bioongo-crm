'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import Link from 'next/link';
import { STATUS_EDITABLES, datosParaGuardar, esBaja } from '@/lib/status-cliente';

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
];

/**
 * `status` va aparte, en un selector con los valores del CHECK menos 'baja'. La
 * baja tiene su propio flujo (pide fecha y motivo, deja bitácora), y con un
 * cliente ya de baja el status se muestra y no se envía.
 *
 * Esta pantalla no borra clientes: el expediente se conserva por PLD y la
 * política DELETE de `clientes` se retiró el 30-sep-2026.
 */
const CAMPO_STATUS = 'status';

export default function EditarCliente() {
  const { codigo } = useParams<{ codigo: string }>();
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [mensaje, setMensaje] = useState('');
  const [statusActual, setStatusActual] = useState<string | null>(null);

  const supabase = createClient();

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
        limpio[CAMPO_STATUS] = data[CAMPO_STATUS] ?? '';
        setForm(limpio);
        setStatusActual(data[CAMPO_STATUS] ?? null);
      }
      setCargando(false);
    }
    cargar();
  }, [codigo]);

  async function guardar() {
    const datos = datosParaGuardar(form, statusActual);

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
        <div className="flex flex-col gap-1">
          <label className="text-sm text-slate-600">Status</label>
          {esBaja(statusActual) ? (
            <p className="border border-slate-200 bg-slate-50 rounded px-3 py-2 text-slate-600">
              baja — se gestiona desde su propio flujo, no desde esta pantalla
            </p>
          ) : (
            <select
              value={form[CAMPO_STATUS] ?? ''}
              onChange={(e) => setForm({ ...form, [CAMPO_STATUS]: e.target.value })}
              className="border border-slate-300 rounded px-3 py-2"
            >
              {/* Un status vacío o fuera del CHECK se ve, no se disfraza. */}
              {!STATUS_EDITABLES.includes(form[CAMPO_STATUS] as (typeof STATUS_EDITABLES)[number]) && (
                <option value={form[CAMPO_STATUS] ?? ''} disabled>
                  {form[CAMPO_STATUS] || '(sin status)'}
                </option>
              )}
              {STATUS_EDITABLES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {!esBaja(statusActual) && (
            <Link href={`/cliente/${codigo}/baja`} className="text-xs text-red-700 hover:underline self-start">
              Dar de baja →
            </Link>
          )}
        </div>
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
