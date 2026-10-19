-- ===========================================================================
-- Persona ↔ cuenta · bloque 2 · backfill
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: solo códigos.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026). La salida del
-- real, la verificación por MCP y el md5 van en el mensaje del commit.
--
-- Antes, en una réplica PGlite 0.3.7 (Postgres 17.5) con el bloque 1 de
-- migraciones/ y los 36 códigos con el mismo patrón de registros que
-- producción (valores sintéticos): 22/22. Entre ellas, que la verificación
-- detiene un cotitular con otro perfil, que CSPFU8973 tuviera IPS y EBR, un
-- grado fuera del catálogo, la falta del B2 y un código de más.
--
-- Ensayo en producción, 19-oct-2026 (modo=ensayo, mismo cuerpo; ROLLBACK,
-- código de salida 0):
--
--   personas / cuentas / titularidades   32 / 35 / 40
--   conjuntas (IPS · EBR por la regla)   CSPFU1488 Alto·BAJO | CSPFU2162 Moderado·BAJO |
--                                        CSPFU8588 Alto·BAJO | CSPMU1062 NULL·NULL falta CSPFU8973 |
--                                        CSPMU3071 Moderado·BAJO
--   cuentas iguales a hoy                34 de 35 (excepción: CSPMU1062)
--   tablas existentes sin cambio         14 de 14
--   beneficiario B2 vinculado            1
--   asientos de bitácora                 109
--
-- Verificado después por MCP: 0 personas, 0 cuentas, 0 titularidades, 0
-- beneficiarios vinculados y 0 asientos.
--
-- QUÉ HACE (decisiones de Claudio del 14 al 19-oct-2026)
--
-- 1. personas (32): una por código individual, todos menos los cuatro códigos de
--    cuenta conjunta cuyos datos se quedan en la cuenta (CSPFU1488, CSPFU2162,
--    CSPFU8588, CSPMU3071). Regla: los punteros de la persona salen de SU
--    código individual, donde exista el registro; si no existe, NULL. Así la
--    persona CSPFU1988 apunta a su propio KYC y PEP (la comparación del 19-oct
--    contra el formulario C2 dio 13/14 con el suyo, 2/14 con el de CSPMU3071).
--    codigo_reporte = el código individual; NULL para la persona de la fila
--    CSPMU1062, hasta decidir el R03 en noviembre.
-- 2. cuentas_ibkr (35): una por clientes.cuenta_ibkr; conjuntas las cinco con
--    es_conjunta.
-- 3. cuenta_titulares (40): 30 individuales con su persona como titular y 5
--    conjuntas con titular y cotitular:
--      CSPFU1488 = CSPFU6388 + CSPFU1390      CSPFU2162 = CSPFU6388 + CSPFU1062
--      CSPFU8588 = CSPFU6388 + CSPFU8488      CSPMU3071 = CSPMU7486 + CSPFU1988
--      CSPMU1062 = CSPFU8973 (titular) + la persona de la fila CSPMU1062
-- 4. beneficiarios: el B2 de CSPFU2963 apunta a la persona CSPMU7486. Es la
--    única fila existente que cambia.
--
-- VERIFICACIÓN (paso 6, dentro de la transacción; cualquier RAISE revierte):
-- conteos 32/35/40; los 36 códigos cubiertos; un titular por cuenta; la regla de
-- conjuntas (EBR = el más alto, IPS = el más conservador: Libre > Bajo >
-- Moderado > Alto; una fila de perfil sin resultado cuenta como NULL; si falta
-- un titular, NULL + el faltante) da por cuenta lo mismo que hoy da el código,
-- con UNA excepción declarada: CSPMU1062 → NULL en IPS y EBR, faltante CSPFU8973;
-- ninguna tabla existente cambia salvo esa fila de beneficiarios; 109 asientos de
-- bitácora, todos con el usuario pasado.
-- ===========================================================================

\if :{?modo} \else
  DO $$ BEGIN RAISE EXCEPTION 'Falta -v modo=ensayo o -v modo=real'; END $$;
\endif
\if :{?usuario} \else
  DO $$ BEGIN RAISE EXCEPTION 'Falta -v usuario=<correo>'; END $$;
\endif
SELECT :'modo' IN ('ensayo', 'real') AS modo_valido,
       :'modo' = 'real'               AS es_real,
       :'usuario' ~ '^[^@\s]+@[^@\s]+\.[a-z]+$' AS usuario_valido \gset
\if :modo_valido \else
  DO $$ BEGIN RAISE EXCEPTION 'modo debe ser ensayo o real'; END $$;
\endif
\if :usuario_valido \else
  DO $$ BEGIN RAISE EXCEPTION 'usuario no parece un correo'; END $$;
\endif

BEGIN;
SELECT set_config('request.jwt.claims',
                  json_build_object('email', :'usuario', 'canal', 'psql')::text, true) IS NOT NULL AS claims;

-- <<CUERPO
-- --- 0 · Guardas ---------------------------------------------------------------
do $$
declare v text;
begin
  if (select count(*) from public.personas) + (select count(*) from public.cuentas_ibkr)
     + (select count(*) from public.cuenta_titulares) <> 0 then
    raise exception 'guarda: personas, cuentas_ibkr o cuenta_titulares ya tienen filas; el backfill no es re-ejecutable.';
  end if;
  select string_agg(codigo_cliente, ',' order by codigo_cliente) into v from public.clientes;
  if v is distinct from
     'CSPFU1062,CSPFU1087,CSPFU1270,CSPFU1289,CSPFU1390,CSPFU1488,CSPFU1889,CSPFU1988,CSPFU2092,'
     'CSPFU2162,CSPFU2463,CSPFU2963,CSPFU6388,CSPFU6473,CSPFU6760,CSPFU6888,CSPFU6964,CSPFU7179,'
     'CSPFU7371,CSPFU7580,CSPFU7589,CSPFU7990,CSPFU8085,CSPFU8385,CSPFU8487,CSPFU8488,CSPFU8588,'
     'CSPFU8967,CSPFU8968,CSPFU8973,CSPFU9251,CSPMU1062,CSPMU1089,CSPMU1160,CSPMU3071,CSPMU7486' then
    raise exception 'guarda: los códigos de clientes no son los 36 revisados el 19-oct.';
  end if;
  select string_agg(codigo_cliente, ',' order by codigo_cliente) into v from public.clientes where es_conjunta;
  if v is distinct from 'CSPFU1488,CSPFU2162,CSPFU8588,CSPMU1062,CSPMU3071' then
    raise exception 'guarda: las cuentas conjuntas no son las cinco revisadas: %', v;
  end if;
  if (select count(*) from public.clientes where cuenta_ibkr is not null) <> 35
     or exists (select 1 from public.clientes where codigo_cliente = 'CSPFU1988' and cuenta_ibkr is not null) then
    raise exception 'guarda: se esperaban 35 cuentas y CSPFU1988 sin cuenta.';
  end if;
  if (select count(*) from public.beneficiarios
       where id = 'c15f265d-0ad4-45d7-a65b-8007e226c32c' and codigo_cliente = 'CSPFU2963'
         and persona_id is null and respuestas_completas -> 'posible_cliente' ? 'CSPMU7486') <> 1 then
    raise exception 'guarda: no está el B2 de CSPFU2963 sin vincular.';
  end if;
end $$;

-- Huella de las tablas existentes, para el paso 6.
create temporary table _huella (tabla text primary key, antes text, despues text) on commit drop;
do $$
declare t text;
begin
  foreach t in array array['clientes', 'kyc_detalle', 'pep_listas', 'perfil_riesgo', 'ebr_evaluaciones',
                           'propietario_real', 'transaccionalidad', 'portafolios', 'documentos_expediente',
                           'cliente_bloqueos', 'firmas_cumplimiento', 'listas_coincidencias', 'codigos_alias'] loop
    if to_regclass('public.' || t) is not null then
      execute format('insert into _huella (tabla, antes) select %L, md5(coalesce(string_agg(to_jsonb(x)::text, '''' order by to_jsonb(x)::text), '''')) from public.%I x', t, t);
    end if;
  end loop;
  insert into _huella (tabla, antes)
  select 'beneficiarios_sin_persona_id', md5(coalesce(string_agg((to_jsonb(x) - 'persona_id')::text, '' order by (to_jsonb(x) - 'persona_id')::text), ''))
    from public.beneficiarios x;
end $$;

-- --- 1 · personas --------------------------------------------------------------
-- Cada persona por su código individual (ficha). El puntero existe solo si el
-- registro existe; la guarda de abajo comprueba que no falte ni sobre ninguno.
create temporary table _personas (ficha text primary key, reporte text) on commit drop;
insert into _personas (ficha, reporte) values
  ('CSPFU1062', 'CSPFU1062'), ('CSPFU1087', 'CSPFU1087'), ('CSPFU1270', 'CSPFU1270'),
  ('CSPFU1289', 'CSPFU1289'), ('CSPFU1390', 'CSPFU1390'), ('CSPFU1889', 'CSPFU1889'),
  ('CSPFU1988', 'CSPFU1988'), ('CSPFU2092', 'CSPFU2092'), ('CSPFU2463', 'CSPFU2463'),
  ('CSPFU2963', 'CSPFU2963'), ('CSPFU6388', 'CSPFU6388'), ('CSPFU6473', 'CSPFU6473'),
  ('CSPFU6760', 'CSPFU6760'), ('CSPFU6888', 'CSPFU6888'), ('CSPFU6964', 'CSPFU6964'),
  ('CSPFU7179', 'CSPFU7179'), ('CSPFU7371', 'CSPFU7371'), ('CSPFU7580', 'CSPFU7580'),
  ('CSPFU7589', 'CSPFU7589'), ('CSPFU7990', 'CSPFU7990'), ('CSPFU8085', 'CSPFU8085'),
  ('CSPFU8385', 'CSPFU8385'), ('CSPFU8487', 'CSPFU8487'), ('CSPFU8488', 'CSPFU8488'),
  ('CSPFU8967', 'CSPFU8967'), ('CSPFU8968', 'CSPFU8968'), ('CSPFU8973', 'CSPFU8973'),
  ('CSPFU9251', 'CSPFU9251'), ('CSPMU1062', null),        ('CSPMU1089', 'CSPMU1089'),
  ('CSPMU1160', 'CSPMU1160'), ('CSPMU7486', 'CSPMU7486');

insert into public.personas (codigo_reporte, codigo_ficha, codigo_kyc, codigo_pep, codigo_ips, codigo_ebr, nota)
select m.reporte, m.ficha,
       case when exists (select 1 from public.kyc_detalle k where k.codigo_cliente = m.ficha) then m.ficha end,
       case when exists (select 1 from public.pep_listas p where p.codigo_cliente = m.ficha) then m.ficha end,
       case when exists (select 1 from public.perfil_riesgo r where r.codigo_cliente = m.ficha) then m.ficha end,
       case when exists (select 1 from public.ebr_evaluaciones e where e.codigo_cliente = m.ficha) then m.ficha end,
       case m.ficha
         when 'CSPMU1062' then 'Cotitular de la cuenta CSPMU1062 (titular CSPFU8973). codigo_reporte NULL hasta decidir el R03 (noviembre).'
         when 'CSPFU1988' then 'KYC y PEP: los de su código individual (comparación contra el formulario C2, 19-oct-2026). domicilio_fiscal_igual pendiente de ratificar con la clienta.'
         when 'CSPFU8973' then 'Titular de la cuenta CSPMU1062. Sin KYC, PEP ni EBR; su perfil_riesgo no tiene resultado (cuenta como NULL).'
       end
  from _personas m;

-- --- 2 · cuentas_ibkr ----------------------------------------------------------
insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo)
select c.cuenta_ibkr, c.codigo_cliente, case when c.es_conjunta then 'conjunta' else 'individual' end
  from public.clientes c where c.cuenta_ibkr is not null;

-- --- 3 · cuenta_titulares ------------------------------------------------------
-- Individuales: el titular es la persona de ese mismo código.
insert into public.cuenta_titulares (cuenta_ibkr, persona_id, rol)
select ci.cuenta_ibkr, p.id, 'titular'
  from public.cuentas_ibkr ci join public.personas p on p.codigo_ficha = ci.codigo_cliente
 where ci.tipo = 'individual';

-- Conjuntas: explícitas.
insert into public.cuenta_titulares (cuenta_ibkr, persona_id, rol)
select ci.cuenta_ibkr, p.id, j.rol
  from (values ('CSPFU1488', 'CSPFU6388', 'titular'), ('CSPFU1488', 'CSPFU1390', 'cotitular'),
               ('CSPFU2162', 'CSPFU6388', 'titular'), ('CSPFU2162', 'CSPFU1062', 'cotitular'),
               ('CSPFU8588', 'CSPFU6388', 'titular'), ('CSPFU8588', 'CSPFU8488', 'cotitular'),
               ('CSPMU3071', 'CSPMU7486', 'titular'), ('CSPMU3071', 'CSPFU1988', 'cotitular'),
               ('CSPMU1062', 'CSPFU8973', 'titular'), ('CSPMU1062', 'CSPMU1062', 'cotitular'))
       as j(cuenta_de, ficha, rol)
  join public.cuentas_ibkr ci on ci.codigo_cliente = j.cuenta_de and ci.tipo = 'conjunta'
  join public.personas p on p.codigo_ficha = j.ficha;

-- --- 4 · beneficiario B2 de CSPFU2963 ---------------------------------------------
update public.beneficiarios
   set persona_id = (select id from public.personas where codigo_ficha = 'CSPMU7486')
 where id = 'c15f265d-0ad4-45d7-a65b-8007e226c32c' and codigo_cliente = 'CSPFU2963' and persona_id is null;

-- --- 5 · Asiento manual -----------------------------------------------------------
insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('personas', 'bloque2-backfill', 'backfill_persona_cuenta',
        'Backfill del modelo persona ↔ cuenta (bloque 2): 32 personas, 35 cuentas, 40 titularidades y el '
        'B2 de CSPFU2963 vinculado a la persona CSPMU7486. Punteros por código individual; los datos de las '
        'filas de cuentas conjuntas se quedan en la cuenta.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'personas', 32, 'cuentas', 35, 'titularidades', 40,
                           'excepcion_declarada', 'CSPMU1062: IPS y EBR NULL, falta la titular CSPFU8973'));

-- --- 6 · Verificación dentro de la transacción ---------------------------------
create temporary table _por_cuenta on commit drop as
with persona as (
  select p.id, coalesce(p.codigo_reporte, p.codigo_ficha) as etiqueta,
         (select nullif(btrim(coalesce(r.perfil_ajustado, r.resultado_perfil)), '')
            from public.perfil_riesgo r where r.codigo_cliente = p.codigo_ips) as ips,
         (select e.grado_riesgo from public.ebr_evaluaciones e where e.codigo_cliente = p.codigo_ebr
           order by e.fecha_evaluacion desc limit 1) as ebr
    from public.personas p
), titular as (
  select t.cuenta_ibkr, pe.*,
         case pe.ips when 'Libre' then 1 when 'Bajo' then 2 when 'Moderado' then 3 when 'Alto' then 4 end as rango_ips,
         case pe.ebr when 'BAJO' then 1 when 'MEDIO' then 2 when 'ALTO' then 3 end as rango_ebr
    from public.cuenta_titulares t join persona pe on pe.id = t.persona_id
)
select ci.cuenta_ibkr, ci.codigo_cliente, ci.tipo, count(*) as titulares,
       count(*) filter (where ti.ips is not null and ti.rango_ips is null)
       + count(*) filter (where ti.ebr is not null and ti.rango_ebr is null) as valores_desconocidos,
       case when bool_or(ti.ips is null) then null
            else (array['Libre', 'Bajo', 'Moderado', 'Alto'])[min(ti.rango_ips)] end as ips_regla,
       case when bool_or(ti.ebr is null) then null
            else (array['BAJO', 'MEDIO', 'ALTO'])[max(ti.rango_ebr)] end as ebr_regla,
       string_agg(ti.etiqueta, ',' order by ti.etiqueta) filter (where ti.ips is null) as faltan_ips,
       string_agg(ti.etiqueta, ',' order by ti.etiqueta) filter (where ti.ebr is null) as faltan_ebr,
       (select nullif(btrim(coalesce(r.perfil_ajustado, r.resultado_perfil)), '')
          from public.perfil_riesgo r where r.codigo_cliente = ci.codigo_cliente) as ips_hoy,
       (select e.grado_riesgo from public.ebr_evaluaciones e where e.codigo_cliente = ci.codigo_cliente
         order by e.fecha_evaluacion desc limit 1) as ebr_hoy
  from public.cuentas_ibkr ci join titular ti on ti.cuenta_ibkr = ci.cuenta_ibkr
 group by ci.cuenta_ibkr, ci.codigo_cliente, ci.tipo;

do $$
declare v text; n bigint;
begin
  if (select count(*) from public.personas) <> 32 or (select count(*) from public.cuentas_ibkr) <> 35
     or (select count(*) from public.cuenta_titulares) <> 40 then
    raise exception 'verificación: los conteos no son 32 / 35 / 40.';
  end if;
  -- Ningún puntero falta ni sobra: existe si y solo si el registro existe en su código.
  select count(*) into n from public.personas p
   where (p.codigo_kyc is null) = exists (select 1 from public.kyc_detalle k where k.codigo_cliente = p.codigo_ficha)
      or (p.codigo_pep is null) = exists (select 1 from public.pep_listas x where x.codigo_cliente = p.codigo_ficha)
      or (p.codigo_ips is null) = exists (select 1 from public.perfil_riesgo r where r.codigo_cliente = p.codigo_ficha)
      or (p.codigo_ebr is null) = exists (select 1 from public.ebr_evaluaciones e where e.codigo_cliente = p.codigo_ficha)
      or coalesce(p.codigo_kyc, p.codigo_ficha) <> p.codigo_ficha or coalesce(p.codigo_pep, p.codigo_ficha) <> p.codigo_ficha
      or coalesce(p.codigo_ips, p.codigo_ficha) <> p.codigo_ficha or coalesce(p.codigo_ebr, p.codigo_ficha) <> p.codigo_ficha;
  if n <> 0 then raise exception 'verificación: % personas con un puntero que falta o sobra.', n; end if;
  -- Los 36 códigos cubiertos: ficha de una persona o código de una cuenta.
  select string_agg(c.codigo_cliente, ',') into v from public.clientes c
   where not exists (select 1 from public.personas p where p.codigo_ficha = c.codigo_cliente)
     and not exists (select 1 from public.cuentas_ibkr ci where ci.codigo_cliente = c.codigo_cliente);
  if v is not null then raise exception 'verificación: códigos sin persona ni cuenta: %', v; end if;
  -- Un titular por cuenta; individuales con un solo titular; conjuntas con dos.
  if exists (select 1 from _por_cuenta where (tipo = 'individual' and titulares <> 1) or (tipo = 'conjunta' and titulares <> 2))
     or (select count(*) from public.cuenta_titulares where rol = 'titular') <> 35 then
    raise exception 'verificación: titularidades mal formadas.';
  end if;
  if exists (select 1 from _por_cuenta where valores_desconocidos > 0) then
    raise exception 'verificación: hay perfiles o grados fuera del catálogo de la regla.';
  end if;
  -- Regla de conjuntas: por cuenta, lo mismo que hoy da el código...
  select string_agg(codigo_cliente, ',' order by codigo_cliente) into v from _por_cuenta
   where codigo_cliente <> 'CSPMU1062'
     and (ips_regla is distinct from ips_hoy or ebr_regla is distinct from ebr_hoy);
  if v is not null then raise exception 'verificación: la regla no da lo mismo que hoy en: %', v; end if;
  -- ...con la única excepción declarada.
  if not exists (select 1 from _por_cuenta where codigo_cliente = 'CSPMU1062'
                   and ips_regla is null and ebr_regla is null
                   and faltan_ips = 'CSPFU8973' and faltan_ebr = 'CSPFU8973') then
    raise exception 'verificación: CSPMU1062 debía salir NULL con CSPFU8973 como faltante.';
  end if;
  -- Ninguna tabla existente cambió, salvo la fila B2 de beneficiarios.
  update _huella h set despues = x.h from (
    select 'beneficiarios_sin_persona_id' t, md5(coalesce(string_agg((to_jsonb(b) - 'persona_id')::text, '' order by (to_jsonb(b) - 'persona_id')::text), '')) h
      from public.beneficiarios b) x where h.tabla = x.t;
  for v in select tabla from _huella where tabla <> 'beneficiarios_sin_persona_id' loop
    execute format('update _huella set despues = (select md5(coalesce(string_agg(to_jsonb(x)::text, '''' order by to_jsonb(x)::text), '''')) from public.%I x) where tabla = %L', v, v);
  end loop;
  select string_agg(tabla, ',') into v from _huella where antes is distinct from despues;
  if v is not null then raise exception 'verificación: cambiaron tablas que no debían: %', v; end if;
  if (select count(*) from public.beneficiarios where persona_id is not null) <> 1
     or not exists (select 1 from public.beneficiarios b join public.personas p on p.id = b.persona_id
                     where b.id = 'c15f265d-0ad4-45d7-a65b-8007e226c32c' and p.codigo_ficha = 'CSPMU7486') then
    raise exception 'verificación: el B2 de CSPFU2963 no quedó vinculado a la persona CSPMU7486.';
  end if;
  -- Bitácora de esta transacción: 32 + 35 + 40 inserts, 1 cambio de persona_id y el manual.
  if (select count(*) from public.bitacora where created_at = now()) <> 109
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: los asientos de bitácora no son 109 con el usuario pasado.';
  end if;
end $$;

-- Resultado
select 'personas / cuentas / titularidades' as chequeo,
       (select count(*) from public.personas)::text || ' / ' || (select count(*) from public.cuentas_ibkr)
       || ' / ' || (select count(*) from public.cuenta_titulares) as estado
union all
select 'conjuntas (IPS · EBR por la regla)',
       (select string_agg(codigo_cliente || ' ' || coalesce(ips_regla, 'NULL') || '·' || coalesce(ebr_regla, 'NULL')
                          || coalesce(' falta ' || faltan_ips, ''), ' | ' order by codigo_cliente)
          from _por_cuenta where tipo = 'conjunta')
union all
select 'cuentas iguales a hoy', (select count(*) from _por_cuenta
         where ips_regla is not distinct from ips_hoy and ebr_regla is not distinct from ebr_hoy)::text || ' de 35 (excepción: CSPMU1062)'
union all
select 'tablas existentes sin cambio', (select count(*) from _huella where antes = despues)::text || ' de '
       || (select count(*) from _huella)::text
union all
select 'beneficiario B2 vinculado', (select count(*) from public.beneficiarios where persona_id is not null)::text
union all
select 'asientos de bitácora', (select count(*) from public.bitacora where created_at = now())::text;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
