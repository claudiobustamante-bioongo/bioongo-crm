'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TipoLista } from '@/lib/listas';

// `import type` se borra al compilar. Importa aquí: importar `lib/listas` como
// valor arrastraría al bundle del cliente el parser de CSV, la tabla de alias
// de encabezados y el motor de cotejo. Nada de eso corre en el navegador — el
// archivo se sube crudo y lo parsea la ruta.

/** Solo las etiquetas. La obligatoriedad la deriva el servidor con `esObligatoria()`. */
const ETIQUETAS: Record<TipoLista, string> = {
  LPB: 'LPB — Lista de Personas Bloqueadas (SHCP vía CNBV)',
  PEP_NACIONAL: 'PEP nacionales',
  OFAC: 'OFAC — Office of Foreign Assets Control',
  SAT_69B: 'SAT 69-B — presuntas operaciones inexistentes',
  ONU: 'ONU — Consejo de Seguridad',
};

/** Sentinel de «aún no elegido». El tipo no tiene default a propósito. */
const SIN_ELEGIR = '';

interface Respuesta {
  lista?: { id: string; tipo: string; obligatoria: boolean; fecha_lista: string };
  registros?: {
    insertados: number;
    filas_sin_nombre: number;
    filas_vacias: number;
    columnas_detectadas: Record<string, string | null>;
    delimitador: string;
  };
  coincidencias?: { total: number; por_tipo_match: Record<string, number>; clientes_afectados: string[] };
  clientes_cotejados?: { total: number; por_status: Record<string, number> };
  listas_retiradas?: Array<{ id: string }>;
  avisos?: string[];
  alerta?: string;
  error?: string;
}

export default function CargarLista({
  tipos,
  topeBytes,
}: {
  tipos: Array<{ tipo: TipoLista; obligatoria: boolean }>;
  topeBytes: number;
}) {
  const router = useRouter();
  const archivoRef = useRef<HTMLInputElement>(null);

  const [tipo, setTipo] = useState<string>(SIN_ELEGIR);
  const [fuente, setFuente] = useState('');
  const [fechaLista, setFechaLista] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [tamano, setTamano] = useState(0);

  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<Respuesta | null>(null);

  const elegido = tipos.find((t) => t.tipo === tipo);
  const excedeTope = tamano >= topeBytes;

  async function cargar() {
    const archivo = archivoRef.current?.files?.[0];
    if (!archivo) {
      setError('Elige el archivo CSV.');
      return;
    }

    // Cargar una lista obligatoria la deja vigente y cambia lo que la página de
    // arriba dice sobre el cumplimiento del III.10. No es un paso que se deba
    // dar de un clic distraído.
    if (
      elegido?.obligatoria &&
      !window.confirm(
        `${tipo} es una lista OBLIGATORIA del apartado III.10. Al cargarla quedará como ` +
          'vigente y la carga anterior de este tipo se retirará. ¿Continuar?'
      )
    ) {
      return;
    }

    setCargando(true);
    setError('');
    setResultado(null);

    try {
      const cuerpo = new FormData();
      cuerpo.append('archivo', archivo);
      cuerpo.append('tipo', tipo);
      cuerpo.append('fuente', fuente.trim());
      cuerpo.append('fecha_lista', fechaLista);
      if (observaciones.trim()) cuerpo.append('observaciones', observaciones.trim());

      const res = await fetch('/api/cargar-lista', { method: 'POST', body: cuerpo });

      // Sin sesión el middleware redirige a /login y responde HTML, no JSON.
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setError('Tu sesión expiró. Vuelve a entrar y reintenta.');
        return;
      }

      const datos: Respuesta = await res.json();

      if (!res.ok) {
        setError(datos.error ?? 'No se pudo cargar la lista.');
        // Los avisos del parser también importan cuando falla: dicen qué
        // columnas se reconocieron y cuáles no.
        if (datos.avisos?.length) setResultado(datos);
        return;
      }

      setResultado(datos);
      setNombreArchivo('');
      setTamano(0);
      if (archivoRef.current) archivoRef.current.value = '';
      // El historial y la bandeja los pinta el servidor: hay que reconsultarlos.
      router.refresh();
    } catch {
      setError('No se pudo contactar al servidor. Revisa tu sesión y vuelve a intentar.');
    } finally {
      setCargando(false);
    }
  }

  const listo = tipo !== SIN_ELEGIR && fuente.trim() !== '' && fechaLista !== '' && nombreArchivo !== '';

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold mb-3">Cargar una lista</h2>

      <div className="border border-slate-200 rounded-lg px-4 py-4 space-y-3">
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="tipo-lista">
            Tipo de lista
          </label>
          <select
            id="tipo-lista"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            disabled={cargando}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value={SIN_ELEGIR}>Elige el tipo…</option>
            {tipos.map((t) => (
              <option key={t.tipo} value={t.tipo}>
                {ETIQUETAS[t.tipo]}
              </option>
            ))}
          </select>

          {elegido && (
            <p
              className={`text-sm mt-1.5 ${
                elegido.obligatoria ? 'text-amber-800' : 'text-slate-500'
              }`}
            >
              {elegido.obligatoria
                ? 'Lista obligatoria del apartado III.10. Al cargarla queda vigente y se retira la anterior de este tipo.'
                : 'Diligencia adicional. NO cubre la obligación del apartado III.10.'}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="archivo-lista">
            Archivo CSV
          </label>
          <input
            id="archivo-lista"
            ref={archivoRef}
            type="file"
            accept=".csv,text/csv"
            disabled={cargando}
            onChange={(e) => {
              const f = e.target.files?.[0];
              setNombreArchivo(f?.name ?? '');
              setTamano(f?.size ?? 0);
              setError('');
            }}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm disabled:opacity-50"
          />
          {nombreArchivo && (
            <p className={`text-sm mt-1.5 ${excedeTope ? 'text-red-700' : 'text-slate-500'}`}>
              {nombreArchivo} · {(tamano / 1024).toFixed(0)} KB
              {/* Se avisa antes de subir. El servidor rechaza igual: al pasarse
                  del tope, Next trunca el cuerpo sin error y la lista quedaría
                  incompleta pareciendo completa. */}
              {excedeTope &&
                ` · excede el tope de ${Math.floor(topeBytes / 1024 / 1024)} MB. No se sube: se cargaría truncada.`}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm text-slate-600 mb-1" htmlFor="fuente-lista">
              Fuente
            </label>
            <input
              id="fuente-lista"
              type="text"
              value={fuente}
              onChange={(e) => setFuente(e.target.value)}
              disabled={cargando}
              placeholder="p. ej. SHCP vía CNBV"
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-1" htmlFor="fecha-lista">
              Fecha de corte de la lista
            </label>
            <input
              id="fecha-lista"
              type="date"
              value={fechaLista}
              onChange={(e) => setFechaLista(e.target.value)}
              disabled={cargando}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="observaciones-lista">
            Observaciones <span className="text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="observaciones-lista"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            disabled={cargando}
            rows={2}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>

        <button
          onClick={cargar}
          disabled={cargando || !listo || excedeTope}
          className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          {cargando ? 'Cargando y cotejando…' : 'Cargar y cotejar'}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {/* --- Resultado -------------------------------------------------------- */}

      {resultado?.registros && (
        <div className="border border-slate-200 rounded-lg px-4 py-4 mt-3 space-y-3">
          <p className="text-sm text-slate-900">
            <strong>{resultado.registros.insertados}</strong> registros cargados y cotejados
            contra <strong>{resultado.clientes_cotejados?.total ?? 0}</strong> clientes.
          </p>

          {resultado.clientes_cotejados && (
            <p className="text-xs text-slate-500">
              Se coteja a toda la cartera, sin filtrar por status:{' '}
              {Object.entries(resultado.clientes_cotejados.por_status)
                .map(([s, n]) => `${s} ${n}`)
                .join(' · ')}
            </p>
          )}

          {resultado.alerta && (
            <p className="border border-red-300 bg-red-50 rounded px-3 py-2 text-sm text-red-900">
              <strong>{resultado.alerta}</strong>
            </p>
          )}

          <p className="text-sm text-slate-800">
            {resultado.coincidencias?.total
              ? `${resultado.coincidencias.total} coincidencia(s) pendiente(s) sobre ${resultado.coincidencias.clientes_afectados.length} cliente(s). Revísalas en la bandeja de abajo.`
              : 'Sin coincidencias.'}
          </p>

          {(resultado.registros.filas_sin_nombre > 0 || (resultado.avisos?.length ?? 0) > 0) && (
            <ul className="list-disc ml-5 text-xs text-amber-800 space-y-1">
              {resultado.avisos?.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}

          <p className="text-xs text-slate-400">
            Columnas reconocidas:{' '}
            {Object.entries(resultado.registros.columnas_detectadas)
              .filter(([, v]) => v)
              .map(([campo, encabezado]) => `${campo} ← "${encabezado}"`)
              .join(' · ') || 'ninguna'}{' '}
            · delimitador «{resultado.registros.delimitador}»
          </p>
        </div>
      )}
    </section>
  );
}
