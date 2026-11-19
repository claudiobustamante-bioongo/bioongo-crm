@AGENTS.md

## Reglas de supervisión (Claudio)

- SIEMPRE pide aprobación explícita antes de escribir, editar o borrar archivos.
- Comandos (canon del 19-nov-2026): Claude los ejecuta; Claudio ya no los copia con «!».
  - Sin pedir permiso: pruebas, corridas en seco, vistas previas, ensayos con ROLLBACK, deno check/test, git status/log/diff, y las herramientas de lectura del MCP de Supabase.
  - El SQL libre por MCP (`mcp__supabase__execute_sql`) pide confirmación: el 19-nov se comprobó que `read_only=true` se salta con `set transaction read write`. Se queda en «ask» hasta que el MCP use un rol sin privilegios de escritura.
  - Con aprobación de Claudio POR SU NOMBRE («apruebo el real de X») y confirmación de Claude Code: reales en producción (psql modo=real; cargar-foto, fix y evaluar con --confirmar), supabase functions deploy, git push. Antes de pedir un real, siempre el resumen del ensayo.
  - Nunca: valores de secretos, .env.local, supabase secrets set, Vault, ni modos que se salten los permisos.
- NUNCA uses modo auto-accept / auto-aprobación, ni sugieras activarlo.
- Si una tarea tiene varios pasos, muestra el plan antes de ejecutar y espera confirmación.
- Ante cualquier operación destructiva (borrar, sobrescribir, drop, rm, DELETE en SQL), pide confirmación explícita aunque ya se haya aprobado el paso anterior.
- Los archivos con datos personales reales (RFC, CURP, nombres de clientes) nunca se commitean a Git.
