/**
 * Tarea diaria de vencimientos.
 *
 * - Toda variante publicada con `proxima_revision` pasada pasa a `verificacion = 'revisar'` y se
 *   encola una revisión (`vencida`, prioridad 50).
 * - El día 1 de cada mes (UTC) se encola además una revisión de costos (prioridad 60) por cada
 *   variante publicada que tenga costos cargados.
 */
import type { Env } from '../env';
import { encolarSiFalta } from './cola';

export interface ResultadoVencimientos {
  vencidas: number;
  costos: number;
}

export async function procesarVencimientos(env: Env, ahora: Date = new Date()): Promise<ResultadoVencimientos> {
  const ahoraIso = ahora.toISOString();

  const { results: vencidas } = await env.DB.prepare(
    "SELECT id FROM variantes WHERE estado = 'publicada' AND proxima_revision < ? ORDER BY id",
  )
    .bind(ahoraIso)
    .all<{ id: number }>();

  for (const variante of vencidas) {
    await env.DB.prepare("UPDATE variantes SET verificacion = 'revisar' WHERE id = ?").bind(variante.id).run();
    await encolarSiFalta(env.DB, variante.id, 'vencida', 50);
  }

  let costos = 0;
  if (ahora.getUTCDate() === 1) {
    const { results: conCostos } = await env.DB.prepare(
      `SELECT DISTINCT v.id AS id
       FROM variantes v
       INNER JOIN costos c ON c.variante_id = v.id
       WHERE v.estado = 'publicada'
       ORDER BY v.id`,
    ).all<{ id: number }>();

    for (const variante of conCostos) {
      if (await encolarSiFalta(env.DB, variante.id, 'costos', 60)) costos += 1;
    }
  }

  return { vencidas: vencidas.length, costos };
}
