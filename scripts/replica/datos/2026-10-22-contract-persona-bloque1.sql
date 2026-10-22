-- Datos SINTÉTICOS para la réplica de 2026-10-22-contract-persona-bloque1.sql.
-- Fichas de persona (una sin cuenta), las cuatro cuentas conjuntas con sus filas
-- heredadas y un beneficiario ya vinculado a una persona. Nombres de relleno.
insert into public.clientes (codigo_cliente, status, cuenta_ibkr, es_conjunta, nombre, apellido_paterno, rfc, correo, ingreso_neto_mensual) values
  ('CSPFU6388', 'vigente', 'U90000001', false, 'Relleno', 'Uno',    'XAXX010101000', 'uno@relleno.test', 1000),
  ('CSPMU7486', 'vigente', 'U90000002', false, 'Relleno', 'Dos',    'XBXX010101000', 'dos@relleno.test', 2000),
  ('CSPFU1988', 'vigente', null,        false, 'Relleno', 'Tres',   'XCXX010101000', null, null),
  ('CSPFU2963', 'vigente', 'U90000003', false, 'Relleno', 'Cuatro', 'XDXX010101000', 'cuatro@relleno.test', 4000),
  ('CSPFU1488', 'vigente', 'U90000011', true,  'Relleno', 'Uno',    'XAXX010101000', null, null),
  ('CSPFU2162', 'vigente', 'U90000012', true,  'Relleno', 'Cinco',  'XEXX010101000', null, null),
  ('CSPFU8588', 'vigente', 'U90000013', true,  'Relleno', 'Uno',    'XAXX010101000', null, null),
  ('CSPMU3071', 'vigente', 'U90000014', true,  'Relleno', 'Dos',    'XBXX010101000', null, null);

insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo)
select cuenta_ibkr, codigo_cliente, case when es_conjunta then 'conjunta' else 'individual' end
  from public.clientes where cuenta_ibkr is not null;

insert into public.kyc_detalle (codigo_cliente, calle)
select codigo_cliente, 'sintética' from public.clientes;
insert into public.pep_listas (codigo_cliente, es_pep) select codigo_cliente, false from public.clientes;
insert into public.perfil_riesgo (codigo_cliente, resultado_perfil) select codigo_cliente, 'Moderado' from public.clientes;
insert into public.ebr_evaluaciones (codigo_cliente, grado_riesgo, regimen, razon_clasificacion, fundamento_clasificacion,
  supuestos_evaluados, supuestos_activos, matriz_factores, matriz_puntaje_total, matriz_banda, es_pep, pep_extranjero,
  aplica_medidas_pep, requiere_aprobacion_oficial, en_lista_bloqueadas, evaluacion_preliminar, motivos_preliminar,
  verificaciones_pendientes, observaciones, entrada, fecha_evaluacion, override_source, elaboro, revisa_autoriza)
select c, 'BAJO', 'Ordinario', 'x', 'x', '[]', 0, '[]', 43, 'Baja', false, false, false, false, false, true, '[]', '[]', '[]', '{}',
       now() - (n || ' days')::interval, 'x', 'x', 'x'
  from public.clientes cl, lateral (values (cl.codigo_cliente, 1), (cl.codigo_cliente, 2)) v(c, n);
insert into public.propietario_real (codigo_cliente, aplica) select codigo_cliente, false from public.clientes;
insert into public.transaccionalidad (codigo_cliente, ahorro_declarado, fecha_declaracion)
select codigo_cliente, 100, date '2026-08-01' from public.clientes where cuenta_ibkr is not null;

insert into public.personas (codigo_reporte, codigo_ficha, codigo_kyc, codigo_pep, codigo_ips, codigo_ebr)
select c, c, c, c, c, c from unnest(array['CSPFU6388', 'CSPMU7486', 'CSPFU1988', 'CSPFU2963']) c;

insert into public.beneficiarios (codigo_cliente, relacion, proporcion, persona_id)
select 'CSPFU2963', 'Hijo o Hija', 25, id from public.personas where codigo_ficha = 'CSPMU7486';
insert into public.beneficiarios (codigo_cliente, relacion, proporcion) values
  ('CSPFU2963', 'Esposo o Esposa', 75), ('CSPFU6388', 'Hijo o Hija', 100),
  ('CSPFU1488', 'Hijo o Hija', 50), ('CSPFU1488', 'Hijo o Hija', 50), ('CSPMU3071', 'Hijo o Hija', 100);

delete from public.bitacora;
