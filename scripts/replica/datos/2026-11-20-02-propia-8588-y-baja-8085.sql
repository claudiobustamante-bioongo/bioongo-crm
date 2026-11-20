-- Datos SINTÉTICOS para la réplica de 2026-11-20-02-propia-8588-y-baja-8085.sql.
-- Los dos códigos que toca el script, con cuentas inventadas, y un tercero que no
-- debe cambiar. Sin nombres.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values
  ('CSPFU8588', 'vigente', 'U90000088'),
  ('CSPFU8085', 'vigente', 'U90000085'),
  ('CSPFU9001', 'vigente', 'U90000001');
insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo) values
  ('U90000088', 'CSPFU8588', 'conjunta'),
  ('U90000085', 'CSPFU8085', 'individual'),
  ('U90000001', 'CSPFU9001', 'individual');
