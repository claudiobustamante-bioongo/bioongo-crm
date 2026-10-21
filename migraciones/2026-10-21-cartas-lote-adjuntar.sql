-- ===========================================================================
-- Cartas de clasificación firmadas · lote de 26 en modo adjuntar
--
-- Se corre con psql (migraciones/README.md, «Correr un script con psql»):
--   psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real \
--        -v usuario=<correo> -f <este archivo>
-- Sin datos personales: solo códigos, sha256, tamaños, fechas y rutas del bucket.
-- Generado por un script a partir de la carpeta de cartas firmadas; el RFC del
-- nombre de cada archivo se usó solo en memoria para encontrar el código.
--
-- EJECUCIÓN · este archivo es byte a byte el que se corre en modo real,
-- cabecera incluida, y no se toca después (regla del 19-oct-2026). La salida del
-- real, la verificación por MCP y el md5 van en el mensaje del commit.
--
-- Antes, en la réplica del repo (npm run replica, datos sintéticos en
-- scripts/replica/datos/): ensayo sin rastro; real 26 de 26 en modo adjuntar,
-- 26/26 con liga anterior en Drive, solo cambió la liga, 78 asientos;
-- re-ejecución detenida en la guarda.
--
-- Ensayo en producción, 21-oct-2026 (ROLLBACK, código de salida 0):
--   cartas registradas             26 (modo adjuntar: 26)
--   liga anterior en Drive         26 de 26
--   clientes: solo cambió la liga  26 de 26
--   asientos de bitácora           78
-- Verificado después por MCP: 2 documentos, 814 asientos y 2 objetos (sin rastro).
--
-- Subida de los 26 PDF al bucket, ANTES del real (scripts/cartas/subir-lote.mjs,
-- upsert: false, sha256 verificado contra el ensayo): «subido 26». Por MCP: 26
-- objetos nuevos sin fila, todos application/pdf, 6 845 884 bytes = la suma de los
-- tamaños de este archivo.
--
-- POR QUÉ
--
-- 26 personas son 203 por carta firmada con la liga a Google Drive y sin la carta
-- en el bucket. Este lote registra su PDF por el mismo camino que la app
-- (fn_registrar_documento, modo adjuntar): la clasificación no cambia, la liga
-- pasa a la interna /api/documentos/<id> y la bitácora guarda la anterior.
-- La carta va solo al código individual de cada persona; las cuentas conjuntas
-- la derivan de sus titulares. Fechas de firma = fecha del contrato, confirmadas
-- por Claudio el 21-oct-2026 (18 del texto del PDF, 8 dadas por él).
--
-- Fuera del lote, a propósito: CSPFU8385 (baja: la función rechaza la carta;
-- pendiente modo «archivo histórico») y CSPFU2963 (ya tenía su carta en el
-- bucket). CSPMU1089 SÍ entra (carta del 2025-03-20): ya no es cliente y su baja
-- (cierre de cuenta del 2026-01-14) va DESPUÉS de este lote, para que la carta
-- quede como evidencia.
--
-- ORDEN: este script se ensaya ANTES de subir los PDF (la función no exige que el
-- objeto exista); luego se suben los 26 al bucket; luego el real; luego se
-- verifica por MCP que cada fila tenga su objeto.
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
create temporary table _lote (codigo text primary key, ruta text not null unique, sha256 text not null,
                              tamano integer not null, fecha date not null) on commit drop;
insert into _lote (codigo, ruta, sha256, tamano, fecha) values
  ('CSPFU1062', 'carta_clasificacion/CSPFU1062/2022-07-11_e6c05feb6018.pdf', 'e6c05feb601860a6606298f1200429080ab9760bbb5b1a7cb813fb109ff0594b', 198884, date '2022-07-11'),
  ('CSPFU1087', 'carta_clasificacion/CSPFU1087/2021-08-09_95082e952155.pdf', '95082e952155c206dd3a0fe5c80c755e69101e3da2c95bee6138ccd2b100c459', 204476, date '2021-08-09'),
  ('CSPFU1270', 'carta_clasificacion/CSPFU1270/2023-07-13_7d486c0ed0a2.pdf', '7d486c0ed0a29e84e9eeb519ae8b8f20232995d76689abf55c9fddcc9171fc4e', 205605, date '2023-07-13'),
  ('CSPFU1289', 'carta_clasificacion/CSPFU1289/2023-09-11_d026895f60e6.pdf', 'd026895f60e6d36b4898d86d8cb6bb14b4119051ae0d3b9b7fcda6e5d6691126', 423869, date '2023-09-11'),
  ('CSPFU1390', 'carta_clasificacion/CSPFU1390/2024-01-12_a1c04e67d27a.pdf', 'a1c04e67d27ac79f5f30a50a45458a77a23898e884454aaa6f93a2d2bc52e2f5', 415270, date '2024-01-12'),
  ('CSPFU2092', 'carta_clasificacion/CSPFU2092/2025-06-17_37a051752c98.pdf', '37a051752c98ce84745bef59e4cb68b9d8624a1e2d5919d0aa6ab4b3015251a4', 421684, date '2025-06-17'),
  ('CSPFU2463', 'carta_clasificacion/CSPFU2463/2026-03-04_2bd17674d46b.pdf', '2bd17674d46b56b0e93aee49c0fadb5bdfbeaf4321f43dbbbf4b0b93ca62c396', 413491, date '2026-03-04'),
  ('CSPFU6388', 'carta_clasificacion/CSPFU6388/2021-07-21_3c4cdfa14035.pdf', '3c4cdfa140351d6c14b5eb91ecb32a20e950815bb3af133ef1859a8280db2e44', 79339, date '2021-07-21'),
  ('CSPFU6760', 'carta_clasificacion/CSPFU6760/2021-08-03_379d7b1ada88.pdf', '379d7b1ada8851bb31500c219268d42da8089b3a11f17c69f46340f447d91deb', 189481, date '2021-08-03'),
  ('CSPFU6888', 'carta_clasificacion/CSPFU6888/2021-08-23_91fd8bb88292.pdf', '91fd8bb8829223cc6ebfc4a5b30de0efaa4fe31a31d99316b19c25f29b221d68', 191029, date '2021-08-23'),
  ('CSPFU6964', 'carta_clasificacion/CSPFU6964/2021-08-31_49c9c4bf261e.pdf', '49c9c4bf261e665f0ef210f37359baac743cc37d8f6b439c6ee19079f90cfa75', 208113, date '2021-08-31'),
  ('CSPFU7179', 'carta_clasificacion/CSPFU7179/2021-09-24_8d79894ddc9a.pdf', '8d79894ddc9ae06016172851e1673875d632c4ba758bb2a68ebc8a7158fef12c', 192577, date '2021-09-24'),
  ('CSPFU7371', 'carta_clasificacion/CSPFU7371/2021-10-19_300b1a11bee4.pdf', '300b1a11bee428b4f8da2507af90f10f21e85b36eb91754c50e8c6c3d5af07b2', 190997, date '2021-10-19'),
  ('CSPFU7580', 'carta_clasificacion/CSPFU7580/2021-11-12_01f3adf54799.pdf', '01f3adf54799b97f86d082d1ec34070e99d4f4533e14e6b7a22bacdb89e16015', 191265, date '2021-11-12'),
  ('CSPFU7589', 'carta_clasificacion/CSPFU7589/2021-11-05_4d74e58861cc.pdf', '4d74e58861ccdf742f8ebef172049cd3c79ea1ca1d01d69ede485e95d9953017', 203211, date '2021-11-05'),
  ('CSPFU7990', 'carta_clasificacion/CSPFU7990/2021-12-14_151b411faf04.pdf', '151b411faf04d0d1b522c7cdef7c4cf1ab9d3f68e59713e8c90b1f8e0c8b0855', 191419, date '2021-12-14'),
  ('CSPFU8085', 'carta_clasificacion/CSPFU8085/2021-12-28_302f229081fe.pdf', '302f229081fe519387b1b73f3bd92a9a24c40011f58d8606e9613392e4f59e13', 203200, date '2021-12-28'),
  ('CSPFU8487', 'carta_clasificacion/CSPFU8487/2022-03-14_00da5784535d.pdf', '00da5784535dcba66f9731ab51d4f67e7d6b95856687b604768a31fc0dff3e12', 196428, date '2022-03-14'),
  ('CSPFU8488', 'carta_clasificacion/CSPFU8488/2022-03-02_fb3790c86998.pdf', 'fb3790c869988c479731500aefe91f78901bf7fd3f121f09a62449e8d6a6b1bf', 193970, date '2022-03-02'),
  ('CSPFU8967', 'carta_clasificacion/CSPFU8967/2022-02-14_6eb3136b0b9e.pdf', '6eb3136b0b9eea9e93aa2ac5951dd943451a0c6acaccd816ac4b0d57bb5fd7bc', 195827, date '2022-02-14'),
  ('CSPFU8968', 'carta_clasificacion/CSPFU8968/2022-02-14_982d337cd227.pdf', '982d337cd2275c37114a49aa9d8d25af005d3ef716c302ec2c19c496fb172de3', 195904, date '2022-02-14'),
  ('CSPFU8973', 'carta_clasificacion/CSPFU8973/2022-02-14_7f360f9c22c4.pdf', '7f360f9c22c4086c051e38beb717a8498b8a5e36e8fb965c3af28e1e8c4e2d1f', 185319, date '2022-02-14'),
  ('CSPFU9251', 'carta_clasificacion/CSPFU9251/2022-01-04_04d17488b18c.pdf', '04d17488b18c71963ebdf0434514efd0f46b380f092b1b1f55b7fc94fa1e7314', 817532, date '2022-01-04'),
  ('CSPMU1062', 'carta_clasificacion/CSPMU1062/2022-09-14_4408fe0fe6ec.pdf', '4408fe0fe6ec7c05088a8d82a2e67cfaf6f55a47275589e10d83076809d8a0e7', 191922, date '2022-09-14'),
  ('CSPMU1089', 'carta_clasificacion/CSPMU1089/2025-03-20_02548d1b1902.pdf', '02548d1b190298dec67c5d99a98332c36aa9df1a0971aa7439c2595a4d7d9834', 202803, date '2025-03-20'),
  ('CSPMU7486', 'carta_clasificacion/CSPMU7486/2026-08-21_42c88b875903.pdf', '42c88b8759037017b01dcffa820857bd91f41c8da736c8d888d3545a08ddce43', 542269, date '2026-08-21');

-- --- 0 · Guardas ---------------------------------------------------------------
do $$
declare v text;
begin
  if (select count(*) from _lote) <> 26 then
    raise exception 'guarda: el lote no son 26 cartas.';
  end if;
  select string_agg(l.codigo, ',') into v from _lote l
   where not exists (select 1 from public.clientes c where c.codigo_cliente = l.codigo
                       and c.clasificacion_fuente = 'carta_firmada' and c.status is distinct from 'baja')
      or not exists (select 1 from public.personas p where p.codigo_ficha = l.codigo);
  if v is not null then
    raise exception 'guarda: no son 203 por carta, están de baja o no son el código individual de una persona: %', v;
  end if;
  select string_agg(l.codigo, ',') into v from _lote l
   where exists (select 1 from public.documentos_expediente d
                  where d.codigo_cliente = l.codigo and d.tipo = 'carta_clasificacion');
  if v is not null then
    raise exception 'guarda: ya tienen carta en el bucket; el lote no es re-ejecutable: %', v;
  end if;
end $$;

create temporary table _clientes_antes on commit drop as
select codigo_cliente, to_jsonb(c) - 'carta_sofisticado_url' as fila, carta_sofisticado_url
  from public.clientes c where codigo_cliente in (select codigo from _lote);

-- --- 1 · Registro, por el mismo camino que la app --------------------------------
create temporary table _resultado on commit drop as
select l.codigo,
       public.fn_registrar_documento(l.codigo, 'carta_clasificacion', l.ruta, l.sha256, l.tamano, l.fecha, null) as r
  from _lote l order by l.codigo;

-- --- 2 · Verificación dentro de la transacción ---------------------------------
do $$
declare v text;
begin
  select string_agg(codigo, ',') into v from _resultado where r ->> 'modo' is distinct from 'adjuntar';
  if v is not null then raise exception 'verificación: no todas salieron en modo adjuntar: %', v; end if;
  if (select count(*) from public.documentos_expediente d join _lote l
        on l.codigo = d.codigo_cliente and l.ruta = d.ruta_storage and l.sha256 = d.sha256
       and l.fecha = d.fecha_documento and d.tipo = 'carta_clasificacion'
       and d.subido_por = (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) <> 26 then
    raise exception 'verificación: no quedaron los 26 documentos con su ruta, sha, fecha y usuario.';
  end if;
  -- La liga pasa a la interna; nada más del cliente cambia.
  select string_agg(a.codigo_cliente, ',') into v
    from _clientes_antes a join public.clientes c on c.codigo_cliente = a.codigo_cliente
    join _resultado x on x.codigo = a.codigo_cliente
   where to_jsonb(c) - 'carta_sofisticado_url' is distinct from a.fila
      or c.carta_sofisticado_url is distinct from '/api/documentos/' || (x.r ->> 'documento_id');
  if v is not null then raise exception 'verificación: cambió algo más que la liga, o la liga no es la interna: %', v; end if;
  -- 3 asientos por carta: insert del documento, cambio de la liga y el manual.
  if (select count(*) from public.bitacora where created_at = now()) <> 78
     or exists (select 1 from public.bitacora where created_at = now()
                  and usuario is distinct from (current_setting('request.jwt.claims', true)::jsonb ->> 'email')) then
    raise exception 'verificación: los asientos de bitácora no son 78 con el usuario pasado.';
  end if;
end $$;

select 'cartas registradas' as chequeo, count(*)::text || ' (modo adjuntar: '
       || count(*) filter (where r ->> 'modo' = 'adjuntar') || ')' as estado from _resultado
union all
select 'liga anterior en Drive', (select count(*) from _clientes_antes where carta_sofisticado_url like '%drive.google.com%')::text || ' de 26'
union all
select 'clientes: solo cambió la liga', '26 de 26'
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
