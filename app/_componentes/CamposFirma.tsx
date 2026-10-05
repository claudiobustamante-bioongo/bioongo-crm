'use client';

import { NOMBRE_ROL, ROLES_FIRMA, type RolFirma } from '@/lib/firma';

/**
 * Los campos de una firma de cumplimiento: rol, declaración y, al levantar un
 * bloqueo con rol de asesor, la autorización del Oficial.
 *
 * Lo usan la bandeja de coincidencias (confirmar y descartar) y la ficha del
 * cliente (levantar). La carpeta empieza con `_` para que Next no la trate como
 * ruta.
 *
 * El rol NO trae valor por omisión: se declara cada vez, a propósito. Quién
 * firma no se pide: lo pone la base con el usuario de la sesión.
 */

export interface ValorFirma {
  rol: RolFirma | '';
  declaracion: string;
  autorizacion_oficial: string;
}

export const FIRMA_VACIA: ValorFirma = { rol: '', declaracion: '', autorizacion_oficial: '' };

export default function CamposFirma({
  id,
  valor,
  onChange,
  deshabilitado,
  levantamiento = false,
}: {
  id: string;
  valor: ValorFirma;
  onChange: (v: ValorFirma) => void;
  deshabilitado?: boolean;
  levantamiento?: boolean;
}) {
  const pideAutorizacion = levantamiento && valor.rol === 'asesor';

  return (
    <fieldset className="border border-slate-200 bg-white rounded px-3 py-3 mt-3" disabled={deshabilitado}>
      <legend className="px-1 text-xs uppercase tracking-wide text-slate-500">Firma</legend>

      <label className="block text-sm text-slate-600 mb-1" htmlFor={`rol-${id}`}>
        Firmo como <span className="text-red-600">(obligatorio)</span>
      </label>
      <select
        id={`rol-${id}`}
        value={valor.rol}
        onChange={(e) => onChange({ ...valor, rol: e.target.value as RolFirma | '' })}
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white disabled:opacity-50"
      >
        <option value="">— Elige tu rol —</option>
        {ROLES_FIRMA.map((r) => (
          <option key={r} value={r}>
            {NOMBRE_ROL[r]}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500 mt-1">
        El rol se declara y queda asentado con tu usuario; todavía no se verifica contra un
        registro de roles.
      </p>

      <label className="block text-sm text-slate-600 mt-3 mb-1" htmlFor={`declaracion-${id}`}>
        Declaración <span className="text-red-600">(obligatoria)</span>
      </label>
      <textarea
        id={`declaracion-${id}`}
        value={valor.declaracion}
        onChange={(e) => onChange({ ...valor, declaracion: e.target.value })}
        rows={2}
        placeholder="Lo que revisaste y asumes como propio al firmar."
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white disabled:opacity-50"
      />

      {pideAutorizacion && (
        <>
          <label className="block text-sm text-slate-600 mt-3 mb-1" htmlFor={`autorizacion-${id}`}>
            Autorización del Oficial de Cumplimiento <span className="text-red-600">(obligatoria)</span>
          </label>
          <input
            id={`autorizacion-${id}`}
            value={valor.autorizacion_oficial}
            onChange={(e) => onChange({ ...valor, autorizacion_oficial: e.target.value })}
            placeholder="Quién autorizó, cuándo y por qué medio."
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white disabled:opacity-50"
          />
          <p className="text-xs text-slate-500 mt-1">
            Levantar un bloqueo por sanciones es decisión del Oficial. Si firmas como asesor,
            declara su autorización.
          </p>
        </>
      )}
    </fieldset>
  );
}
