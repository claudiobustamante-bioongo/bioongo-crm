# Migraciones

Scripts de SQL que se corrieron **a mano** en el SQL Editor de Supabase, en
orden cronológico por nombre de archivo.

Esto NO es una cadena de migraciones de la CLI de Supabase y no se aplica sola.
El acceso de la aplicación a la base es de solo lectura para DDL: los cambios de
esquema y las correcciones de datos los ejecuta Claudio pegando el script. Esta
carpeta es el **archivo de lo ya ejecutado**, no una cola de lo pendiente.

Reglas de la carpeta:

- Un archivo por script, nombrado `AAAA-MM-DD-asunto.sql`.
- La cabecera dice qué hizo, cuándo se ejecutó y **qué quedó verificado después**
  de correrlo. Un script archivado sin su resultado no permite reconstruir nada.
- Se archiva lo que YA se corrió. Si un script se propuso y no se ejecutó, no va
  aquí: no habría cómo distinguir el estado real de la base del propuesto.
- Nunca llevan nombres, RFC, CURP ni correos. Los `codigo_cliente` sí: sin ellos
  el script deja de decir sobre qué expedientes actuó.
