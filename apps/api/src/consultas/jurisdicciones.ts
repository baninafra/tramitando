/** Consultas de jurisdicciones y resolución de la ubicación pedida en la URL. */
import {
  type FilaJurisdiccion,
  type FilaJurisdiccionConPadre,
  type FilaVarianteTarjeta,
  type Nivel,
  jurisdiccionConPadre,
} from './comun';

export interface Ubicacion {
  provincia: FilaJurisdiccion | null;
  municipio: FilaJurisdiccion | null;
  /** Nivel más específico que se pidió (aunque la variante venga de más arriba). */
  solicitada: Nivel;
}

export type ResultadoUbicacion =
  | { ok: true; ubicacion: Ubicacion }
  | { ok: false; faltante: 'provincia' | 'municipio' };

async function porId(db: D1Database, id: string): Promise<FilaJurisdiccion | null> {
  return db
    .prepare('SELECT id, nivel, nombre, slug, padre_id, georef_id, lat, lng FROM jurisdicciones WHERE id = ?')
    .bind(id)
    .first<FilaJurisdiccion>();
}

async function nacion(db: D1Database): Promise<FilaJurisdiccion | null> {
  return db
    .prepare("SELECT id, nivel, nombre, slug, padre_id, georef_id, lat, lng FROM jurisdicciones WHERE nivel = 'nacion' LIMIT 1")
    .first<FilaJurisdiccion>();
}

/**
 * Resuelve los slugs de provincia y municipio. Devuelve `faltante` si el slug pedido no existe,
 * para que la ruta responda 404 en vez de mostrar otra ubicación.
 */
export async function resolverUbicacion(db: D1Database, provSlug?: string, muniSlug?: string): Promise<ResultadoUbicacion> {
  let provincia: FilaJurisdiccion | null = null;
  let municipio: FilaJurisdiccion | null = null;

  if (provSlug) {
    provincia = await db
      .prepare("SELECT id, nivel, nombre, slug, padre_id, georef_id, lat, lng FROM jurisdicciones WHERE nivel = 'provincia' AND slug = ?")
      .bind(provSlug)
      .first<FilaJurisdiccion>();
    if (!provincia) return { ok: false, faltante: 'provincia' };
  }

  if (muniSlug) {
    if (provincia) {
      municipio = await db
        .prepare(
          "SELECT id, nivel, nombre, slug, padre_id, georef_id, lat, lng FROM jurisdicciones WHERE nivel = 'municipio' AND slug = ? AND padre_id = ?",
        )
        .bind(muniSlug, provincia.id)
        .first<FilaJurisdiccion>();
    } else {
      municipio = await db
        .prepare(
          "SELECT id, nivel, nombre, slug, padre_id, georef_id, lat, lng FROM jurisdicciones WHERE nivel = 'municipio' AND slug = ? ORDER BY id LIMIT 1",
        )
        .bind(muniSlug)
        .first<FilaJurisdiccion>();
      if (municipio?.padre_id) provincia = await porId(db, municipio.padre_id);
    }
    if (!municipio) return { ok: false, faltante: 'municipio' };
  }

  const solicitada: Nivel = municipio ? 'municipio' : provincia ? 'provincia' : 'nacion';
  return { ok: true, ubicacion: { provincia, municipio, solicitada } };
}

export async function jurisdiccionNacion(db: D1Database): Promise<FilaJurisdiccion | null> {
  return nacion(db);
}

/** Ids de las jurisdicciones candidatas, de la más cercana a la más lejana. */
export async function candidatas(db: D1Database, ubicacion: Ubicacion): Promise<string[]> {
  const ids: string[] = [];
  if (ubicacion.municipio) ids.push(ubicacion.municipio.id);
  if (ubicacion.provincia) ids.push(ubicacion.provincia.id);
  const nacional = await nacion(db);
  if (nacional) ids.push(nacional.id);
  return [...new Set(ids)];
}

const SQL_VARIANTE = `
  SELECT v.id AS variante_id, v.verificacion, v.actualizado_en,
         j.id AS juris_id, j.nivel AS juris_nivel, j.nombre AS juris_nombre, j.slug AS juris_slug,
         o.id AS org_id, o.slug AS org_slug, o.nombre AS org_nombre, o.sigla AS org_sigla
  FROM variantes v
  JOIN jurisdicciones j ON j.id = v.jurisdiccion_id
  LEFT JOIN organismos o ON o.id = v.organismo_id`;

/** Variante publicada del trámite en una jurisdicción concreta. */
export async function varianteEn(db: D1Database, tramiteId: number, jurisdiccionId: string): Promise<FilaVarianteTarjeta | null> {
  return db
    .prepare(`${SQL_VARIANTE} WHERE v.tramite_id = ? AND v.estado = 'publicada' AND v.jurisdiccion_id = ? ORDER BY v.id LIMIT 1`)
    .bind(tramiteId, jurisdiccionId)
    .first<FilaVarianteTarjeta>();
}

/**
 * Variante publicada más cercana al lugar pedido: municipio, después provincia, después Nación.
 * Devuelve también el nivel de donde salió para poder informar si la ficha es heredada.
 */
export async function varianteMasCercana(
  db: D1Database,
  tramiteId: number,
  ubicacion: Ubicacion,
): Promise<{ fila: FilaVarianteTarjeta; nivel: Nivel } | null> {
  for (const id of await candidatas(db, ubicacion)) {
    const fila = await varianteEn(db, tramiteId, id);
    if (fila) return { fila, nivel: fila.juris_nivel };
  }
  return null;
}

export interface FiltroJurisdicciones {
  nivel?: 'nacion' | 'provincia' | 'municipio';
  padre?: string;
}

export async function listarJurisdicciones(db: D1Database, filtro: FiltroJurisdicciones) {
  const condiciones: string[] = [];
  const valores: string[] = [];
  if (filtro.nivel) {
    condiciones.push('j.nivel = ?');
    valores.push(filtro.nivel);
  }
  if (filtro.padre) {
    condiciones.push('(j.padre_id = ? OR p.slug = ?)');
    valores.push(filtro.padre, filtro.padre);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { results } = await db
    .prepare(
      `SELECT j.id, j.nivel, j.nombre, j.slug, j.lat, j.lng,
              j.padre_id, p.nivel AS padre_nivel, p.nombre AS padre_nombre, p.slug AS padre_slug
       FROM jurisdicciones j
       LEFT JOIN jurisdicciones p ON p.id = j.padre_id
       ${where}
       ORDER BY j.nombre COLLATE NOCASE`,
    )
    .bind(...valores)
    .all<FilaJurisdiccionConPadre>();
  return results.map(jurisdiccionConPadre);
}
