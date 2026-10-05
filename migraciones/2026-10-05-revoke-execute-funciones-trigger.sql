-- ===========================================================================
-- Higiene: quitar EXECUTE de anon, authenticated y PUBLIC en las funciones de
-- trigger de public
--
-- EJECUTADO el 5 de octubre de 2026 por Claudio Bustamante, a mano, en el SQL
-- Editor de Supabase. Este archivo es el registro de lo que se corrió: desde el
-- `begin` hasta el final es byte a byte el script ejecutado (D_revoke.sql, md5
-- 1a1c69c8f5ebb5949754bae8fd005b97); solo cambió esta cabecera.
--
-- POR QUÉ
--
-- Las cuatro funciones de trigger —fn_bitacora, fn_archivar_perfil_riesgo,
-- fn_archivar_bloqueos y fn_archivar_firmas— nacieron con el EXECUTE por
-- defecto de Supabase. Verificado por MCP antes de correr esto, su ACL era la
-- misma en las cuatro:
--
--   {=X/postgres, postgres=X/postgres, anon=X/postgres,
--    authenticated=X/postgres, service_role=X/postgres}
--
-- No era explotable: una función que devuelve `trigger` no se puede invocar
-- fuera de un trigger. Es higiene: nadie debe tener un permiso que no usa.
-- `=X/postgres` es el grant a PUBLIC; sin revocarlo, anon y authenticated lo
-- seguirían heredando. Por eso se revoca de los tres.
--
-- Postgres exige EXECUTE sobre la función de trigger al CREAR el trigger, no
-- cada vez que dispara: los triggers siguen funcionando para authenticated.
--
-- QUÉ NO HIZO
--
-- No tocó ALTER DEFAULT PRIVILEGES: una función de trigger nueva nacerá otra
-- vez con EXECUTE para anon y authenticated, y habrá que revocárselo en su
-- propia migración. Tampoco tocó las funciones RPC (fn_resolver_coincidencia,
-- fn_levantar_bloqueo, fn_firmante_sesion, fn_tipos_sanciones), que ya nacieron
-- sin EXECUTE para anon ni PUBLIC el mismo día.
--
-- VERIFICADO DESPUÉS DE EJECUTAR
--
-- Antes de producción, en la réplica PGlite (Postgres 17.5) con el mismo ACL
-- que producción: tras el revoke, un UPDATE de perfil_riesgo y un INSERT en
-- clientes como `authenticated` siguieron archivando en el espejo y asentando
-- en bitácora, la prueba con rollback del bloqueo (C2b) siguió en ok, y el
-- script es re-ejecutable sin error.
--
-- En producción, el renglón final del propio script (sección 4), tal como lo
-- devolvió el SQL Editor:
--
--   fn_archivar_bloqueos      anon false · authenticated false · triggers 1   {postgres=X/postgres,service_role=X/postgres}
--   fn_archivar_firmas        anon false · authenticated false · triggers 1   {postgres=X/postgres,service_role=X/postgres}
--   fn_archivar_perfil_riesgo anon false · authenticated false · triggers 1   {postgres=X/postgres,service_role=X/postgres}
--   fn_bitacora               anon false · authenticated false · triggers 12  {postgres=X/postgres,service_role=X/postgres}
--
-- Y después, por MCP (solo lectura), el mismo día, con el mismo resultado más
-- la comprobación de que ningún trigger quedó deshabilitado:
--
--   función                      anon    authenticated  triggers  deshabilitados  ACL
--   fn_archivar_bloqueos         false   false          1         0               {postgres=X/postgres,service_role=X/postgres}
--   fn_archivar_firmas           false   false          1         0               {postgres=X/postgres,service_role=X/postgres}
--   fn_archivar_perfil_riesgo    false   false          1         0               {postgres=X/postgres,service_role=X/postgres}
--   fn_bitacora                  false   false          12        0               {postgres=X/postgres,service_role=X/postgres}
--
--   Las cuatro RPC, sin cambios: anon false · authenticated true.
--
-- Al verificar no había habido ninguna escritura en la base desde el revoke
-- (último asiento de bitácora: 30-sep-2026), así que en producción los
-- triggers todavía no habían disparado después del cambio; eso quedó probado
-- en la réplica.
-- ===========================================================================

begin;

-- --- 1 · Guarda: exactamente las cuatro conocidas ----------------------------
do $$
declare v text;
begin
  select string_agg(proname, ',' order by proname) into v
    from pg_proc where pronamespace = 'public'::regnamespace and prorettype = 'trigger'::regtype;
  if v is distinct from 'fn_archivar_bloqueos,fn_archivar_firmas,fn_archivar_perfil_riesgo,fn_bitacora' then
    raise exception 'Las funciones de trigger de public no son las cuatro esperadas: %', v;
  end if;
end $$;

-- --- 2 · Revoke --------------------------------------------------------------
revoke execute on function public.fn_bitacora()               from public, anon, authenticated;
revoke execute on function public.fn_archivar_perfil_riesgo() from public, anon, authenticated;
revoke execute on function public.fn_archivar_bloqueos()      from public, anon, authenticated;
revoke execute on function public.fn_archivar_firmas()        from public, anon, authenticated;

-- --- 3 · Verificación dentro de la transacción --------------------------------
do $$
begin
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
                and (has_function_privilege('anon', p.oid, 'execute')
                     or has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception 'Alguna función de trigger sigue ejecutable por anon o authenticated.';
  end if;
  if (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where not t.tgisinternal and p.pronamespace = 'public'::regnamespace
         and p.prorettype = 'trigger'::regtype and t.tgenabled <> 'O') <> 0 then
    raise exception 'Hay triggers deshabilitados.';
  end if;
end $$;

commit;

-- --- 4 · Resultado -------------------------------------------------------------
-- Esperado: 4 renglones, todos `anon false · authenticated false · triggers N`,
-- con el ACL sin `=X`, sin `anon=X` y sin `authenticated=X`.
select p.proname as funcion,
       'anon ' || has_function_privilege('anon', p.oid, 'execute')
       || ' · authenticated ' || has_function_privilege('authenticated', p.oid, 'execute')
       || ' · triggers ' || (select count(*) from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal)
       as estado,
       p.proacl::text as acl
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prorettype = 'trigger'::regtype
 order by p.proname;
