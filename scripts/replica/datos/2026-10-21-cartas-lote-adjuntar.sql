-- Datos SINTÉTICOS para la réplica de 2026-10-21-cartas-lote-adjuntar.sql.
-- Los 26 códigos del lote como 203 por carta con liga a Drive y sin carta en el
-- bucket, cada uno con su persona. Más dos códigos fuera del lote: una cuenta
-- conjunta y una baja. Cuentas y ligas inventadas; sin nombres ni RFC.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr, carta_sofisticado_firmada, carta_sofisticado_url,
                             clasificacion_inversionista, clasificacion_fuente, clasificacion_fecha, clasificacion_nota)
select c, case when c = 'CSPMU1089' then 'inactivo' else 'vigente' end, 'U' || (90000000 + row_number() over (order by c))::text, true,
       'https://drive.google.com/file/d/sintetico-' || c, '203', 'carta_firmada', date '2026-10-06', 'backfill sintético'
  from unnest(array['CSPFU1062','CSPFU1087','CSPFU1270','CSPFU1289','CSPFU1390','CSPFU2092','CSPFU2463','CSPFU6388',
                    'CSPFU6760','CSPFU6888','CSPFU6964','CSPFU7179','CSPFU7371','CSPFU7580','CSPFU7589','CSPFU7990',
                    'CSPFU8085','CSPFU8487','CSPFU8488','CSPFU8967','CSPFU8968','CSPFU8973','CSPFU9251','CSPMU1062',
                    'CSPMU7486','CSPMU1089']) as c;
insert into public.personas (codigo_reporte, codigo_ficha)
select case when codigo_cliente = 'CSPMU1062' then null else codigo_cliente end, codigo_cliente from public.clientes;

-- Fuera del lote: una cuenta conjunta (no es persona) y una baja.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr, es_conjunta) values ('CSPFU1488', 'vigente', 'U99999901', true);
insert into public.clientes (codigo_cliente, status, cuenta_ibkr, fecha_baja, motivo_baja)
values ('CSPFU8385', 'baja', 'U99999902', date '2026-09-30', 'sintético');

delete from public.bitacora;
