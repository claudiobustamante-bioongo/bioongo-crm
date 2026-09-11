import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Solo el alias `@/` del tsconfig, para poder probar las rutas de `app/api`, que
 * importan con él. Los tests de `lib/` no lo necesitan: importan con rutas
 * relativas.
 *
 * Se resuelve a mano y no con `vite-tsconfig-paths` para no sumar una
 * dependencia por una línea. Si el tsconfig gana más alias, hay que reflejarlos
 * aquí.
 *
 * La expresión exige la diagonal: `@supabase/...` no debe caer en el alias.
 */
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) }],
  },
});
