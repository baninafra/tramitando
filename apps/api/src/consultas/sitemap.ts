/** URLs indexables para el sitemap: fichas propias e índices de trámites. */
export interface FilaSitemap {
  variante_id: number;
  actualizado_en: string;
  tramite_slug: string;
  juris_nivel: 'nacion' | 'provincia' | 'municipio';
  juris_slug: string;
  padre_slug: string | null;
}

function urlFicha(fila: FilaSitemap): string {
  if (fila.juris_nivel === 'nacion') return `/tramites/${fila.tramite_slug}`;
  if (fila.juris_nivel === 'provincia') return `/tramites/${fila.tramite_slug}/${fila.juris_slug}`;
  return `/tramites/${fila.tramite_slug}/${fila.padre_slug ?? fila.juris_slug}/${fila.juris_slug}`;
}

export async function listarSitemap(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT v.id AS variante_id, v.actualizado_en, t.slug AS tramite_slug,
              j.nivel AS juris_nivel, j.slug AS juris_slug, p.slug AS padre_slug
         FROM variantes v
         JOIN tramites t ON t.id = v.tramite_id
         JOIN jurisdicciones j ON j.id = v.jurisdiccion_id
         LEFT JOIN jurisdicciones p ON p.id = j.padre_id
        WHERE v.estado = 'publicada' AND t.estado = 'activo'
        ORDER BY v.actualizado_en DESC, v.id`,
    )
    .all<FilaSitemap>();

  const urls: { url: string; actualizado_en: string; tipo: 'ficha' | 'tramite' }[] = results.map((fila) => ({
    url: urlFicha(fila),
    actualizado_en: fila.actualizado_en,
    tipo: 'ficha',
  }));

  const conNacional = new Set(results.filter((f) => f.juris_nivel === 'nacion').map((f) => f.tramite_slug));
  const { results: tramites } = await db
    .prepare(
      `SELECT t.slug AS tramite_slug, MAX(v.actualizado_en) AS actualizado_en
         FROM tramites t
         JOIN variantes v ON v.tramite_id = t.id AND v.estado = 'publicada'
        WHERE t.estado = 'activo'
        GROUP BY t.id
        ORDER BY t.slug`,
    )
    .all<{ tramite_slug: string; actualizado_en: string }>();

  for (const fila of tramites) {
    if (conNacional.has(fila.tramite_slug)) continue;
    urls.push({ url: `/tramites/${fila.tramite_slug}`, actualizado_en: fila.actualizado_en, tipo: 'tramite' });
  }

  return { urls };
}
