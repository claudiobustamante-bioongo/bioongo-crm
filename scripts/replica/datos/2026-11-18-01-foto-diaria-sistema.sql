-- Datos SINTÉTICOS para la réplica de 2026-11-18-01-foto-diaria-sistema.sql.
-- Una cuenta vigente (la autoprueba le carga una foto de sistema) y una cerrada
-- (la carga de sistema debe rechazarla: la regla es «cerrada o de baja»). Sin nombres.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values
  ('CSPFU9001', 'vigente', 'U90000001'),
  ('CSPFU9003', 'vigente', 'U90000003');
insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo) values
  ('U90000001', 'CSPFU9001', 'individual'),
  ('U90000003', 'CSPFU9003', 'individual');
update public.cuentas_ibkr set fecha_cierre = date '2023-01-20', motivo_cierre = 'sintético'
 where cuenta_ibkr = 'U90000003';
