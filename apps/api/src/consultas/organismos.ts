/** Consulta de un organismo, sus trámites publicados y sus oficinas. */
import { type FilaTarjeta, type FilaVarianteTarjeta, type Nivel, tarjeta } from './comun';

export interface FilaOrganismoCompleto {
  id: number;
  slug: string;
  nombre: string;
  sigla: string | null;
  descripcion: string;
  web: string | null;
  jurisdiccion_id: string;
  juris_nivel: Nivel;
  juris_nombre: string;
  juris_slug: string;
  padre_id: string | null;
  padre_nivel: Nivel | null;
  padre_nombre: string | null;
  padre_slug: string | null;
}

export interface FilaOficinaOrganismo {
  id: number;
  nombre: string;
  direccion: string;
  localidad: string;
  horario: string | null;
  lat: number | null;
  lng: number | null;
  jurisdiccion_id: string;
  juris_nombre: string;
  juris_slug: string;
  fuente_url: string | null;
}

export async function buscarOrganismo(db: D1Database, slug: string): Promise<FilaOrganismoCompleto | null> {
  return db
    .prepare(
      `SELECT o.id, o.slug, o.nombre, o.sigla, o.descripcion, o.web, o.jurisdiccion_id,
              j.nivel AS juris_nivel, j.nombre AS juris_nombre, j.slug AS juris_slug,
              p.id AS padre_id, p.nivel AS padre_nivel, p.nombre AS padre_nombre, p.slug AS padre_slug
         FROM organismos o
         JOIN jurisdicciones j ON j.id = o.jurisdiccion_id
         LEFT JOIN jurisdicciones p ON p.id = j.padre_id
        WHERE o.slug = ?`,
    )
    .bind(slug)
    .first<FilaOrganismoCompleto>();
}

export function organismoPublico(fila: FilaOrganismoCompleto) {
  return {
    id: fila.id,
    slug: fila.slug,
    nombre: fila.nombre,
    sigla: fila.sigla,
    descripcion: fila.descripcion,
    web: fila.web,
    jurisdiccion: {
      id: fila.jurisdiccion_id,
      nivel: fila.juris_nivel,
      nombre: fila.juris_nombre,
      slug: fila.juris_slug,
      padre:
        fila.padre_id && fila.padre_slug && fila.padre_nombre && fila.padre_nivel
          ? { id: fila.padre_id, nivel: fila.padre_nivel, nombre: fila.padre_nombre, slug: fila.padre_slug }
          : null,
    },
  };
}

export async function oficinasDeOrganismo(db: D1Database, organismoId: number) {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.nombre, o.direccion, o.localidad, o.horario, o.lat, o.lng,
              o.jurisdiccion_id, j.nombre AS juris_nombre, j.slug AS juris_slug,
              f.url AS fuente_url
         FROM oficinas o
         JOIN jurisdicciones j ON j.id = o.jurisdiccion_id
         LEFT JOIN fuentes f ON f.id = o.fuente_id
        WHERE o.organismo_id = ?
        ORDER BY j.nombre COLLATE NOCASE, o.localidad COLLATE NOCASE, o.nombre COLLATE NOCASE`,
    )
    .bind(organismoId)
    .all<FilaOficinaOrganismo>();
  return results.map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    direccion: fila.direccion,
    localidad: fila.localidad,
    horario: fila.horario,
    lat: fila.lat,
    lng: fila.lng,
    jurisdiccion: { id: fila.jurisdiccion_id, nombre: fila.juris_nombre, slug: fila.juris_slug },
    fuente_url: fila.fuente_url,
  }));
}

/** Trámites con ficha publicada de este organismo, con la variante del organismo. */
export async function tramitesDeOrganismo(db: D1Database, organismo: FilaOrganismoCompleto) {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT t.id, t.slug, t.nombre, t.nombre_busqueda, t.resumen, t.sinonimos, t.popularidad
         FROM tramites t
         JOIN variantes v ON v.tramite_id = t.id AND v.estado = 'publicada' AND v.organismo_id = ?
        WHERE t.estado = 'activo'
        ORDER BY COALESCE(t.popularidad, 1000000) ASC, t.nombre COLLATE NOCASE`,
    )
    .bind(organismo.id)
    .all<FilaTarjeta>();

  const tarjetas = [];
  for (const fila of results) {
    const variante = await db
      .prepare(
        `SELECT v.id AS variante_id, v.verificacion, v.actualizado_en,
                j.id AS juris_id, j.nivel AS juris_nivel, j.nombre AS juris_nombre, j.slug AS juris_slug,
                o.id AS org_id, o.slug AS org_slug, o.nombre AS org_nombre, o.sigla AS org_sigla
           FROM variantes v
           JOIN jurisdicciones j ON j.id = v.jurisdiccion_id
           LEFT JOIN organismos o ON o.id = v.organismo_id
          WHERE v.tramite_id = ? AND v.estado = 'publicada' AND v.organismo_id = ?
          ORDER BY (v.jurisdiccion_id = ?) DESC, v.id
          LIMIT 1`,
      )
      .bind(fila.id, organismo.id, organismo.jurisdiccion_id)
      .first<FilaVarianteTarjeta>();
    tarjetas.push(tarjeta(fila, variante));
  }
  return tarjetas;
}
