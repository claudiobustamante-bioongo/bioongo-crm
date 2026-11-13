-- Datos SINTÉTICOS para la réplica de 2026-11-13-02-cuentas-propia-y-cierre.sql.
-- Los cuatro códigos que toca o respeta el script, con cuentas inventadas. Sin nombres.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values
  ('CSPFU1488', 'vigente',  'U90000011'),
  ('CSPFU6388', 'vigente',  'U90000001'),
  ('CSPFU8973', 'inactivo', 'U90000002'),
  ('CSPMU1062', 'vigente',  'U90000013'),
  ('CSPFU2162', 'vigente',  'U90000012');

insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo) values
  ('U90000011', 'CSPFU1488', 'conjunta'),
  ('U90000001', 'CSPFU6388', 'individual'),
  ('U90000002', 'CSPFU8973', 'individual'),
  ('U90000013', 'CSPMU1062', 'conjunta'),
  ('U90000012', 'CSPFU2162', 'conjunta');
