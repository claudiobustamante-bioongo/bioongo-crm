/**
 * [expediente] Qué clientes entran a una corrida masiva (EBR o IPS).
 *
 * LAS BAJAS NO ENTRAN AL ALCANCE «TODOS». Desde el 30-sep-2026 `clientes.status`
 * admite 'baja' (cuenta cerrada; el expediente se conserva por PLD, no se
 * borra). Reevaluar una cuenta cerrada no produce una clasificación que
 * signifique algo y ensucia el lote con fallos previsibles. Se excluyen, pero
 * NO en silencio: el resumen del lote las lista en `excluidos_baja`, porque una
 * corrida que dice «36 clientes» cuando corrió 34 es una corrida que miente.
 *
 * El alcance «seleccion» no pasa por aquí: los códigos los escribió alguien a
 * mano y se respetan tal cual, bajas incluidas.
 *
 * La partición es pura para poder probarla sin base de datos.
 */

export type AlcanceMasivo = 'todos' | 'vigentes' | 'seleccion';

export type FilaCartera = { codigo_cliente: string; status: string | null };

export type Cartera = {
  /** Los códigos que se van a correr, en el orden en que llegaron. */
  codigos: string[];
  /** Los que se dejaron fuera por estar dados de baja. */
  excluidos_baja: string[];
};

/** Lo que el resumen de un lote masivo agrega por la selección de cartera. */
export type ConExcluidos = {
  /** Clientes con status 'baja' que el alcance «todos» dejó fuera. */
  excluidos_baja: string[];
};

export const STATUS_BAJA = 'baja';

export function partirCartera(filas: FilaCartera[]): Cartera {
  const codigos: string[] = [];
  const excluidos_baja: string[] = [];
  for (const f of filas) {
    if (f.status === STATUS_BAJA) excluidos_baja.push(f.codigo_cliente);
    else codigos.push(f.codigo_cliente);
  }
  return { codigos, excluidos_baja };
}
