-- ===========================================================================
-- Historificación de perfil_riesgo · tabla espejo append-only
--
-- EJECUTADO el 23 de septiembre de 2026 por Claudio Bustamante, a mano, en el
-- SQL Editor de Supabase. Este archivo es el registro de lo que se corrió.
--
-- QUÉ HIZO
--
-- `perfil_riesgo` guarda una sola fila por cliente —tiene `unique
-- (codigo_cliente)`— y `calcular-ips` la actualiza en sitio. Las 34 filas de la
-- tabla, 30 de ellas con perfil calculado, no tenían historia: un recálculo
-- pisaba el perfil anterior y no quedaba de él más que las filas por campo que
-- `fn_bitacora` deja en `bitacora`. Eso bloqueaba el IPS masivo, que habría
-- pisado los 30 perfiles vigentes de una pasada.
--
-- Se agregó `perfil_riesgo_historico`, espejo append-only que recibe el estado
-- ANTERIOR en cada UPDATE y en cada DELETE, alimentado por
-- `trg_archivar_perfil_riesgo` (BEFORE UPDATE OR DELETE, SECURITY DEFINER).
-- La fila vigente se queda donde estaba: ningún lector cambió —ni ficha, ni
-- portafolios, ni perfil-ia, ni ajustar-ips— y ningún archivo de la aplicación
-- se tocó en esta migración.
--
-- Cada versión guarda las dos cosas: `snapshot jsonb` con la fila completa, y
-- 37 columnas promovidas para poder consultar sin desempacar. El snapshot es el
-- que manda. Con solo la lista explícita, el día que alguien agregue una
-- columna a `perfil_riesgo` y no la agregue aquí, el espejo dejaría de copiarla
-- en silencio; con el snapshot, el dato sigue archivado aunque la columna
-- promovida falte. Mismo criterio que `ebr_evaluaciones.entrada`.
--
-- `campos_cambiados text[]` distingue un recálculo de un ajuste manual sin
-- tener que diffear dos snapshots.
--
-- QUÉ NO HIZO, A PROPÓSITO
--
-- SIN BACKFILL. Las 34 filas vigentes no se copiaron al espejo. La tabla no es
-- «todas las versiones» sino «las versiones que ya no están vivas»: la vigente
-- se lee de `perfil_riesgo`. Por eso al terminar esta migración el histórico
-- quedó en 0 filas, que es el estado correcto y no un defecto. La primera
-- versión de cada cliente la escribirá su primer UPDATE.
--
-- SIN FK, ni a `perfil_riesgo` ni a `clientes`. La historia tiene que
-- sobrevivir al borrado de la fila viva y del expediente; una FK la borraría en
-- cascada o impediría el DELETE, y las dos cosas destruyen el archivo.
--
-- SIN CHECK de `perfil_ajustado` en el espejo. El histórico debe poder guardar
-- lo que realmente estaba escrito, incluso un valor que una regla posterior
-- rechace.
--
-- SIN `force row level security`: forzarla sometería también al dueño de la
-- tabla y el propio trigger SECURITY DEFINER dejaría de poder escribir.
--
-- SIN INSERT en el trigger: una fila nueva no tiene estado anterior que
-- archivar.
--
-- SIN `lote_id`. El trigger no puede verlo. Esa correlación sigue viviendo en
-- `bitacora`, que `trg_bitacora` escribe en AFTER sobre la misma tabla; los dos
-- triggers conviven, BEFORE archiva y AFTER bitacorea.
--
-- Se descartó la alternativa que se discutió el 10-sep —partir en
-- `ips_evaluaciones` append-only, simétrica con `ebr_evaluaciones`— porque
-- obliga a tocar todos los lectores y a hacer backfill. El espejo deja la fila
-- vigente en su lugar y no mueve una sola línea de la aplicación.
--
-- Un UPDATE que no modifica ningún valor no genera versión. Por eso
-- `campos_cambiados` nunca queda en `{}`: un arreglo vacío ahí sería un defecto
-- del trigger, no un caso posible. Queda escrito en el `comment on column`.
--
-- VERIFICADO DESPUÉS DE EJECUTAR
--
-- UPDATE de prueba sobre un perfil, dentro de una transacción revertida con
-- rollback para no dejar residuo en la base real. El trigger archivó:
--
--   version           1
--   operacion         update
--   archivado_por     sql_directo
--   campos_cambiados  {comentario_asesor}
--   snapshot          37 llaves
--
-- Y después del `rollback`: 0 filas en `perfil_riesgo_historico` y la fila viva
-- sin rastro de la prueba. El archivado se revierte con la transacción que lo
-- provocó, que es lo que debe pasar: un cambio que no ocurrió no deja versión.
--
-- `archivado_por` dice `sql_directo` porque la prueba se corrió desde el SQL
-- Editor, sin JWT de Supabase. Desde la aplicación queda el correo del usuario,
-- por el mismo `current_setting('request.jwt.claims')` que usa `fn_bitacora`.
--
-- No hubo cambios de código: los 95 tests siguen verdes, sin tocarlos.
--
-- LO QUE ESTO HABILITA Y QUEDA PENDIENTE
--
-- El IPS masivo, que sigue bloqueado en `/tabla` con el motivo escrito en
-- pantalla, ya no tiene este impedimento. Falta su construcción, que NO es
-- parte de esta migración. Y hay 1 cliente con `perfil_ajustado` manual que
-- quedaría colgando de un cálculo que ya no existe: necesita revisión personal
-- después del primer lote.
-- ===========================================================================

-- Todo o nada. Postgres hace DDL transaccional: si algo falla a media
-- ejecución, no queda una tabla creada sin su trigger —que parece instalada y
-- no lo está—, sino la base como estaba antes.
begin;

-- ---------------------------------------------------------------------------
-- 1. La tabla espejo
--
-- Sin FK: ni a `perfil_riesgo` ni a `clientes`. La historia tiene que
-- sobrevivir al borrado de la fila viva y del expediente; una FK la borraría
-- en cascada o impediría el DELETE, y las dos cosas destruyen el archivo.
--
-- Sin el CHECK de `perfil_ajustado`: el espejo debe poder guardar lo que
-- realmente estaba escrito, incluso un valor que una regla posterior rechace.
--
-- `snapshot` es la fila completa tal como estaba. Las 37 columnas promovidas
-- son para consultar sin desempacar, pero el snapshot es el que manda: el día
-- que alguien agregue una columna a `perfil_riesgo` y no la agregue aquí, el
-- dato sigue archivado. Mismo criterio que `ebr_evaluaciones.entrada`.
-- ---------------------------------------------------------------------------
create table public.perfil_riesgo_historico (
  historico_id              uuid        primary key default gen_random_uuid(),
  version                   integer     not null,
  archivado_en              timestamptz not null default now(),
  archivado_por             text        not null,
  operacion                 text        not null check (operacion in ('update','delete')),
  campos_cambiados          text[],
  snapshot                  jsonb       not null,

  -- Copia fiel de la fila vigente al momento de archivarla.
  id                        uuid        not null,
  codigo_cliente            text        not null,
  objetivo_inversion        text,
  ganancia_deseada          text,
  horizonte                 text,
  tolerancia_perdida        text,
  resultado_perfil          text,
  perfil_ia                 text,
  respuestas_completas      jsonb,
  fecha_evaluacion          date,
  created_at                timestamptz,
  reaccion_caida_10         text,
  negocio_propio            text,
  percepcion_riesgo_empleo  text,
  prefiere_ingreso_seguro   text,
  no_puede_perder           text,
  colchon_liquidez          text,
  dependientes              integer,
  situacion_habitacional    text,
  ahorros                   numeric,
  hipoteca                  numeric,
  otras_deudas              numeric,
  fase                      text,
  tolerancia_puntos         integer,
  tolerancia_nivel          integer,
  capacidad_puntos          integer,
  capacidad_nivel           integer,
  puntuacion_ponderada      numeric,
  perfil_solicitado_cliente text,
  bitacora_calculo          jsonb,
  fecha_calculo             timestamptz,
  tiene_ahorros             text,
  comentario_asesor         text,
  perfil_ajustado_por       text,
  fecha_ajuste              timestamptz,
  perfil_ajustado           text,
  ajustado_por              text,

  -- Dos procesos que archiven al mismo cliente a la vez calculan la misma
  -- versión; esta restricción hace que uno falle en vez de repetir número.
  constraint perfil_riesgo_historico_version_unica unique (codigo_cliente, version)
);

-- El unique de arriba ya deja índice sobre (codigo_cliente, version) y sirve
-- en ambos sentidos de orden: no hace falta otro. Este es el que responde
-- «qué se archivó en el lote de anoche», que no tiene índice propio.
create index idx_prh_archivado
  on public.perfil_riesgo_historico (archivado_en desc);

comment on table public.perfil_riesgo_historico is
  'Espejo append-only de perfil_riesgo. Solo escribe el trigger trg_archivar_perfil_riesgo. Cada fila es el estado ANTERIOR a un UPDATE o DELETE.';
comment on column public.perfil_riesgo_historico.id is
  'id de la fila viva en perfil_riesgo. Sin FK: la historia sobrevive a su borrado.';
comment on column public.perfil_riesgo_historico.version is
  'Consecutivo por codigo_cliente. version 1 = el estado previo al primer UPDATE, no el original.';
comment on column public.perfil_riesgo_historico.snapshot is
  'to_jsonb(old): la fila completa antes del cambio. Manda sobre las columnas promovidas, que pueden quedarse atrás si alguien agrega una columna a perfil_riesgo.';
comment on column public.perfil_riesgo_historico.campos_cambiados is
  'Campos que este UPDATE modificó. Distingue un recálculo de un ajuste manual sin diffear snapshots. Null en DELETE: no cambió un campo, se fue la fila. Un arreglo vacío no es un caso posible sino un defecto del trigger: el UPDATE que no cambia nada se descarta antes de archivarse.';

-- ---------------------------------------------------------------------------
-- 2. El trigger que archiva
--
-- SECURITY DEFINER porque es la única vía de escritura: la RLS de abajo no
-- deja insertar a nadie más.
--
-- El `lote_id` no aparece aquí: el trigger no puede verlo. Esa correlación
-- sigue viviendo en `bitacora`, que trg_bitacora escribe en AFTER.
-- ---------------------------------------------------------------------------
create or replace function public.fn_archivar_perfil_riesgo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario text;
  v_version integer;
  v_campos  text[];
begin
  -- Un UPDATE que no cambió ningún valor no merece una versión.
  if (tg_op = 'UPDATE') and (to_jsonb(old) is not distinct from to_jsonb(new)) then
    return new;
  end if;

  v_usuario := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
    'sql_directo'
  );

  -- Qué cambió. En DELETE queda null: no hay `new` contra qué comparar.
  -- No se excluye created_at como en fn_bitacora: si alguien lo movió, se ve.
  if (tg_op = 'UPDATE') then
    select array_agg(nuevo.key order by nuevo.key)
      into v_campos
      from jsonb_each_text(to_jsonb(new)) as nuevo(key, value)
     where nuevo.value is distinct from (to_jsonb(old) ->> nuevo.key);
  end if;

  select coalesce(max(version), 0) + 1
    into v_version
    from perfil_riesgo_historico
   where codigo_cliente = old.codigo_cliente;

  insert into perfil_riesgo_historico (
    version, archivado_por, operacion, campos_cambiados, snapshot,
    id, codigo_cliente, objetivo_inversion, ganancia_deseada, horizonte,
    tolerancia_perdida, resultado_perfil, perfil_ia, respuestas_completas,
    fecha_evaluacion, created_at, reaccion_caida_10, negocio_propio,
    percepcion_riesgo_empleo, prefiere_ingreso_seguro, no_puede_perder,
    colchon_liquidez, dependientes, situacion_habitacional, ahorros, hipoteca,
    otras_deudas, fase, tolerancia_puntos, tolerancia_nivel, capacidad_puntos,
    capacidad_nivel, puntuacion_ponderada, perfil_solicitado_cliente,
    bitacora_calculo, fecha_calculo, tiene_ahorros, comentario_asesor,
    perfil_ajustado_por, fecha_ajuste, perfil_ajustado, ajustado_por
  ) values (
    v_version, v_usuario, lower(tg_op), v_campos, to_jsonb(old),
    old.id, old.codigo_cliente, old.objetivo_inversion, old.ganancia_deseada,
    old.horizonte, old.tolerancia_perdida, old.resultado_perfil, old.perfil_ia,
    old.respuestas_completas, old.fecha_evaluacion, old.created_at,
    old.reaccion_caida_10, old.negocio_propio, old.percepcion_riesgo_empleo,
    old.prefiere_ingreso_seguro, old.no_puede_perder, old.colchon_liquidez,
    old.dependientes, old.situacion_habitacional, old.ahorros, old.hipoteca,
    old.otras_deudas, old.fase, old.tolerancia_puntos, old.tolerancia_nivel,
    old.capacidad_puntos, old.capacidad_nivel, old.puntuacion_ponderada,
    old.perfil_solicitado_cliente, old.bitacora_calculo, old.fecha_calculo,
    old.tiene_ahorros, old.comentario_asesor, old.perfil_ajustado_por,
    old.fecha_ajuste, old.perfil_ajustado, old.ajustado_por
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

-- BEFORE, no AFTER: si el archivado falla, el UPDATE no ocurre. Un cambio que
-- se guarda sin quedar archivado es exactamente lo que esto viene a impedir.
-- No hay INSERT: una fila nueva no tiene estado anterior que archivar.
create trigger trg_archivar_perfil_riesgo
  before update or delete on public.perfil_riesgo
  for each row execute function public.fn_archivar_perfil_riesgo();

-- ---------------------------------------------------------------------------
-- 3. RLS: se lee, no se escribe
--
-- SELECT para authenticated y ninguna política de INSERT/UPDATE/DELETE. El
-- trigger entra por SECURITY DEFINER, como dueño de la tabla.
--
-- Deliberadamente SIN `force row level security`: forzarla sometería también
-- al dueño y el propio trigger dejaría de poder escribir.
-- ---------------------------------------------------------------------------
alter table public.perfil_riesgo_historico enable row level security;

create policy perfil_historico_select_auth
  on public.perfil_riesgo_historico
  for select to authenticated
  using (true);

grant select on public.perfil_riesgo_historico to authenticated;
revoke insert, update, delete on public.perfil_riesgo_historico from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Sin backfill, a propósito
--
-- No se copian las 34 filas vigentes al espejo. La tabla no es «todas las
-- versiones», es «las versiones que ya no están vivas»: la vigente se lee de
-- perfil_riesgo. El primer UPDATE de cada cliente archiva su estado previo.
-- ---------------------------------------------------------------------------

commit;

-- --- Verificación · se corrió aparte, después del commit -------------------
--
-- La transacción se revierte a propósito: prueba que el trigger archiva sin
-- dejar nada escrito en la base real.
--
-- begin;
--
-- update perfil_riesgo
--    set comentario_asesor = coalesce(comentario_asesor, '') || ' [prueba]'
--  where codigo_cliente = '<un perfil cualquiera>';
--
-- select version, operacion, archivado_por, campos_cambiados,
--        (select count(*) from jsonb_object_keys(snapshot)) as llaves_snapshot
--   from perfil_riesgo_historico
--  where codigo_cliente = '<el mismo>';
--
-- rollback;
--
-- select count(*) from perfil_riesgo_historico;  -- 0
