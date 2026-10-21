-- Datos SINTÉTICOS para la réplica de 2026-10-21-pep-procedencia-cspfu6388.sql.
-- Solo códigos, cuentas inventadas y el estado de pep_listas que el script espera
-- (mismo patrón que producción el 21-oct-2026). Sin nombres ni RFC.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr, es_conjunta) values
  ('CSPFU6388', 'vigente', 'U90000001', false),
  ('CSPFU1488', 'vigente', 'U90000002', true),
  ('CSPFU8588', 'vigente', 'U90000003', true),
  ('CSPFU1390', 'vigente', 'U90000004', false);

insert into public.personas (codigo_reporte, codigo_ficha, codigo_pep) values ('CSPFU6388', 'CSPFU6388', 'CSPFU6388');

insert into public.pep_listas (codigo_cliente, es_pep, es_pep_nacional, es_pep_extranjero, familiar_pep_nacional,
                               familiar_pep_extranjero, tiene_relacionado_pep, pep_declaracion_fecha, pep_declaracion_fuente)
select codigo_cliente, false, false, false, false, false, false,
       case when codigo_cliente = 'CSPFU8588' then date '2026-09-04' else date '2026-08-14' end,
       'Migrado de la declaracion original. Pendiente confirmar si es PEP nacional o extranjero en la revision anual.'
  from public.clientes;

delete from public.bitacora;
