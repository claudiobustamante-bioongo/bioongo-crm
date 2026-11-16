// Semáforo de cumplimiento (M5) sobre la última foto cargada. CORRIDA EN SECO por
// omisión: lee con psql en transacción READ ONLY y no escribe nada. Lo corre
// Claudio con «!».
//
//   node scripts/semaforo/evaluar.mjs [--sync <uuid>] [--fix <MXN por USD>]
//        [--ips-fijado COD_CUENTA=COD_IPS[,…]] [--referencia <json>]
//
// --sync        La carga a evaluar (por omisión, la foto_diaria más reciente).
// --fix         Solo en seco: FIX a usar si aún no está en tipo_cambio.
// --ips-fijado  Solo en seco: simula codigo_ips_fijado antes de la migración B
//               (p. ej. CSPMU1062=CSPMU1062).
// --referencia  JSON con los mismos datos (pruebas con datos sintéticos).
// --registrar   «sí»: además de mostrarla, REGISTRA la corrida en
//               semaforo_evaluaciones por fn_registrar_semaforo con tu sesión
//               (--usuario): ensayo (ROLLBACK) → confirmación (CARGAR con
//               terminal interactiva; si no, una clave y una segunda corrida con
//               --confirmar <clave> que exige los mismos estados y hallazgos) →
//               real (COMMIT). No admite --fix, --ips-fijado ni --referencia: se
//               registra solo lo que dice la base.
// La salida va por código de cliente; sin nombres ni números de cuenta.
import { createInterface } from 'node:readline/promises';
import { ErrorScript, consultaSoloLectura, fmt, leerArgs, lista, psqlGuion, referenciaDesdeArchivo } from '../ibkr/comun.mjs';

const { armarCatalogo } = await import('../../lib/clasificacion-activos.ts');
const { resolverPerfilCuenta } = await import('../../lib/perfil-cuenta.ts');
const { evaluarCuenta, VERSION_MOTOR } = await import('../../lib/semaforo.ts');
const registro = await import('../../lib/semaforo-registro.ts');

const SQL = (sync) => `
with s as (
  select id, td from public.sync_ibkr
   where uso = 'foto_diaria' ${sync ? `and id = '${sync}'::uuid` : ''}
   order by td desc, confirmado_en desc limit 1)
select json_build_object(
  'sync', (select json_build_object('id', id, 'td', td) from s),
  'foto', (select coalesce(json_agg(json_build_object('cuenta_ibkr', cuenta_ibkr, 'tipo_renglon', tipo_renglon, 'ticker', ticker,
      'asset_category', asset_category, 'sub_category', sub_category, 'valor_base', valor_base, 'moneda_base', moneda_base)), '[]')
    from public.posiciones_detalle where sync_id = (select id from s)),
  'cuentas', (select json_agg(json_build_object('cuenta_ibkr', ci.cuenta_ibkr, 'codigo_cliente', ci.codigo_cliente, 'tipo', ci.tipo,
      'es_propia', ci.es_propia, 'fecha_cierre', ci.fecha_cierre, 'status', c.status,
      'codigo_ips_fijado', to_jsonb(ci) ->> 'codigo_ips_fijado'))
    from public.cuentas_ibkr ci join public.clientes c using (codigo_cliente)),
  'titulares', (select json_agg(json_build_object('cuenta_ibkr', ct.cuenta_ibkr, 'rol', ct.rol, 'codigo_ips', p.codigo_ips,
      'codigo_ficha', p.codigo_ficha))
    from public.cuenta_titulares ct join public.personas p on p.id = ct.persona_id),
  'perfiles', (select json_agg(json_build_object('codigo', pr.codigo_cliente,
      'perfil', coalesce(pr.perfil_ajustado, pr.resultado_perfil), 'fase', pr.fase,
      'fecha_calculo', pr.fecha_calculo::date, 'fecha_cuestionario', pr.fecha_evaluacion,
      'ips_firmado', exists (select 1 from public.documentos_expediente d
                              where d.codigo_cliente = pr.codigo_cliente and d.tipo = 'ips_firmado')))
    from public.perfil_riesgo pr),
  'limites_fase', (select json_object_agg(fase, json_build_object('rv_max_pct', rv_max_pct, 'rf_min_pct', rf_min_pct,
      'liquidez_min_pct', liquidez_min_pct)) from public.limites_fase),
  'limites_perfil', (select json_object_agg(perfil, techos) from (select perfil, json_object_agg(clase_activo, max_pct) techos
      from public.limites_perfil group by perfil) x),
  'reglas_perfil', (select json_object_agg(perfil, json_build_object('duracion_gob_menor_a', duracion_gob_menor_a,
      'liquidez_min_pct', liquidez_min_pct, 'efectivo_cuenta_rf', efectivo_cuenta_rf, 'rv_total_max_pct', rv_total_max_pct))
    from public.reglas_perfil),
  'parametros', (select json_object_agg(clave, coalesce(valor_num::text, valor_fecha::text, valor_bool::text))
    from public.parametros_cumplimiento),
  'catalogo', (select json_agg(json_build_object('ticker', ticker, 'clase_activo', clase_activo, 'elegible', elegible,
      'es_equivalente_efectivo', es_equivalente_efectivo, 'duracion_efectiva', duracion_efectiva))
    from public.catalogo_instrumentos),
  'prorrateo', (select coalesce(json_agg(json_build_object('ticker', ticker, 'clase_activo', clase_activo, 'factor', factor)), '[]')
    from public.catalogo_prorrateo),
  'tipo_cambio_existe', to_regclass('public.tipo_cambio') is not null)`;

const SQL_FIX = (td) => `select coalesce((select json_build_object('fecha', fecha, 'valor', valor) from public.tipo_cambio
  where serie = 'SF43718' and fecha <= '${td}'::date order by fecha desc limit 1), 'null'::json)`;

try {
  const args = leerArgs(process.argv.slice(2));
  const registrar = args.registrar === 'sí' || args.registrar === 'si';
  if (args.registrar && !registrar) throw new ErrorScript('--registrar se escribe «--registrar sí».');
  if (registrar) {
    if (!args.usuario) throw new ErrorScript('Para registrar falta --usuario <correo>: es quien firma.');
    if (args.fix || args['ips-fijado'] || args.referencia) {
      throw new ErrorScript('--fix, --ips-fijado y --referencia son solo de la corrida en seco: no se registran supuestos.');
    }
  }
  if (args.sync && !/^[0-9a-f-]{36}$/.test(args.sync)) throw new ErrorScript('--sync debe ser un uuid.');
  const d = args.referencia ? referenciaDesdeArchivo(args.referencia) : consultaSoloLectura(SQL(args.sync), 'los datos del semáforo');
  if (!d.sync) throw new ErrorScript('No hay ninguna foto_diaria cargada.');
  const td = String(d.sync.td).slice(0, 10);

  // Tipo de cambio: la tabla (cuando exista) o --fix en seco. Nunca un supuesto.
  let fix = null, fixOrigen = 'sin FIX';
  if (d.tipo_cambio_existe && !args.referencia) {
    const r = consultaSoloLectura(SQL_FIX(td), 'el FIX');
    if (r) { fix = Number(r.valor); fixOrigen = `tipo_cambio ${String(r.fecha).slice(0, 10)}`; }
  }
  if (args.fix) { fix = Number(args.fix); fixOrigen = '--fix (en seco)'; }
  if (fix !== null && !(fix > 0)) throw new ErrorScript('--fix debe ser un número positivo.');

  const fijadosSeco = new Map((args['ips-fijado'] ?? '').split(',').filter(Boolean).map((p) => p.split('=')));
  const p = d.parametros;
  const M4 = {
    limitesFase: Object.fromEntries(Object.entries(d.limites_fase).map(([k, v]) => [k, {
      rv_max_pct: Number(v.rv_max_pct), rf_min_pct: Number(v.rf_min_pct), liquidez_min_pct: Number(v.liquidez_min_pct) }])),
    limitesPerfil: Object.fromEntries(Object.entries(d.limites_perfil).map(([k, v]) =>
      [k, Object.fromEntries(Object.entries(v).map(([c, x]) => [c, Number(x)]))])),
    reglasPerfil: Object.fromEntries(Object.entries(d.reglas_perfil).map(([k, v]) => [k, {
      duracion_gob_menor_a: v.duracion_gob_menor_a === null ? null : Number(v.duracion_gob_menor_a),
      liquidez_min_pct: Number(v.liquidez_min_pct), efectivo_cuenta_rf: v.efectivo_cuenta_rf, rv_total_max_pct: Number(v.rv_total_max_pct) }])),
    navResidualMxn: Number(p.nav_residual_mxn),
    saldoDeudorToleranciaPct: Number(p.saldo_deudor_tolerancia_pct),
  };
  const vigencia = Number(p.vigencia_ips_anios);
  const catalogo = armarCatalogo(
    d.catalogo.map((i) => ({ ...i, duracion_efectiva: i.duracion_efectiva === null ? null : Number(i.duracion_efectiva) })),
    d.prorrateo.map((x) => ({ ...x, factor: Number(x.factor) })),
  );
  const perfiles = new Map(d.perfiles.map((x) => [x.codigo, { ...x,
    fecha_calculo: x.fecha_calculo ? String(x.fecha_calculo).slice(0, 10) : null,
    fecha_cuestionario: x.fecha_cuestionario ? String(x.fecha_cuestionario).slice(0, 10) : null }]));
  const titularesDe = new Map();
  for (const t of d.titulares) titularesDe.set(t.cuenta_ibkr, [...(titularesDe.get(t.cuenta_ibkr) ?? []), t]);
  const fotoDe = new Map();
  for (const r of d.foto) fotoDe.set(r.cuenta_ibkr, [...(fotoDe.get(r.cuenta_ibkr) ?? []), { ...r, valor_base: Number(r.valor_base) }]);

  const universo = d.cuentas.filter((c) => c.status !== 'baja' && !c.fecha_cierre)
    .sort((a, b) => (a.codigo_cliente < b.codigo_cliente ? -1 : 1));
  console.log(`\n== Semáforo EN SECO · foto ${td} · motor ${VERSION_MOTOR} · ${universo.length} cuentas vigentes · FIX: ${fix ?? '—'} (${fixOrigen})`);
  if (fijadosSeco.size) console.log(`   IPS fijado simulado: ${[...fijadosSeco].map(([a, b]) => `${a}→${b}`).join(', ')}`);

  const conteo = new Map();
  const evaluaciones = [];
  for (const c of universo) {
    const ips = c.codigo_ips_fijado ?? fijadosSeco.get(c.codigo_cliente) ?? null;
    const perfil = resolverPerfilCuenta({ cuenta_ibkr: c.cuenta_ibkr, tipo: c.tipo, titulares: titularesDe.get(c.cuenta_ibkr) ?? [],
      codigo_ips_fijado: ips }, perfiles, td, vigencia);
    const filas = fotoDe.get(c.cuenta_ibkr);
    const nav = filas?.find((r) => r.tipo_renglon === 'nav_ibkr');
    const foto = filas && nav ? { moneda_base: nav.moneda_base, nav_ibkr: nav.valor_base,
      renglones: filas.filter((r) => r.tipo_renglon !== 'nav_ibkr') } : null;
    const ev = evaluarCuenta({ cuenta_ibkr: c.cuenta_ibkr, es_propia: c.es_propia, perfil, foto, tipo_cambio: fix, catalogo, parametros: M4 });
    conteo.set(ev.estado, (conteo.get(ev.estado) ?? 0) + 1);
    evaluaciones.push({ ...ev, ips_pendiente: perfil.ok ? perfil.ips_pendiente : [] });

    const perf = perfil.ok ? `${perfil.perfil} (${perfil.origen}: ${perfil.fuentes.join(' + ')}; fases ${perfil.fases.map((f) => f.fase).join('/')})`
      : `sin perfil: ${perfil.motivo}${perfil.faltantes.length ? ` (${perfil.faltantes.join(', ')})` : ''}`;
    const m = ev.metricas;
    const cifras = foto ? ` · ${foto.moneda_base} ${fmt(foto.nav_ibkr)}${m.rv_pct !== undefined ? ` · RV ${m.rv_pct} % · RF ${m.rf_pct} % · liq ${m.liquidez_pct} %` : ''}` : '';
    console.log(`\n  ${ev.estado.padEnd(10)} ${c.codigo_cliente}${c.tipo === 'conjunta' ? ' (conjunta)' : ''}${c.es_propia ? ' (propia)' : ''}${cifras}`);
    console.log(`             perfil: ${perf}`);
    for (const h of ev.hallazgos) {
      console.log(`             [${h.severidad}${h.informativo ? ', informativo' : ''}] ${h.prueba}: ${h.mensaje}${h.origenes ? ` ← ${h.origenes.join(', ')}` : ''}`);
    }
    if (perfil.ok && perfil.ips_pendiente.length) console.log(`             (actualización de IPS pendiente: ${perfil.ips_pendiente.join('; ')})`);
  }
  console.log(`\n== Resumen: ${lista([...conteo].sort().map(([k, v]) => `${k} ${v}`))}`);

  if (!registrar) {
    console.log('Corrida en seco: nada se escribió en la base.');
    process.exit(0);
  }

  const lote = registro.armarLote(d.sync.id, fix, evaluaciones);
  const clave = registro.claveSemaforo(lote);
  console.log(`\n== REGISTRO · carga ${d.sync.id} · ${lote.evaluaciones.length} evaluaciones · FIX ${fix ?? '—'} · clave ${clave}`);
  console.log('Ensayo (ROLLBACK)…');
  console.log(`  ${JSON.stringify(psqlGuion(registro.sqlRegistroSemaforo(lote, 'ensayo', args.usuario)))}`);

  if (args.confirmar) {
    if (args.confirmar !== clave) throw new ErrorScript('La clave no coincide con los estados y hallazgos de esta corrida: no se registra.');
  } else if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const r = await rl.question(`\nEscribe CARGAR para registrar el semáforo de la foto del ${td}: `);
    rl.close();
    if (r.trim() !== 'CARGAR') { console.log('No se confirmó: no se registró nada.'); process.exit(0); }
  } else {
    console.log(`\nNada se escribió. Para registrar, repite el comando con --confirmar ${clave}`);
    process.exit(0);
  }

  console.log('\nReal (COMMIT)…');
  const real = psqlGuion(registro.sqlRegistroSemaforo(lote, 'real', args.usuario));
  console.log(`  ${JSON.stringify(real)}`);
  console.log(`\nSemáforo de la foto del ${td} registrado: ${real.resultado?.evaluaciones} evaluaciones.`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(e instanceof ErrorScript ? e.codigoSalida : 1);
}
