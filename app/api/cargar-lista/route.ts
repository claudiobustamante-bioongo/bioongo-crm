import { createClient } from '@/lib/supabase-server';
import {
  ErrorLista,
  TIPOS_LISTA,
  buscarCoincidencias,
  TOPE_BODY_LISTA,
  decodificarCSV,
  esObligatoria,
  parsearCSV,
  type ClienteCotejable,
  type CoincidenciaDetectada,
  type TipoLista,
} from '@/lib/listas';
import { registrarEvento } from '@/lib/bitacora';

/**
 * POST /api/cargar-lista · multipart/form-data
 *
 * Campos: archivo (CSV), tipo, fuente, fecha_lista, observaciones?
 *
 * Carga una lista de control PLD/FT, la coteja contra la cartera completa y
 * deja las coincidencias en estado `pendiente`. No resuelve nada: decidir si
 * una coincidencia es la persona o un homónimo es del Asesor, y para eso está
 * /api/resolver-coincidencia.
 *
 * SE COTEJA A TODOS LOS CLIENTES, sin filtrar por status. El Manual habla de
 * «Clientes o prospectos de Clientes» sin distinguir situación operativa, y un
 * cliente inactivo que aparece en la Lista de Personas Bloqueadas es justo lo
 * que hay que ver. La respuesta trae el desglose por status para que se sepa
 * sobre qué universo se corrió.
 *
 * `obligatoria` NO se recibe: se deriva del tipo. Que alguien cargue OFAC
 * marcándola obligatoria y crea cumplido el apartado III.10 es un error que la
 * ruta no debe permitir cometer.
 *
 * LA LISTA NACE `vigente = false` y solo se promueve al terminar bien. Una LPB
 * a medias que se ve completa es peor que no tener lista: da una respuesta
 * tranquilizadora que nadie va a volver a cuestionar.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */

/** Filas por viaje. Suficiente para no hacer miles de round-trips. */
const LOTE = 500;


const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function texto(form: FormData, campo: string): string {
  const v = form.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

export async function POST(request: Request) {
  // --- 1. Tamaño, antes de tocar el cuerpo --------------------------------

  const declarado = Number(request.headers.get('content-length') ?? '');
  const hayTamano = Number.isFinite(declarado) && declarado > 0;

  if (hayTamano && declarado >= TOPE_BODY_LISTA) {
    return Response.json(
      {
        error:
          `El archivo excede el tope de ${Math.floor(TOPE_BODY_LISTA / 1024 / 1024)} MB que ` +
          'Next impone al cuerpo de la petición. No se carga a medias a propósito: ' +
          'al pasarse, el cuerpo se trunca sin error y la lista quedaría incompleta ' +
          'pareciendo completa. Sube `experimental.proxyClientMaxBodySize` en ' +
          'next.config.ts o parte el archivo.',
        bytes_declarados: declarado,
        tope_bytes: TOPE_BODY_LISTA,
      },
      { status: 413 }
    );
  }

  // --- 2. Formulario -------------------------------------------------------

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: 'El cuerpo no es multipart/form-data válido. Se espera el CSV en el campo `archivo`.' },
      { status: 400 }
    );
  }

  const archivo = form.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) {
    return Response.json({ error: 'Falta el archivo CSV en el campo `archivo`.' }, { status: 400 });
  }

  const tipo = texto(form, 'tipo').toUpperCase() as TipoLista;
  if (!TIPOS_LISTA.includes(tipo)) {
    return Response.json(
      { error: `Tipo de lista inválido. Debe ser uno de: ${TIPOS_LISTA.join(', ')}.` },
      { status: 400 }
    );
  }

  // `fuente` y `fecha_lista` son NOT NULL, y con razón: una lista sin origen ni
  // fecha de corte no sirve como evidencia de contra qué se cotejó.
  const fuente = texto(form, 'fuente');
  if (!fuente) {
    return Response.json(
      { error: 'Falta `fuente`: de dónde se obtuvo la lista (p. ej. "SHCP vía CNBV").' },
      { status: 400 }
    );
  }

  const fechaLista = texto(form, 'fecha_lista');
  if (!FECHA_ISO.test(fechaLista)) {
    return Response.json(
      { error: 'Falta `fecha_lista` o no tiene formato YYYY-MM-DD. Es la fecha de corte de la lista.' },
      { status: 400 }
    );
  }

  const observaciones = texto(form, 'observaciones') || null;

  // --- 3. Sesión -----------------------------------------------------------

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }
  const usuario = user.email ?? user.id;

  // --- 4. Parseo -----------------------------------------------------------

  // Se leen BYTES, no texto. `archivo.text()` decodifica siempre como UTF-8 y
  // en modo tolerante: un archivo en codificación heredada —como el «Listado
  // completo 69-B» del SAT, que viene en windows-1252— no fallaría, solo
  // dejaría U+FFFD donde había acentos. La carga se vería exitosa y lo escrito
  // serían nombres corruptos.
  let decodificado;
  try {
    decodificado = decodificarCSV(await archivo.arrayBuffer());
  } catch {
    console.error('cargar-lista: fallo al decodificar el archivo.');
    return Response.json(
      { error: 'No se pudo leer el archivo: su codificación no es UTF-8 ni windows-1252.' },
      { status: 400 }
    );
  }

  let csv;
  try {
    csv = parsearCSV(decodificado.texto);
  } catch (e) {
    // ErrorLista es archivo mal formado, no fallo del sistema: 400, y el
    // mensaje va tal cual al operador, que es quien puede corregirlo.
    if (e instanceof ErrorLista) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    console.error('cargar-lista: fallo al parsear el CSV.');
    return Response.json({ error: 'No se pudo leer el archivo.' }, { status: 400 });
  }

  if (csv.registros.length === 0) {
    return Response.json(
      { error: 'El archivo no tiene ningún registro con nombre.', avisos: csv.avisos },
      { status: 400 }
    );
  }

  const avisos = [...csv.avisos];

  // Que se haya usado el fallback no es un error, pero tampoco un detalle: dice
  // que el archivo no venía en UTF-8 y que los acentos se interpretaron bajo un
  // supuesto. Queda escrito para que se pueda auditar sin adivinar.
  if (decodificado.codificacion !== 'utf-8') {
    avisos.push(
      `El archivo no es UTF-8 válido: se decodificó como ${decodificado.codificacion}. ` +
        'Revisa que los acentos de los nombres se hayan guardado bien.'
    );
  }

  if (!hayTamano) {
    avisos.push(
      'La petición llegó sin Content-Length: no se pudo descartar que el archivo ' +
        'viniera truncado. Verifica que el número de registros cargados sea el esperado.'
    );
  }

  // --- 5. Cartera ----------------------------------------------------------

  const { data: clientes, error: errorClientes } = await supabase
    .from('clientes')
    .select('codigo_cliente, nombre, apellido_paterno, apellido_materno, rfc, curp, status');

  if (errorClientes || !clientes) {
    console.error('cargar-lista: fallo al leer la cartera.');
    return Response.json({ error: 'Error al leer la cartera de clientes.' }, { status: 500 });
  }

  const porStatus: Record<string, number> = {};
  for (const c of clientes) {
    const s = typeof c.status === 'string' ? c.status : 'sin_status';
    porStatus[s] = (porStatus[s] ?? 0) + 1;
  }

  // --- 6. Alta de la lista, todavía no vigente -----------------------------

  const { data: lista, error: errorLista } = await supabase
    .from('listas_control')
    .insert({
      tipo,
      obligatoria: esObligatoria(tipo),
      fuente,
      fecha_lista: fechaLista,
      cargada_por: usuario,
      registros: 0,
      archivo_nombre: archivo.name || null,
      vigente: false,
      observaciones,
    })
    .select('id')
    .maybeSingle();

  if (errorLista || !lista) {
    console.error('cargar-lista: fallo al crear la lista.');
    return Response.json({ error: 'No se pudo registrar la lista.' }, { status: 500 });
  }

  /** Deja constancia de que la carga quedó a medias y por qué. */
  async function marcarIncompleta(nota: string, insertados: number) {
    await supabase
      .from('listas_control')
      .update({
        registros: insertados,
        vigente: false,
        observaciones: `[CARGA INCOMPLETA] ${nota}` + (observaciones ? ` · ${observaciones}` : ''),
      })
      .eq('id', lista!.id);
  }

  // --- 7. Registros y cotejo, lote a lote ----------------------------------

  const cotejables = clientes as ClienteCotejable[];
  const coincidencias: CoincidenciaDetectada[] = [];
  let insertados = 0;

  for (let i = 0; i < csv.registros.length; i += LOTE) {
    const lote = csv.registros.slice(i, i + LOTE).map((r) => ({ ...r, lista_id: lista.id }));

    // Se piden de vuelta los UUID reales y las llaves: el cotejo se hace sobre
    // lo que quedó escrito, no sobre lo que se pensaba escribir. Así el
    // `registro_id` de cada coincidencia apunta siempre a una fila que existe,
    // y no importa en qué orden los devuelva PostgREST.
    const { data: guardados, error: errorLote } = await supabase
      .from('listas_registros')
      .insert(lote)
      .select('id, nombre, nombre_norm, rfc, curp');

    if (errorLote || !guardados) {
      console.error('cargar-lista: fallo al insertar un lote de registros.');
      await marcarIncompleta(
        `Falló el lote a partir del registro ${i + 1}. Quedaron ${insertados} de ` +
          `${csv.registros.length}. La lista NO está vigente y no debe usarse como evidencia.`,
        insertados
      );
      return Response.json(
        {
          error:
            'La carga falló a la mitad. La lista quedó marcada como incompleta y no vigente: ' +
            'no la uses como evidencia de cotejo. Corrige y vuelve a cargarla entera.',
          lista_id: lista.id,
          registros_insertados: insertados,
          registros_esperados: csv.registros.length,
        },
        { status: 500 }
      );
    }

    insertados += guardados.length;
    coincidencias.push(...buscarCoincidencias(cotejables, guardados));
  }

  // --- 8. Coincidencias ----------------------------------------------------

  for (let i = 0; i < coincidencias.length; i += LOTE) {
    const lote = coincidencias
      .slice(i, i + LOTE)
      .map((c) => ({ ...c, lista_id: lista.id, estado: 'pendiente' }));

    const { error: errorCoinc } = await supabase.from('listas_coincidencias').insert(lote);

    if (errorCoinc) {
      console.error('cargar-lista: fallo al insertar coincidencias.');
      await marcarIncompleta(
        `Los ${insertados} registros se cargaron, pero fallaron las coincidencias a ` +
          `partir de la ${i + 1} de ${coincidencias.length}. La lista NO está vigente.`,
        insertados
      );
      return Response.json(
        {
          error:
            'Los registros se guardaron pero las coincidencias no. La lista quedó no vigente: ' +
            'sin sus coincidencias, una lista cargada da una falsa sensación de cotejo.',
          lista_id: lista.id,
          registros_insertados: insertados,
          coincidencias_detectadas: coincidencias.length,
        },
        { status: 500 }
      );
    }
  }

  // --- 9. Promoción y retiro de la anterior --------------------------------

  const { error: errorPromocion } = await supabase
    .from('listas_control')
    .update({ registros: insertados, vigente: true })
    .eq('id', lista.id);

  if (errorPromocion) {
    console.error('cargar-lista: fallo al promover la lista a vigente.');
    return Response.json(
      {
        error:
          'La lista se cargó completa pero no se pudo marcar vigente. Revísala antes de usarla.',
        lista_id: lista.id,
        registros_insertados: insertados,
      },
      { status: 500 }
    );
  }

  // Se promueve primero y se retira después: si algo falla en medio, quedan dos
  // vigentes del mismo tipo —visible y corregible— y nunca ninguna, que para
  // una lista obligatoria sería un hueco de cumplimiento invisible.
  //
  // Las anteriores NO se borran, solo pierden la vigencia: hay que poder
  // reconstruir contra qué versión de la lista se cotejó en cada fecha.
  const { data: retiradas, error: errorRetiro } = await supabase
    .from('listas_control')
    .update({ vigente: false })
    .eq('tipo', tipo)
    .eq('vigente', true)
    .neq('id', lista.id)
    .select('id, fecha_lista, fecha_carga, registros');

  if (errorRetiro) {
    console.error('cargar-lista: fallo al retirar la vigencia de las listas anteriores.');
    avisos.push(
      'No se pudo retirar la vigencia de las cargas anteriores de este tipo: ' +
        'puede haber más de una vigente. Revísalo.'
    );
  }

  // --- 10. Bitácora --------------------------------------------------------

  const porTipoMatch = coincidencias.reduce<Record<string, number>>((acc, c) => {
    acc[c.tipo_match] = (acc[c.tipo_match] ?? 0) + 1;
    return acc;
  }, {});
  const clientesAfectados = [...new Set(coincidencias.map((c) => c.codigo_cliente))];

  await registrarEvento(supabase, {
    entidad: 'listas_control',
    entidadId: lista.id,
    accion: 'carga_lista_control',
    motivo:
      `Carga de lista ${tipo}${esObligatoria(tipo) ? ' (obligatoria, apartado III.10)' : ' (diligencia adicional)'}. ` +
      `Fuente ${fuente}, corte ${fechaLista}. ${insertados} registros cotejados contra ` +
      `${clientes.length} clientes: ${coincidencias.length} coincidencia(s) pendiente(s) ` +
      `sobre ${clientesAfectados.length} cliente(s).` +
      (retiradas && retiradas.length > 0
        ? ` Se retiró la vigencia de ${retiradas.length} carga(s) anterior(es) del mismo tipo.`
        : ''),
    usuario,
    campo: 'vigente',
    valorAnterior: 'false',
    valorNuevo: 'true',
    metadata: {
      tipo,
      obligatoria: esObligatoria(tipo),
      fuente,
      fecha_lista: fechaLista,
      archivo_nombre: archivo.name || null,
      registros_insertados: insertados,
      columnas_detectadas: csv.columnas,
      delimitador: csv.delimitador === '\t' ? 'tab' : csv.delimitador,
      codificacion: decodificado.codificacion,
      filas_sin_nombre: csv.filasSinNombre,
      avisos,
      coincidencias_total: coincidencias.length,
      coincidencias_por_tipo: porTipoMatch,
      clientes_afectados: clientesAfectados,
      clientes_cotejados: clientes.length,
      clientes_por_status: porStatus,
      listas_retiradas: retiradas?.map((r) => r.id) ?? [],
    },
  });

  // --- 11. Respuesta -------------------------------------------------------

  return Response.json({
    lista: {
      id: lista.id,
      tipo,
      obligatoria: esObligatoria(tipo),
      fuente,
      fecha_lista: fechaLista,
      archivo_nombre: archivo.name || null,
      vigente: true,
    },
    registros: {
      insertados,
      filas_sin_nombre: csv.filasSinNombre,
      filas_vacias: csv.filasVacias,
      columnas_detectadas: csv.columnas,
      delimitador: csv.delimitador === '\t' ? 'tab' : csv.delimitador,
      codificacion: decodificado.codificacion,
    },
    coincidencias: {
      total: coincidencias.length,
      por_tipo_match: porTipoMatch,
      clientes_afectados: clientesAfectados,
      estado: 'pendiente',
    },
    clientes_cotejados: {
      total: clientes.length,
      por_status: porStatus,
      nota: 'Se coteja a toda la cartera, sin filtrar por status.',
    },
    listas_retiradas: retiradas ?? [],
    avisos,
    // Una coincidencia pendiente NO dispara todavía las obligaciones del
    // apartado 10.10: esas nacen al confirmarla. Decir lo contrario aquí haría
    // que se suspendieran operaciones por un homónimo sin revisar.
    ...(tipo === 'LPB' && coincidencias.length > 0
      ? {
          alerta:
            `Hay ${coincidencias.length} coincidencia(s) PENDIENTE(S) contra la Lista de ` +
            'Personas Bloqueadas. Revísalas de inmediato: si se confirman, nacen la ' +
            'suspensión de operaciones y el reporte de 24 horas a la CNBV.',
        }
      : {}),
  });
}
