-- ===========================================================================
-- CSPMU1062 · la cuenta conjunta conserva el IPS del cotitular (IPS fijado)
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
-- Réplica del repo (npm run replica, datos sintéticos): ensayo sin rastro; real
-- con el IPS fijado solo en CSPMU1062, histórico 0 → 1 y 4 asientos;
-- re-ejecución detenida en la guarda. Cinco mutaciones, cada una detenida: IPS de
-- otro código, aplicado a todas las cuentas, motivo distinto, sin fecha (CHECK
-- cuentas_ibkr_ips_fijado_completo) y otro campo de la cuenta tocado.
-- Ensayo en producción, 16-nov-2026 (ROLLBACK, código de salida 0, md5 del archivo
-- ensayado d71270c12b8e98e997e1492a5c622628, que solo difiere de este en esta
-- cabecera): CSPMU1062 → CSPMU1062 al 2026-11-12, histórico 3 → 4, bitácora
-- 1839 → 1843. Verificado después por MCP: ninguna cuenta con IPS fijado,
-- histórico en 3, bitácora en 1839.
--
-- POR QUÉ
--
-- Decisión de Claudio del 12-nov-2026 (registrada en la bitácora del Día 61 de su
-- Proyecto; no estaba en la bitácora de la base): la conjunta CSPMU1062 conserva
-- el IPS de la persona CSPMU1062 (Moderado, Consolidación); el IPS de su titular
-- CSPFU8973 solo cuenta para su expediente individual. Sin esto, la regla general
-- de las conjuntas (el más conservador; si falta uno, SIN_PERFIL) la deja en
-- SIN_PERFIL, porque CSPFU8973 no tiene perfil. Se modela como dato
-- (cuentas_ibkr.codigo_ips_fijado, migración 2026-11-16-01), no como caso especial.
--
-- QUÉ HACE
--
-- Un UPDATE de la fila de la cuenta conjunta CSPMU1062: codigo_ips_fijado,
-- motivo_ips_fijado y fecha_ips_fijado (2026-11-12). El trigger archiva la
-- versión anterior y la bitácora asienta los tres campos; más un asiento
-- manual con la decisión. Nada más cambia.
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
begin
  if (select count(*) from public.cuentas_ibkr where codigo_cliente = 'CSPMU1062' and tipo = 'conjunta'
        and codigo_ips_fijado is null and motivo_ips_fijado is null and fecha_ips_fijado is null) <> 1 then
    raise exception 'guarda: la conjunta CSPMU1062 no existe o ya tiene IPS fijado; el script no es re-ejecutable.';
  end if;
  if exists (select 1 from public.cuentas_ibkr where codigo_ips_fijado is not null) then
    raise exception 'guarda: ya hay otra cuenta con IPS fijado: revisar antes de seguir.';
  end if;
  -- La decisión es «conserva su IPS actual (Moderado, Consolidación)»: si cambió, no se aplica a ciegas.
  if (select coalesce(perfil_ajustado, resultado_perfil) || '|' || fase || '|' || (fecha_calculo is not null)::text
        from public.perfil_riesgo where codigo_cliente = 'CSPMU1062') is distinct from 'Moderado|Consolidacion|true' then
    raise exception 'guarda: el IPS de CSPMU1062 ya no es Moderado / Consolidación con fecha de cálculo.';
  end if;
end $$;

create temporary table _antes on commit drop as
select (select count(*) from public.bitacora) as bitacora,
       (select count(*) from public.cuentas_ibkr_historico) as historico,
       (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.cuentas_ibkr x where x.codigo_cliente <> 'CSPMU1062') as otras,
       (select (to_jsonb(x) - array['codigo_ips_fijado', 'motivo_ips_fijado', 'fecha_ips_fijado'])::text
          from public.cuentas_ibkr x where x.codigo_cliente = 'CSPMU1062') as esta;

-- --- 1 · IPS fijado ---------------------------------------------------------------
update public.cuentas_ibkr
   set codigo_ips_fijado = 'CSPMU1062',
       motivo_ips_fijado = 'Determinación del Asesor (12-nov-2026): la cuenta conjunta conserva el IPS del cotitular '
                           'CSPMU1062; pendiente de confirmar con el Oficial de Cumplimiento.',
       fecha_ips_fijado  = date '2026-11-12'
 where codigo_cliente = 'CSPMU1062' and tipo = 'conjunta';

insert into public.bitacora (entidad, entidad_id, accion, motivo, usuario, origen, metadata)
values ('cuentas_ibkr', 'CSPMU1062', 'ips_fijado',
        'La conjunta CSPMU1062 conserva el IPS de la persona CSPMU1062 (Moderado, Consolidación); el IPS de CSPFU8973 '
        'solo cuenta para su expediente individual. Decisión de Claudio del 12-nov-2026, pendiente de confirmar con el '
        'Oficial de Cumplimiento.',
        fn_firmante_sesion(), 'migracion',
        jsonb_build_object('canal', 'psql', 'script', '2026-11-16-02-ips-fijado-cspmu1062.sql',
                           'fuente_decision', 'bitácora del Día 61 del Proyecto de Claudio (12-nov-2026)'));

-- --- 2 · Verificación dentro de la transacción ---------------------------------
do $$
begin
  if (select codigo_cliente || '|' || codigo_ips_fijado || '|' || fecha_ips_fijado || '|' || motivo_ips_fijado
        from public.cuentas_ibkr where codigo_ips_fijado is not null)
     is distinct from 'CSPMU1062|CSPMU1062|2026-11-12|Determinación del Asesor (12-nov-2026): la cuenta conjunta '
                      'conserva el IPS del cotitular CSPMU1062; pendiente de confirmar con el Oficial de Cumplimiento.' then
    raise exception 'verificación: el IPS fijado no quedó solo en CSPMU1062 con su código, fecha y motivo.';
  end if;
  if (select md5(string_agg(to_jsonb(x)::text, '' order by x.id)) from public.cuentas_ibkr x where x.codigo_cliente <> 'CSPMU1062')
       is distinct from (select otras from _antes)
     or (select (to_jsonb(x) - array['codigo_ips_fijado', 'motivo_ips_fijado', 'fecha_ips_fijado'])::text
           from public.cuentas_ibkr x where x.codigo_cliente = 'CSPMU1062') is distinct from (select esta from _antes) then
    raise exception 'verificación: cambió otra cuenta, u otro campo de CSPMU1062.';
  end if;
  if (select count(*) from public.cuentas_ibkr_historico) <> (select historico from _antes) + 1
     or (select codigo_ips_fijado is null and codigo_cliente = 'CSPMU1062' from public.cuentas_ibkr_historico
          where archivado_en = now()) is not true then
    raise exception 'verificación: el histórico no tiene la versión anterior (sin IPS fijado).';
  end if;
  if (select count(*) from public.bitacora where created_at = now()) <> 4
     or (select count(*) from public.bitacora where created_at = now() and origen = 'trigger' and entidad = 'cuentas_ibkr') <> 3
     or (select count(*) from public.bitacora) <> (select bitacora from _antes) + 4
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: la bitácora no tiene 3 asientos del trigger + 1 manual con el usuario pasado.';
  end if;
end $$;

select codigo_cliente, codigo_ips_fijado, fecha_ips_fijado::text as fecha,
       ((select historico from _antes) || ' → ' || (select count(*) from public.cuentas_ibkr_historico)) as historico,
       ((select bitacora from _antes) || ' → ' || (select count(*) from public.bitacora)) as bitacora
  from public.cuentas_ibkr where codigo_ips_fijado is not null;
-- CUERPO>>

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
