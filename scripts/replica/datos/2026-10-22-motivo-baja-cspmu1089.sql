-- Datos SINTÉTICOS para la réplica de 2026-10-22-motivo-baja-cspmu1089.sql.
-- CSPMU1089 de baja con el motivo que se corrige, y otro cliente que no debe cambiar.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr, fecha_baja, motivo_baja) values
  ('CSPMU1089', 'baja', 'U90000001', date '2026-10-22', 'Requirió el propio cliente darse de baja');
insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values ('CSPFU1270', 'vigente', 'U90000002');
delete from public.bitacora;
