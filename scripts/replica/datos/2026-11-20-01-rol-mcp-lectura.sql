-- Datos SINTÉTICOS para la réplica de 2026-11-20-01-rol-mcp-lectura.sql.
-- Un cliente con identidad inventada: la autoprueba comprueba que mcp_lectura lee
-- su código y su status, pero NO su nombre. Sin datos reales.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr, nombre, apellido_paterno)
values ('CSPFU9001', 'vigente', 'U90000001', 'Sintético', 'Prueba');
