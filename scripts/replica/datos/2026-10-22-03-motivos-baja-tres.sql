-- Datos SINTÉTICOS para la réplica de 2026-10-22-motivos-baja-tres.sql.
-- Los tres códigos de baja con el motivo que se corrige, y otro cliente que no cambia.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr, fecha_baja, motivo_baja) values
  ('CSPFU1889', 'baja', 'U90000001', date '2026-10-22', 'Se dió de baja por petición del cleinte en enero de 2026'),
  ('CSPFU6964', 'baja', 'U90000002', date '2026-10-22', 'Solicitó el cierre de su cuenta por escrito el 7 de octubre'),
  ('CSPFU7371', 'baja', 'U90000003', date '2026-10-22', 'Solicitó el cierre de su cuenta por escrito el 7 de octubre');
insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values ('CSPFU1270', 'vigente', 'U90000004');
delete from public.bitacora;
