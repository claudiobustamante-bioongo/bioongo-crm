'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  NOMBRE_TIPO_DOCUMENTO,
  TAMANO_MAXIMO_BYTES,
  TIPOS_DOCUMENTO,
  type TipoDocumento,
  esTipoDocumento,
  ligaDocumento,
} from '@/lib/documentos';

export interface DocumentoEnFicha {
  id: string;
  codigoCliente: string;
  tipo: string;
  fechaDocumento: string | null;
  creadoEn: string;
  subidoPor: string;
  reemplazado: boolean;
}

/** Qué hará «Registrar carta» con este cliente; lo decide la ficha con los datos de la base. */
export type ModoCarta = 'nueva' | 'adjuntar' | 'reemplazo' | 'no_disponible';

const TEXTO_MODO: Record<Exclude<ModoCarta, 'no_disponible'>, { boton: string; aviso: string }> = {
  nueva: {
    boton: 'Registrar carta firmada',
    aviso:
      'Al guardar, el cliente queda como 203 (Sofisticado) por carta firmada, con la fecha de ' +
      'firma que indiques. El status no cambia.',
  },
  adjuntar: {
    boton: 'Adjuntar PDF de la carta',
    aviso: 'El cliente ya es 203 por carta. Solo se adjunta el PDF; la clasificación no cambia.',
  },
  reemplazo: {
    boton: 'Reemplazar PDF de la carta',
    aviso:
      'Corrige el PDF de la carta ya archivada. El anterior se conserva marcado como reemplazado; ' +
      'la clasificación no cambia.',
  },
};

const TIPOS_ARCHIVO = TIPOS_DOCUMENTO.filter((t) => t !== 'carta_clasificacion');

function fechaCorta(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Sección «Documentos» de la ficha.
 *
 * Sube el PDF a POST /api/documentos (multipart). Las reglas viven en la base;
 * aquí solo se evita mandar lo que de seguro se rechaza (sin archivo, más de
 * 4 MB, carta sin fecha). Al terminar refresca la ficha: la lista, la
 * clasificación y la liga de la carta salen de la base, no de este estado.
 */
export default function Documentos({
  codigo,
  documentos,
  modoCarta,
  cartaVigenteId,
  hoy,
}: {
  codigo: string;
  documentos: DocumentoEnFicha[];
  modoCarta: ModoCarta;
  cartaVigenteId: string | null;
  hoy: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<'carta' | 'archivo' | null>(null);
  const [tipoArchivo, setTipoArchivo] = useState<TipoDocumento>('identificacion');
  const [fecha, setFecha] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  function cerrar() {
    setAbierto(null);
    setFecha('');
    setArchivo(null);
    setError('');
  }

  async function guardar() {
    const tipo: TipoDocumento = abierto === 'carta' ? 'carta_clasificacion' : tipoArchivo;
    if (!archivo) {
      setError('Elige el PDF.');
      return;
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      setError('El PDF excede 4 MB. Comprímelo antes de subirlo.');
      return;
    }
    if (tipo === 'carta_clasificacion' && !fecha) {
      setError('La carta exige su fecha de firma.');
      return;
    }

    const datos = new FormData();
    datos.set('codigo_cliente', codigo);
    datos.set('tipo', tipo);
    datos.set('fecha_documento', fecha);
    if (tipo === 'carta_clasificacion' && modoCarta === 'reemplazo' && cartaVigenteId) {
      datos.set('reemplaza_a', cartaVigenteId);
    }
    datos.set('archivo', archivo);

    setOcupado(true);
    setError('');
    setAviso('');
    try {
      const res = await fetch('/api/documentos', { method: 'POST', body: datos });
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setError('Tu sesión expiró. Vuelve a entrar y reintenta.');
        return;
      }
      const cuerpo = await res.json();
      if (!res.ok) {
        setError(cuerpo.error ?? 'No se pudo archivar el documento.');
        return;
      }
      const modo = cuerpo.documento?.modo as string | undefined;
      setAviso(
        modo === 'nueva'
          ? 'Carta registrada: el cliente quedó como 203 por carta firmada.'
          : modo === 'adjuntar'
            ? 'PDF de la carta adjuntado.'
            : modo === 'reemplazo'
              ? 'PDF de la carta reemplazado.'
              : 'Documento archivado.'
      );
      cerrar();
      router.refresh();
    } catch {
      setError('No se pudo contactar al servidor.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold mb-3">Documentos</h2>

      {documentos.length === 0 ? (
        <p className="text-sm text-slate-500 border border-slate-200 rounded-lg px-4 py-3">
          Sin documentos archivados en el expediente.
        </p>
      ) : (
        <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {documentos.map((d) => (
            <li key={d.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className={d.reemplazado ? 'text-slate-400 line-through' : 'text-slate-900'}>
                {esTipoDocumento(d.tipo) ? NOMBRE_TIPO_DOCUMENTO[d.tipo] : d.tipo}
              </span>
              <span className="text-slate-500">
                {d.fechaDocumento ? `fecha ${d.fechaDocumento}` : 'sin fecha'} · archivado{' '}
                {fechaCorta(d.creadoEn)} por {d.subidoPor}
              </span>
              {d.codigoCliente !== codigo && (
                <span className="text-xs text-slate-500">(archivado como {d.codigoCliente})</span>
              )}
              {d.reemplazado && (
                <span className="inline-block px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                  Reemplazado
                </span>
              )}
              <a
                href={ligaDocumento(d.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-slate-900 underline underline-offset-2 hover:text-slate-600"
              >
                Ver ↗
              </a>
            </li>
          ))}
        </ul>
      )}

      {aviso && <p className="text-sm text-green-700 mt-3">{aviso}</p>}

      {abierto === null ? (
        <div className="flex flex-wrap gap-2 mt-3">
          {modoCarta !== 'no_disponible' && (
            <button
              onClick={() => setAbierto('carta')}
              className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700"
            >
              {TEXTO_MODO[modoCarta].boton}
            </button>
          )}
          <button
            onClick={() => setAbierto('archivo')}
            className="border border-slate-300 px-4 py-2 rounded text-sm hover:bg-slate-50"
          >
            Archivar documento
          </button>
        </div>
      ) : (
        <div className="mt-3 border border-slate-200 rounded-lg px-4 py-4 space-y-3">
          {abierto === 'carta' && modoCarta !== 'no_disponible' ? (
            <p className="text-sm text-slate-700">{TEXTO_MODO[modoCarta].aviso}</p>
          ) : (
            <label className="block text-sm">
              <span className="text-slate-600">Tipo de documento</span>
              <select
                value={tipoArchivo}
                onChange={(e) => setTipoArchivo(e.target.value as TipoDocumento)}
                className="block mt-1 border border-slate-300 rounded px-2 py-1.5 text-sm"
              >
                {TIPOS_ARCHIVO.map((t) => (
                  <option key={t} value={t}>
                    {NOMBRE_TIPO_DOCUMENTO[t]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-sm">
            <span className="text-slate-600">
              {abierto === 'carta' ? 'Fecha de firma de la carta' : 'Fecha del documento (opcional)'}
            </span>
            <input
              type="date"
              value={fecha}
              max={hoy}
              onChange={(e) => setFecha(e.target.value)}
              className="block mt-1 border border-slate-300 rounded px-2 py-1.5 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600">PDF (máximo 4 MB)</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
              className="block mt-1 text-sm"
            />
          </label>

          <p className="text-xs text-slate-500">
            El archivo se guarda con un nombre armado por el sistema (tipo, código, fecha y huella),
            nunca con el nombre original.
          </p>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={guardar}
              disabled={ocupado}
              className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700 disabled:opacity-50"
            >
              {ocupado ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              onClick={cerrar}
              disabled={ocupado}
              className="border border-slate-300 px-4 py-2 rounded text-sm hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
