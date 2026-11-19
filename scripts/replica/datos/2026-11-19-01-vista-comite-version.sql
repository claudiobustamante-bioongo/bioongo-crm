-- Datos SINTÉTICOS para la réplica de 2026-11-19-01-vista-comite-version.sql.
-- Una cuenta con una foto y su evaluación 1.1.0 (la autoprueba le agrega dos
-- versiones más y una foto posterior, y lo revierte). Sin nombres.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values ('CSPFU9001', 'vigente', 'U90000001');
insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo) values ('U90000001', 'CSPFU9001', 'individual');
insert into public.sync_ibkr (id, uso, fd, td, to_date_ibkr, xml_sha256, cuentas_xml, cuentas_cargadas, renglones, ignoradas, confirmado_por)
values ('00000000-0000-0000-0000-0000000000a1', 'foto_diaria', date '2026-11-13', date '2026-11-13', date '2026-11-13',
        repeat('a', 64), 1, 1, 2, 0, 'operador@replica.test');
insert into public.posiciones_detalle (sync_id, cuenta_ibkr, fecha_foto, tipo_renglon, ticker, valor_base, moneda_base) values
  ('00000000-0000-0000-0000-0000000000a1', 'U90000001', date '2026-11-13', 'efectivo', 'EFECTIVO', 1000, 'MXN'),
  ('00000000-0000-0000-0000-0000000000a1', 'U90000001', date '2026-11-13', 'nav_ibkr', 'NAV_IBKR', 1000, 'MXN');
insert into public.semaforo_evaluaciones (sync_id, fecha_foto, cuenta_ibkr, estado, version_motor, evaluado_por)
values ('00000000-0000-0000-0000-0000000000a1', date '2026-11-13', 'U90000001', 'INACTIVA', 'semaforo-1.1.0', 'operador@replica.test');
