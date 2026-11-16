-- Datos SINTÉTICOS para la réplica de 2026-11-16-02-ips-fijado-cspmu1062.sql.
-- La conjunta CSPMU1062 (cuenta inventada), otra cuenta que no debe cambiar, y el
-- perfil Moderado / Consolidación que la guarda exige. Sin nombres.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values
  ('CSPMU1062', 'vigente',  'U90000013'),
  ('CSPFU8973', 'inactivo', 'U90000002'),
  ('CSPFU9001', 'vigente',  'U90000001');
insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo) values
  ('U90000013', 'CSPMU1062', 'conjunta'),
  ('U90000002', 'CSPFU8973', 'individual'),
  ('U90000001', 'CSPFU9001', 'individual');
insert into public.perfil_riesgo (codigo_cliente, resultado_perfil, fase, fecha_calculo) values
  ('CSPMU1062', 'Moderado', 'Consolidacion', timestamptz '2026-09-29 12:00:00-06');
