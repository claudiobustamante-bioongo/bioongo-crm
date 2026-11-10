-- Datos SINTÉTICOS para la réplica de 2026-11-10-01-ibkr-flex.sql.
-- Dos cuentas para que la autoprueba tenga dónde cargar. Sin nombres.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values
  ('CSPFU9001', 'vigente', 'U90000001'),
  ('CSPFU9002', 'vigente', 'U90000002');

insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo) values
  ('U90000001', 'CSPFU9001', 'individual'),
  ('U90000002', 'CSPFU9002', 'individual');
