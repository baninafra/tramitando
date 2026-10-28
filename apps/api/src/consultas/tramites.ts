/** Consulta del trámite genérico y sus jurisdicciones con ficha publicada. */
import { type Nivel, leerJson } from './comun';

export interface FilaTramite {
  id: number;
  slug: string;
  nombre: string;
  nombre_busqueda: string;
  resumen: string;
  sinonimos: string;
  popularidad: number | null;
  estado: 'activo' | 'archivado';
  creado_en: string;
}

export async function buscarTramite(db: D1Database, slug: string): Promise<FilaTramite | null> {
  return db
    .prepare(
      `SELECT id, slug, nombre, nombre_busqueda, resumen, sinonimos, popularidad, estado, creado_en
         FROM tramites WHERE slug = ? AND estado = 'activo'`,
    )
    .bind(slug)
    .first<FilaTramite>();
}

export interface FilaTemaDeTramite {
  id: number;
  slug: string;
  nombre: string;
  principal: number;
}

export async function temasDeTramite(db: D1Database, tramiteId: number) {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.slug, t.nombre, tt.principal
         FROM tramite_temas tt
         JOIN temas t ON t.id = tt.tema_id
        WHERE tt.tramite_id = ? AND t.estado = 'activo'
        ORDER BY tt.principal DESC, t.orden, t.nombre COLLATE NOCASE`,
    )
    .bind(tramiteId)
    .all<FilaTemaDeTramite>();
  return results.map((fila) => ({ id: fila.id, slug: fila.slug, nombre: fila.nombre, principal: fila.principal === 1 }));
}

export interface FilaJurisdiccionDeVariante {
  variante_id: number;
  verificacion: 'verificado' | 'revisar';
  verificado_en: string;
  proxima_revision: string;
  actualizado_en: string;
  juris_id: string;
  juris_nivel: Nivel;
  juris_nombre: string;
  juris_slug: string;
  padre_id: string | null;
  padre_nivel: Nivel | null;
  padre_nombre: string | null;
  padre_slug: string | null;
  org_id: number | null;
  org_slug: string | null;
  org_nombre: string | null;
  org_sigla: string | null;
}

export async function jurisdiccionesDeTramite(db: D1Database, tramiteId: number) {
  const { results } = await db
    .prepare(
      `SELECT v.id AS variante_id, v.verificacion, v.verificado_en, v.proxima_revision, v.actualizado_en,
              j.id AS juris_id, j.nivel AS juris_nivel, j.nombre AS juris_nombre, j.slug AS juris_slug,
              p.id AS padre_id, p.nivel AS padre_nivel, p.nombre AS padre_nombre, p.slug AS padre_slug,
              o.id AS org_id, o.slug AS org_slug, o.nombre AS org_nombre, o.sigla AS org_sigla
         FROM variantes v
         JOIN jurisdicciones j ON j.id = v.jurisdiccion_id
         LEFT JOIN jurisdicciones p ON p.id = j.padre_id
         LEFT JOIN organismos o ON o.id = v.organismo_id
        WHERE v.tramite_id = ? AND v.estado = 'publicada'
        ORDER BY CASE j.nivel WHEN 'nacion' THEN 0 WHEN 'provincia' THEN 1 ELSE 2 END,
                 j.nombre COLLATE NOCASE`,
    )
    .bind(tramiteId)
    .all<FilaJurisdiccionDeVariante>();

  return results.map((fila) => ({
    variante_id: fila.variante_id,
    verificacion: fila.verificacion,
    verificado_en: fila.verificado_en,
    proxima_revision: fila.proxima_revision,
    actualizado_en: fila.actualizado_en,
    jurisdiccion: {
      id: fila.juris_id,
      nivel: fila.juris_nivel,
      nombre: fila.juris_nombre,
      slug: fila.juris_slug,
      padre:
        fila.padre_id && fila.padre_slug && fila.padre_nombre && fila.padre_nivel
          ? { id: fila.padre_id, nivel: fila.padre_nivel, nombre: fila.padre_nombre, slug: fila.padre_slug }
          : null,
    },
    organismo:
      fila.org_id !== null && fila.org_slug && fila.org_nombre
        ? { id: fila.org_id, slug: fila.org_slug, nombre: fila.org_nombre, sigla: fila.org_sigla }
        : null,
  }));
}

export function tramitePublico(fila: FilaTramite) {
  return {
    id: fila.id,
    slug: fila.slug,
    nombre: fila.nombre,
    nombre_busqueda: fila.nombre_busqueda,
    resumen: fila.resumen,
    sinonimos: leerJson<string[]>(fila.sinonimos),
    popularidad: fila.popularidad,
    creado_en: fila.creado_en,
  };
}
