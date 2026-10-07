'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { buscarChoques, validarAltaCliente } from '@/lib/codigo-cliente';

/**
 * Alta manual de un cliente.
 *
 * El código sigue la regla de códigos nuevos (migraciones/README.md): CSPFU +
 * 2 primeros dígitos de la cuenta IBKR + 2 últimos del año de nacimiento. La
 * cuenta es obligatoria (un prospecto sin cuenta entra por /captura con LEAD-)
 * y la fecha opcional. Antes de insertar se valida la forma, que los dígitos
 * salgan de la cuenta y, si hay fecha, del año, y que ni el código choque con
 * clientes o codigos_alias ni la cuenta con otro cliente. Si algo no coincide,
 * se avisa y no se guarda. El choque con IDs ya reportados en el R03 se revisa
 * a mano.
 */
const FORM_VACIO = {
  codigo_cliente: '',
  cuenta_ibkr: '',
  fecha_nacimiento: '',
  nombre: '',
  apellido_paterno: '',
  apellido_materno: '',
  correo: '',
  celular: '',
  rfc: '',
};

export default function NuevoCliente() {
  const [form, setForm] = useState(FORM_VACIO);
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);

  const supabase = createClient();

  function actualizar(campo: string, valor: string) {
    setForm({ ...form, [campo]: valor });
  }

  async function guardar() {
    const validacion = validarAltaCliente({
      codigo: form.codigo_cliente,
      cuenta: form.cuenta_ibkr,
      fecha: form.fecha_nacimiento,
    });
    if (!validacion.ok) {
      setMensaje('Error: ' + validacion.error);
      return;
    }

    setGuardando(true);
    setMensaje('');
    try {
      const { choques, error: errorChoques } = await buscarChoques(
        supabase,
        validacion.codigo,
        validacion.cuenta,
      );
      if (errorChoques) {
        setMensaje('Error: no se pudo comprobar si el código o la cuenta ya existen. No se guardó nada.');
        return;
      }
      const choquesCodigo = choques.filter((c) => c !== 'cuenta_ibkr');
      if (choquesCodigo.length > 0) {
        setMensaje(
          `Error: el código ${validacion.codigo} ya existe en ${choquesCodigo.join(' y ')}. ` +
            'Si dos clientes dan el mismo código por la regla, se decide a mano.',
        );
        return;
      }
      if (choques.includes('cuenta_ibkr')) {
        setMensaje(
          `Error: la cuenta ${validacion.cuenta} ya está asignada a otro cliente. No se guardó nada.`,
        );
        return;
      }

      const { error } = await supabase.from('clientes').insert({
        ...form,
        codigo_cliente: validacion.codigo,
        cuenta_ibkr: validacion.cuenta,
        fecha_nacimiento: validacion.fecha,
      });
      if (error) {
        setMensaje('Error: ' + error.message);
      } else {
        setMensaje(`Cliente ${validacion.codigo} guardado ✓`);
        setForm(FORM_VACIO);
      }
    } finally {
      setGuardando(false);
    }
  }

  const campos = [
    { key: 'codigo_cliente', label: 'Código de cliente (CSPFU + 4 dígitos)' },
    { key: 'cuenta_ibkr', label: 'Cuenta IBKR (U + dígitos)' },
    { key: 'fecha_nacimiento', label: 'Fecha de nacimiento (AAAA-MM-DD, opcional)' },
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
          de nacimiento. Siempre CSPF. Sin cuenta no hay código definitivo: un prospecto sin
          cuenta se captura en /captura con LEAD-.
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
