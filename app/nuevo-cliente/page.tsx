'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { buscarChoques, validarCodigoNuevo } from '@/lib/codigo-cliente';

/**
 * Alta manual de un cliente.
 *
 * El código sigue la regla de códigos nuevos (migraciones/README.md): CSPFU +
 * 2 primeros dígitos de la cuenta IBKR + 2 últimos del año de nacimiento. Antes
 * de insertar se valida la forma y se comprueba que no choque con clientes ni
 * con codigos_alias. Esta pantalla no pide cuenta ni fecha de nacimiento, así
 * que no puede comprobar que los dígitos salgan de ellas: eso queda a cargo de
 * quien captura. El choque con IDs ya reportados en el R03 se revisa a mano.
 */
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
  const [guardando, setGuardando] = useState(false);

  const supabase = createClient();

  function actualizar(campo: string, valor: string) {
    setForm({ ...form, [campo]: valor });
  }

  async function guardar() {
    const validacion = validarCodigoNuevo(form.codigo_cliente);
    if (!validacion.ok) {
      setMensaje('Error: ' + validacion.error);
      return;
    }

    setGuardando(true);
    setMensaje('');
    try {
      const { choques, error: errorChoques } = await buscarChoques(supabase, validacion.codigo);
      if (errorChoques) {
        setMensaje('Error: no se pudo comprobar si el código ya existe. No se guardó nada.');
        return;
      }
      if (choques.length > 0) {
        setMensaje(
          `Error: el código ${validacion.codigo} ya existe en ${choques.join(' y ')}. ` +
            'Si dos clientes dan el mismo código por la regla, se decide a mano.',
        );
        return;
      }

      const { error } = await supabase
        .from('clientes')
        .insert({ ...form, codigo_cliente: validacion.codigo });
      if (error) {
        setMensaje('Error: ' + error.message);
      } else {
        setMensaje(`Cliente ${validacion.codigo} guardado ✓`);
        setForm({
          codigo_cliente: '', nombre: '', apellido_paterno: '',
          apellido_materno: '', correo: '', celular: '', rfc: '',
        });
      }
    } finally {
      setGuardando(false);
    }
  }

  const campos = [
    { key: 'codigo_cliente', label: 'Código de cliente (CSPFU + 4 dígitos)' },
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
        <p className="text-xs text-slate-500">
          El código es CSPFU + los 2 primeros dígitos de la cuenta IBKR + los 2 últimos del año
          de nacimiento. Siempre CSPF.
        </p>
        <button
          onClick={guardar}
          disabled={guardando}
          className="bg-slate-900 text-white rounded py-2 mt-2 hover:bg-slate-700 disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Guardar cliente'}
        </button>
        {mensaje && <p className="text-sm mt-2">{mensaje}</p>}
      </div>
    </main>
  );
}
