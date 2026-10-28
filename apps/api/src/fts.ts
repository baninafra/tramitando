/**
 * Índice de búsqueda de trámites (FTS5).
 *
 * La fila de `tramites_fts` se reconstruye entera cada vez que se aprueba un cambio: es más simple
 * y barato que intentar mantenerla sincronizada con UPDATE/DELETE parciales.
 */

/**
 * Devuelve las sentencias que borran y vuelven a insertar la fila FTS de un trámite.
 *
 * Se puede pasar el id (número) o el slug (string). El slug permite usarla dentro de un `batch`
 * en el que el trámite todavía no existe: la subconsulta resuelve el id en ese momento.
 */
export function reindexarTramite(db: D1Database, tramiteId: number | string): D1PreparedStatement[] {
  const porSlug = typeof tramiteId === 'string';
  const columna = porSlug ? 'slug' : 'id';

  return [
    db.prepare(`DELETE FROM tramites_fts WHERE tramite_id IN (SELECT id FROM tramites WHERE ${columna} = ?)`).bind(tramiteId),
    db.prepare(
      `INSERT INTO tramites_fts (nombre, nombre_busqueda, sinonimos, resumen, temas, tramite_id)
       SELECT
         t.nombre,
         t.nombre_busqueda,
         COALESCE((SELECT group_concat(j.value, ' ') FROM json_each(t.sinonimos) AS j), ''),
         t.resumen,
         COALESCE(
           (SELECT group_concat(tm.nombre, ' ')
            FROM tramite_temas tt
            INNER JOIN temas tm ON tm.id = tt.tema_id
            WHERE tt.tramite_id = t.id),
           ''
         ),
         t.id
       FROM tramites t
       WHERE t.${columna} = ?`,
    ).bind(tramiteId),
  ];
}
