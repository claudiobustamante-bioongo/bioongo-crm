import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

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
 *
 * Dos proyectos (20-nov-2026): las pruebas que levantan PGlite (cargan
 * base.sql entera) corrían en paralelo con todo lo demás, llevaban la máquina a
 * carga ~7.5 en 8 núcleos y hacían fallar por tiempo pruebas distintas en cada
 * corrida. Ahora:
 * - «unidad»: todo lo demás, en paralelo, primero (groupOrder 0);
 * - «pglite»: las que importan @electric-sql/pglite, UNA A LA VEZ y después
 *   (groupOrder 1). La lista se arma leyendo los archivos: una prueba nueva con
 *   PGlite cae aquí sola.
 */
const raiz = fileURLToPath(new URL('./', import.meta.url));
const alias = [{ find: /^@\//, replacement: raiz }];

// readdirSync recursivo y no fs.globSync: los tipos de Node del repo (20.x) no
// declaran globSync y `next build` revisa también este archivo.
const PGLITE = ['app', 'lib', 'scripts', 'components']
  .filter((d) => existsSync(`${raiz}${d}`))
  .flatMap((d) => readdirSync(`${raiz}${d}`, { recursive: true, encoding: 'utf8' }).map((f) => `${d}/${f}`))
  .filter((f) => /\.test\.(ts|tsx|mts)$/.test(f) && !f.includes('node_modules'))
  .filter((f) => readFileSync(`${raiz}${f}`, 'utf8').includes('@electric-sql/pglite'))
  .sort();

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unidad',
          exclude: [...configDefaults.exclude, ...PGLITE],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'pglite',
          include: PGLITE,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
