/**
 * Encola trabajo de revisión sin duplicar ítems abiertos.
 *
 * Un ítem está abierto mientras `cerrado_en` sea NULL, esté o no tomado por la investigación.
 */
export async function encolarSiFalta(
  db: D1Database,
  varianteId: number,
  motivo: 'nueva' | 'cambio_fuente' | 'vencida' | 'reporte' | 'costos',
  prioridad: number,
): Promise<boolean> {
  const existente = await db
    .prepare(
      'SELECT 1 AS existe FROM cola_trabajo WHERE variante_id = ? AND motivo = ? AND cerrado_en IS NULL LIMIT 1',
    )
    .bind(varianteId, motivo)
    .first<{ existe: number }>();
  if (existente) return false;

  await db
    .prepare('INSERT INTO cola_trabajo (variante_id, motivo, prioridad) VALUES (?, ?, ?)')
    .bind(varianteId, motivo, prioridad)
    .run();
  return true;
}
